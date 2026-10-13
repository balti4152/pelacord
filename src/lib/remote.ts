import {collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc} from 'firebase/firestore';
import {getDb} from '@/lib/firebase';
import type {MessageRecord} from '@/lib/messageLog';
import type {Attachment, Channel, ChannelType, Message} from '@/types';

/**
 * Firestore is used as a REPLICA of the message log (and for the channel list).
 *
 *   messages/{channelId}/items/{messageId}
 *   channels/{channelId}
 *
 * The local log (`lib/messageLog.ts`) is the source of truth: what arrives from here and what
 * arrives over the ZeroTier mesh both go through the same merge. That is what makes "Firebase
 * first, P2P when it is down" safe — it does not matter which path a message takes, the result
 * is the same. Voice presence is intentionally NOT here: it runs peer-to-peer so it never
 * touches the Firebase quota. File bytes are never stored either; a message only carries
 * attachment metadata.
 *
 * Los canales son pocos documentos y cambian casi nunca (alguien crea o borra uno), así que
 * no mueven la aguja de la cuota: es la forma más simple de que todos vean la misma lista.
 */

/**
 * Prepara un adjunto para guardarlo en Firestore.
 *
 * Regla de oro: NUNCA incluir claves con `undefined`, porque Firestore rechaza el documento
 * completo ("Unsupported field value: undefined") y el mensaje no se guarda. Por eso los
 * campos opcionales se agregan solo si tienen valor.
 */
function stripAttachment(attachment: Attachment): Record<string, unknown> {
	const clean: Record<string, unknown> = {
		id: attachment.id,
		name: attachment.name,
		size: attachment.size,
		mime: attachment.mime,
		kind: attachment.kind,
	};
	// Solo se conservan las URLs públicas (GIFs de Giphy). Los blob locales no sirven afuera.
	if (attachment.url && attachment.url.startsWith('http')) clean.url = attachment.url;
	if (attachment.ownerId) clean.ownerId = attachment.ownerId;
	if (attachment.ownerHost) clean.ownerHost = attachment.ownerHost;
	if (typeof attachment.ownerPort === 'number') clean.ownerPort = attachment.ownerPort;
	if (attachment.thumbnail) clean.thumbnail = attachment.thumbnail;
	return clean;
}

/**
 * Guarda (o actualiza) un mensaje en Firestore.
 *
 * Se usa `setDoc` para todo —crear, editar y borrar— porque el registro ya trae su versión
 * (`updatedAt`): escribir el documento entero es idempotente y no hay que decidir entre
 * insertar, actualizar o borrar.
 *
 * El borrado es una LÁPIDA (`deleted: true`), no un `deleteDoc`: si se borrara la fila, un peer
 * que todavía tuviera el mensaje lo "reviviría" en la próxima reconciliación.
 */
export async function putRecord(channelId: string, record: MessageRecord): Promise<void> {
	const db = getDb();
	if (!db) return;
	const message = record.message;
	const docData: Record<string, unknown> = {
		authorId: message.authorId,
		authorName: message.authorName ?? '',
		authorColor: message.authorColor ?? '',
		content: message.content,
		createdAt: message.createdAt,
		attachments: message.attachments.map(stripAttachment),
		updatedAt: record.updatedAt,
	};
	if (record.deleted) docData.deleted = true;
	await setDoc(doc(db, 'messages', channelId, 'items', message.id), docData);
}

/**
 * Escucha los mensajes de un canal.
 *
 * Devuelve REGISTROS (con versión y lápida), no mensajes sueltos: así lo que llega de Firestore
 * entra por el mismo merge que lo que llega por la malla, y no hay dos verdades peleando.
 */
export function subscribeMessages(channelId: string, onData: (records: MessageRecord[]) => void): () => void {
	const db = getDb();
	if (!db) return () => {};
	const q = query(collection(db, 'messages', channelId, 'items'), orderBy('createdAt'));
	return onSnapshot(
		q,
		(snap) => {
			onData(
				snap.docs.map((docSnap) => {
					const value = docSnap.data();
					const createdAt = (value.createdAt as number) ?? 0;
					// Los documentos viejos no tienen `updatedAt`: se cae a `createdAt` (nunca editados).
					const updatedAt = (value.updatedAt as number) ?? createdAt;
					const message: Message = {
						id: docSnap.id,
						channelId,
						authorId: value.authorId as string,
						authorName: value.authorName as string,
						authorColor: value.authorColor as string,
						content: value.content as string,
						createdAt,
						// Editado = la versión es posterior a la creación (o lo dice el campo viejo).
						edited: Boolean(value.edited) || updatedAt > createdAt,
						attachments: ((value.attachments ?? []) as Array<Omit<Attachment, 'url'> & {url?: string}>).map((a) => ({
							...a,
							url: a.url ?? '',
						})),
					};
					return {message, updatedAt, deleted: Boolean(value.deleted)} satisfies MessageRecord;
				}),
			);
		},
		(error) => {
			// Sin permiso o sin red: se sigue con el log local (y con lo que venga por la malla).
			console.warn('[pelacord] no se pudieron escuchar los mensajes de', channelId, error?.message ?? error);
		},
	);
}

/** Guarda (o actualiza) un canal para que lo vean todos. */
export async function putChannel(channel: Channel): Promise<void> {
	const db = getDb();
	if (!db) return;
	await setDoc(doc(db, 'channels', channel.id), {
		type: channel.type,
		name: channel.name,
		category: channel.category,
	});
}

/** Borra un canal de la lista compartida. */
export async function removeRemoteChannel(channelId: string): Promise<void> {
	const db = getDb();
	if (!db) return;
	await deleteDoc(doc(db, 'channels', channelId));
}

/**
 * Escucha la lista de canales. `isEmpty` avisa cuando el proyecto todavía no tiene ninguno,
 * para poder subir los canales iniciales la primera vez. `fromCache` marca los datos que
 * todavía no confirmó el servidor (si se usaran, un rechazo los borraría de la vista).
 */
export function subscribeChannels(onData: (channels: Channel[], isEmpty: boolean, fromCache: boolean) => void): () => void {
	const db = getDb();
	if (!db) return () => {};
	return onSnapshot(
		collection(db, 'channels'),
		(snap) => {
			onData(
				snap.docs.map((docSnap) => {
					const value = docSnap.data();
					return {
						id: docSnap.id,
						type: value.type as ChannelType,
						name: value.name as string,
						category: value.category as string,
					} satisfies Channel;
				}),
				snap.empty,
				snap.metadata.fromCache,
			);
		},
		(error) => {
			// Sin permiso o sin red: se sigue con la lista local.
			console.warn('[pelacord] no se pudo escuchar la lista de canales', error?.message ?? error);
		},
	);
}
