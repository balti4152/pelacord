import type {Message} from '@/types';

/**
 * Log local de mensajes para el chat P2P.
 *
 * La idea: cada peer guarda TODO el historial en su disco y, cuando se conecta con otro,
 * intercambian lo que les falta. Nada de servidor ni de nube.
 *
 * Piezas clave (esto es lo que hace que no se rompa):
 * - **Id propio por mensaje** (`message.id`): así el mismo mensaje recibido dos veces no se duplica.
 * - **Versión por mensaje** (`updatedAt`): si hay una edición, gana la más nueva. Es "gana el último".
 * - **Lápida** (`deleted`): un borrado no borra la fila, la marca. Si no, al reconciliar con alguien
 *   que todavía tenía el mensaje, el borrado "reviviría".
 * - **Reconciliación**: cada peer pide "lo que cambió desde T" y se fusiona. Fusionar es
 *   conmutativo (da igual el orden), así que todos convergen al mismo historial.
 *
 * Acá NO hay red: son funciones puras, para poder probarlas y razonarlas.
 */

export interface MessageRecord {
	message: Message;
	/** Cuándo cambió por última vez (creación, edición o borrado). Se usa para desempatar. */
	updatedAt: number;
	/** Si está borrado sólo queda esta marca, para que no vuelva al reconciliar. */
	deleted?: boolean;
}

/** Todos los registros conocidos, por id de mensaje. */
export type MessageLog = Record<string, MessageRecord>;

/** Fusión de un registro: gana el más nuevo. Devuelve el log nuevo (sin mutar el viejo). */
export function mergeRecord(log: MessageLog, incoming: MessageRecord): MessageLog {
	const current = log[incoming.message.id];
	if (current && current.updatedAt >= incoming.updatedAt) return log;
	return {...log, [incoming.message.id]: incoming};
}

/** Marca un mensaje como borrado (con su hora, para que gane sobre la versión vieja). */
export function applyDelete(log: MessageLog, messageId: string, at = Date.now()): MessageLog {
	const current = log[messageId];
	if (!current) return log;
	if (current.updatedAt >= at) return log;
	return {...log, [messageId]: {...current, deleted: true, updatedAt: at}};
}

/** Fusiona dos logs completos (para la reconciliación al conectarse). */
export function mergeLogs(local: MessageLog, remote: MessageLog): MessageLog {
	let next = local;
	for (const record of Object.values(remote)) next = mergeRecord(next, record);
	return next;
}

/** Los mensajes de un canal, ordenados y sin los borrados. */
export function messagesOf(log: MessageLog, channelId: string): Message[] {
	return Object.values(log)
		.filter((record) => !record.deleted && record.message.channelId === channelId)
		.sort((a, b) => a.message.createdAt - b.message.createdAt || a.message.id.localeCompare(b.message.id))
		.map((record) => record.message);
}

/** Lo que hay que mandarle a alguien que ya sabe hasta `since` (0 = todo). */
export function recordsSince(log: MessageLog, since: number): MessageRecord[] {
	return Object.values(log).filter((record) => record.updatedAt > since);
}

/** Hasta cuándo sabe ese peer (el mayor updatedAt que tiene), para pedirle sólo lo que falta. */
export function lastUpdatedAt(log: MessageLog): number {
	let max = 0;
	for (const record of Object.values(log)) if (record.updatedAt > max) max = record.updatedAt;
	return max;
}

/** Cuántos mensajes vivos hay en un canal (para la interfaz). */
export function countMessages(log: MessageLog, channelId: string): number {
	return Object.values(log).filter((record) => !record.deleted && record.message.channelId === channelId).length;
}
