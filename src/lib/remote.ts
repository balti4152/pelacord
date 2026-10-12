import {collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, updateDoc} from 'firebase/firestore';
import {getDb} from '@/lib/firebase';
import type {Attachment, Message} from '@/types';

/**
 * Firestore is used ONLY for text messages and attachment metadata.
 *
 *   messages/{channelId}/items/{messageId}
 *
 * Voice presence ("who is in a call") is intentionally NOT here: it is meant to run
 * peer-to-peer over ZeroTier so it never touches the Firebase quota. See README.
 * File bytes are never stored either; a message only carries attachment metadata.
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

export async function postMessage(channelId: string, message: Message): Promise<void> {
	const db = getDb();
	if (!db) return;
	await setDoc(doc(db, 'messages', channelId, 'items', message.id), {
		authorId: message.authorId,
		authorName: message.authorName ?? '',
		authorColor: message.authorColor ?? '',
		content: message.content,
		createdAt: message.createdAt,
		attachments: message.attachments.map(stripAttachment),
	});
}

export async function updateMessage(channelId: string, messageId: string, content: string): Promise<void> {
	const db = getDb();
	if (!db) return;
	await updateDoc(doc(db, 'messages', channelId, 'items', messageId), {content, edited: true});
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
	const db = getDb();
	if (!db) return;
	await deleteDoc(doc(db, 'messages', channelId, 'items', messageId));
}

export function subscribeMessages(channelId: string, onData: (messages: Message[]) => void): () => void {	const db = getDb();
	if (!db) return () => {};
	const q = query(collection(db, 'messages', channelId, 'items'), orderBy('createdAt'));
	return onSnapshot(
		q,
		(snap) => {
			onData(
				snap.docs.map((docSnap) => {
					const value = docSnap.data();
					return {
						id: docSnap.id,
						channelId,
						authorId: value.authorId as string,
						authorName: value.authorName as string,
						authorColor: value.authorColor as string,
						content: value.content as string,
						createdAt: value.createdAt as number,
						edited: Boolean(value.edited),
						attachments: ((value.attachments ?? []) as Array<Omit<Attachment, 'url'> & {url?: string}>).map((a) => ({
							...a,
							url: a.url ?? '',
						})),
					} satisfies Message;
				}),
			);
		},
		() => {
			// Permission or network error: keep the local view as-is.
		},
	);
}
