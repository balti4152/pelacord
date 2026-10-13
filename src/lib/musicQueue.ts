/**
 * Estado de la Jam.
 *
 * OJO: esto NO vive en Firestore. La música es tiempo real y va por la MALLA (P2P), igual que la
 * voz y la presencia: el host difunde el estado y los demás lo aplican. Ponerlo en Firestore
 * quemaba la cuota diaria (nos pasó) y dejaba la música sin funcionar cuando Firebase fallaba.
 *
 * Acá quedan sólo el tipo y las cuentas puras (nada de red).
 */
export interface MusicTrack {
	/** Id del video (YouTube) o id propio si vino de otro lado. */
	id: string;
	title: string;
	/** Segundos. 0 si no se sabe. */
	duration: number;
	thumbnail: string;
	author: string;
	/** Link del video, para volver a sacarle el audio cuando haga falta. */
	url: string;
	/** Quién la agregó (para mostrarlo en la cola). */
	addedBy: string;
}

export interface MusicState {
	/** Qué se está reproduciendo (null = nada). */
	track: MusicTrack | null;
	/** Momento en que arrancó la pista actual (para calcular el segundo en que va). */
	startedAt: number;
	/** Si está pausada, momento de la pausa (null = sonando). */
	pausedAt: number | null;
	/** Posición guardada, en milisegundos (se usa al pausar y al retomar). */
	positionMs: number;
	/** Quién está mandando el audio (el id más chico del canal). */
	hostId: string | null;
	/** Lo que viene después. */
	queue: MusicTrack[];
}

export const EMPTY_MUSIC_STATE: MusicState = {
	track: null,
	startedAt: 0,
	pausedAt: null,
	positionMs: 0,
	hostId: null,
	queue: [],
};

/** Lo que el host difunde por la malla. */
export interface MusicBroadcast {
	channelId: string;
	state: MusicState;
}

/** Comandos que cualquiera le manda al host (estilo Jam: todos controlan). */
export type MusicCommand =
	| {kind: 'play'; track: MusicTrack | null; startAtMs?: number}
	| {kind: 'pause'; paused: boolean}
	| {kind: 'skip'}
	| {kind: 'enqueue'; track: MusicTrack}
	| {kind: 'remove'; index: number}
	| {kind: 'move'; from: number; to: number};

/**
 * Elige quién manda el audio, de forma DETERMINÍSTICA.
 *
 * Todos calculan lo mismo a partir de la lista de gente en el canal (el id más chico), así que
 * nunca puede haber dos hosts al mismo tiempo. Antes la elección era "el primero que escribe en
 * la base", y si dos miraban al mismo tiempo los dos se ponían de host: se escuchaban dos
 * canciones encimadas y la pausa de uno no afectaba al otro.
 */
export function electHost(participantIds: string[]): string | null {
	if (participantIds.length === 0) return null;
	return [...participantIds].sort()[0] ?? null;
}

/** En qué segundo va la pista actual, según el reloj compartido. */
export function currentPositionMs(state: MusicState, now = Date.now()): number {
	if (!state.track) return 0;
	if (state.pausedAt) return state.positionMs;
	const since = state.startedAt ? now - state.startedAt : 0;
	return Math.max(0, since);
}

/** Agrega un tema al final de la cola. */
export function appendToQueue(state: MusicState, track: MusicTrack): MusicTrack[] {
	return [...state.queue, track];
}

/** Saca un tema de la cola por posición (0 = el primero que viene). */
export function removeFromQueue(state: MusicState, index: number): MusicTrack[] {
	return state.queue.filter((_, i) => i !== index);
}

/** Mueve un tema de lugar en la cola (para reordenar). */
export function moveInQueue(state: MusicState, from: number, to: number): MusicTrack[] {
	const queue = [...state.queue];
	if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return queue;
	const [item] = queue.splice(from, 1);
	queue.splice(to, 0, item);
	return queue;
}

/** Aplica un comando sobre el estado (lo hace el host cuando recibe una orden). */
export function applyMusicCommand(state: MusicState, command: MusicCommand): MusicState {
	if (command.kind === 'play') {
		return {
			...state,
			track: command.track,
			startedAt: command.track ? Date.now() - (command.startAtMs ?? 0) : 0,
			pausedAt: null,
			positionMs: command.startAtMs ?? 0,
		};
	}
	if (command.kind === 'pause') {
		return command.paused
			? {...state, pausedAt: Date.now(), positionMs: currentPositionMs(state)}
			: {...state, pausedAt: null, startedAt: Date.now() - state.positionMs};
	}
	if (command.kind === 'skip') {
		const [next, ...rest] = state.queue;
		if (!next) return {...state, track: null, queue: [], startedAt: 0, positionMs: 0, pausedAt: null};
		return {...state, track: next, queue: rest, startedAt: Date.now(), positionMs: 0, pausedAt: null};
	}
	if (command.kind === 'enqueue') return {...state, queue: appendToQueue(state, command.track)};
	if (command.kind === 'remove') return {...state, queue: removeFromQueue(state, command.index)};
	if (command.kind === 'move') return {...state, queue: moveInQueue(state, command.from, command.to)};
	return state;
}
