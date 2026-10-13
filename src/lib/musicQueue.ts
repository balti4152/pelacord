import {collection, doc, onSnapshot, setDoc} from 'firebase/firestore';
import {getDb} from '@/lib/firebase';

/**
 * Cola de música compartida (la "Jam").
 *
 * Vive en un solo documento de Firestore para que todos vean lo mismo al instante:
 *
 *   music/state  ->  {track, startedAt, pausedAt, positionMs, hostId, hostSeenAt, queue}
 *
 * El audio NO viaja por acá: lo streamea el host por la malla (WebRTC). Esto es sólo el estado
 * compartido: qué suena, desde cuándo, quién manda y qué viene después.
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
	/** Quién está streameando ahora. Si se va, otro toma el control. */
	hostId: string | null;
	/** Última vez que el host avisó que sigue vivo (para detectar que se fue). */
	hostSeenAt: number;
	/** Lo que viene después. */
	queue: MusicTrack[];
}

export const EMPTY_MUSIC_STATE: MusicState = {
	track: null,
	startedAt: 0,
	pausedAt: null,
	positionMs: 0,
	hostId: null,
	hostSeenAt: 0,
	queue: [],
};

/** Cuánto puede estar callado el host antes de considerarlo ido (ms). */
export const HOST_TIMEOUT_MS = 45000;

function musicCollection() {
	const db = getDb();
	if (!db) return null;
	return collection(db, 'music');
}

/** Cada canal de voz tiene SU propia Jam: el documento es uno por canal. */
function musicDoc(channelId: string) {
	const db = getDb();
	if (!db) return null;
	return doc(db, 'music', `channel-${channelId}`);
}

/**
 * Escucha TODAS las Jams (una por canal de voz) de una sola vez.
 * Así el sidebar puede mostrar qué canal tiene música sin abrir un listener por canal.
 */
export function subscribeMusicStates(onData: (byChannel: Record<string, MusicState>) => void): () => void {
	const ref = musicCollection();
	if (!ref) return () => {};
	return onSnapshot(
		ref,
		(snapshot) => {
			// Los datos que sólo están en la caché local no se usan: Firestore muestra cambios
			// optimistas y, si el servidor los rechaza, volvería atrás y pisaría la cola.
			if (snapshot.metadata.fromCache) return;
			const byChannel: Record<string, MusicState> = {};
			for (const document of snapshot.docs) {
				const channelId = document.id.startsWith('channel-') ? document.id.slice('channel-'.length) : document.id;
				const value = document.data() as Partial<MusicState>;
				byChannel[channelId] = {
					track: (value.track as MusicTrack | null) ?? null,
					startedAt: Number(value.startedAt) || 0,
					pausedAt: value.pausedAt === null || value.pausedAt === undefined ? null : Number(value.pausedAt),
					positionMs: Number(value.positionMs) || 0,
					hostId: (value.hostId as string | null) ?? null,
					hostSeenAt: Number(value.hostSeenAt) || 0,
					queue: Array.isArray(value.queue) ? (value.queue as MusicTrack[]) : [],
				};
			}
			onData(byChannel);
		},
		(error) => {
			console.warn('[pelacord] no se pudieron escuchar las músicas', error?.message ?? error);
		},
	);
}

/** Guarda cambios de la Jam de un canal (merge: sólo lo que se manda). */
export async function updateMusicState(channelId: string, patch: Partial<MusicState>): Promise<void> {
	const ref = musicDoc(channelId);
	if (!ref) return;
	await setDoc(ref, patch, {merge: true});
}

/** En qué segundo va la pista actual, según el reloj compartido. */
export function currentPositionMs(state: MusicState, now = Date.now()): number {
	if (!state.track) return 0;
	if (state.pausedAt) return state.positionMs;
	const since = state.startedAt ? now - state.startedAt : 0;
	return Math.max(0, since);
}

/** ¿El host sigue vivo? Si no, otro tiene que tomar el control. */
export function isHostAlive(state: MusicState, now = Date.now()): boolean {
	if (!state.hostId) return false;
	return now - state.hostSeenAt < HOST_TIMEOUT_MS;
}

/** Agrega un tema al final de la cola. */
export function appendToQueue(state: MusicState, track: MusicTrack): MusicTrack[] {
	return [...state.queue, track];
}

/** Saca un tema de la cola por posición (0 = el primero que viene). */
export function removeFromQueue(state: MusicState, index: number): MusicTrack[] {
	return state.queue.filter((_, i) => i !== index);
}

/** Mueve un tema de lugar en la cola (para reordenar arrastrando). */
export function moveInQueue(state: MusicState, from: number, to: number): MusicTrack[] {
	const queue = [...state.queue];
	if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return queue;
	const [item] = queue.splice(from, 1);
	queue.splice(to, 0, item);
	return queue;
}
