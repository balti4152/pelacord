/**
 * Salas de Pelaflix.
 *
 * La idea: cada persona puede tener UNA sala (el id de la sala es el id del host). El host es el
 * que manda el tiempo y el estado; los demás se sincronizan. Todo viaja por la MALLA (P2P), nunca
 * por Firebase: es tiempo real y no puede depender de la nube.
 *
 * Los números de sala ("Sala 1", "Sala 2") salen de ordenar por hora de creación (con el id de
 * host como desempate), así a todos les da el mismo número sin que nadie lo tenga que asignar.
 *
 * Acá NO hay red: son tipos y cuentas puras, para poder probarlas.
 */

export interface MovieMedia {
	tmdbId: number;
	mediaType: 'movie' | 'tv';
	title: string;
	poster: string;
	year: string;
}

export interface MovieRoom {
	/** Es el id del host: cada persona tiene una sola sala. */
	id: string;
	hostId: string;
	hostName: string;
	media: MovieMedia;
	/** Milisegundos desde el arranque del video en `startedAt`. */
	positionMs: number;
	paused: boolean;
	/** Cuándo se puso en marcha (para calcular por dónde va cada uno). */
	startedAt: number;
	/** Para ordenar las salas y que a todos les toque el mismo número. */
	createdAt: number;
	/** Última vez que cambió (gana el más nuevo si llegan dos versiones). */
	updatedAt: number;
}

/** Lo que cualquiera le puede pedir al host de una sala. */
export type MovieRoomCommand =
	| {kind: 'play'}
	| {kind: 'pause'}
	| {kind: 'seek'; positionMs: number}
	/** Cambiar la película de esa sala. */
	| {kind: 'open'; media: MovieMedia}
	/** Cerrar la sala. */
	| {kind: 'close'};

/** "Sala 1", "Sala 2", … */
export function roomLabel(index: number): string {
	return `Sala ${index + 1}`;
}

/** Orden estable de las salas: por creación y, si empatan, por id de host. */
export function sortRooms(rooms: MovieRoom[]): MovieRoom[] {
	return [...rooms].sort((a, b) => a.createdAt - b.createdAt || a.hostId.localeCompare(b.hostId));
}

/** Por dónde va la sala ahora mismo. */
export function positionOf(room: MovieRoom, now = Date.now()): number {
	if (room.paused) return Math.max(0, room.positionMs);
	return Math.max(0, room.positionMs + (now - room.startedAt));
}

/** Aplica una orden sobre una sala (lo hace el host). */
export function applyMovieCommand(room: MovieRoom, command: MovieRoomCommand, now = Date.now()): MovieRoom {
	if (command.kind === 'play') {
		if (!room.paused) return room;
		return {...room, paused: false, startedAt: now, updatedAt: now};
	}
	if (command.kind === 'pause') {
		if (room.paused) return room;
		return {...room, paused: true, positionMs: positionOf(room, now), updatedAt: now};
	}
	if (command.kind === 'seek') {
		return {...room, positionMs: Math.max(0, command.positionMs), startedAt: now, updatedAt: now};
	}
	if (command.kind === 'open') {
		// Película nueva: se arranca pausada, para que todos entren antes de darle play.
		return {...room, media: command.media, positionMs: 0, paused: true, startedAt: now, updatedAt: now};
	}
	return room;
}

/** Cuánto se desvía el video local respecto de la sala (en milisegundos). */
export function driftMs(room: MovieRoom, localPositionMs: number, now = Date.now()): number {
	return localPositionMs - positionOf(room, now);
}

/**
 * Si hay que corregir el tiempo, cuánto se tolera antes de tocar el video.
 *
 * Sin esto, cualquier diferencia mínima obligaría a saltar y se vería a los tirones.
 */
export const MOVIE_DRIFT_TOLERANCE_MS = 2000;

/** ¿Esta sala es de alguien que ya no está? (para limpiar las viejas). */
export function isStale(room: MovieRoom, now = Date.now(), maxAgeMs = 20000): boolean {
	return now - room.updatedAt > maxAgeMs;
}
