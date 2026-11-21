/**
 * La TELE de cada sala del mundo 3D.
 *
 * Cada sala (living, cine, cada casa) tiene su propia tele con su propio estado: música con cola,
 * una película de Pelaflix o una pantalla compartida. Cualquiera que esté en la sala la controla
 * (pausa, siguiente, poner otra) y se sincroniza por la malla en el canal `world`.
 *
 * La música de la tele NO es la Jam: suena sólo para los que están en esa sala, más fuerte cerca de
 * la pantalla y nada afuera. Así cada uno puede escuchar algo en su casa sin molestar al resto.
 *
 * Sincronización: el estado viaja con la POSICIÓN (no con la hora del que lo manda), así un reloj
 * desfasado entre PCs no corre el tema. Gana el cambio más nuevo (`t`, tipo reloj de Lamport).
 */
import {useSyncExternalStore} from 'react';
import {getDesktopTransport} from '@/lib/desktop';
import type {RoomId} from '@/world/core';

export interface TvTrack {
	id: string;
	title: string;
	thumbnail: string;
	duration: number;
	author?: string;
	url?: string;
}

export type TvMode = 'off' | 'music' | 'movie' | 'screen';

/** Lo que viaja por la red. */
export interface TvWire {
	room: RoomId;
	t: number;
	by: string;
	mode: TvMode;
	queue: TvTrack[];
	index: number;
	/** Por dónde va el tema (ms) al momento de mandarlo. */
	positionMs: number;
	paused: boolean;
	movieRoomId?: string | null;
	sharerId?: string | null;
}

/** Lo que guardo yo: además, CUÁNDO (con mi reloj) estaba en `positionMs`. */
export interface TvState extends TvWire {
	anchor: number;
}

let tvs: Record<string, TvState> = {};
const listeners = new Set<() => void>();
let lastT = 0;
let meId = '';
let started = false;

function emit(): void {
	for (const listener of listeners) listener();
}

/** Por dónde va la música de la tele ahora (ms). */
export function tvPosition(tv: TvState, now = Date.now()): number {
	if (tv.paused || tv.mode !== 'music') return Math.max(0, tv.positionMs);
	return Math.max(0, tv.positionMs + (now - tv.anchor));
}

export function currentTrack(tv: TvState | null | undefined): TvTrack | null {
	if (!tv || tv.mode !== 'music') return null;
	return tv.queue[tv.index] ?? null;
}

function toWire(tv: TvState): TvWire {
	return {
		room: tv.room, t: tv.t, by: tv.by, mode: tv.mode, queue: tv.queue, index: tv.index,
		positionMs: tvPosition(tv), paused: tv.paused, movieRoomId: tv.movieRoomId ?? null, sharerId: tv.sharerId ?? null,
	};
}

function accept(wire: TvWire): boolean {
	if (!wire || typeof wire.room !== 'string' || typeof wire.t !== 'number') return false;
	const known = tvs[wire.room];
	lastT = Math.max(lastT, wire.t);
	// Mismo `t` = la misma versión reenviada: se queda la mía (con mi ancla de tiempo).
	if (known && (known.t > wire.t || (known.t === wire.t && known.by >= wire.by))) return false;
	tvs = {...tvs, [wire.room]: {...wire, queue: Array.isArray(wire.queue) ? wire.queue.slice(0, 60) : [], anchor: Date.now()}};
	return true;
}

function broadcast(list: TvWire[], to?: string): void {
	if (!list.length) return;
	getDesktopTransport()?.sendWorld?.({kind: 'tv', list}, to);
}

/** Arranca la red de la tele (una vez). */
export function startTv(id: string): void {
	meId = id;
	if (started) return;
	started = true;
	getDesktopTransport()?.onWorld?.(({payload}) => {
		const message = payload as {kind?: string; list?: TvWire[]} | null;
		if (message?.kind !== 'tv' || !Array.isArray(message.list)) return;
		let changed = false;
		for (const wire of message.list) changed = accept(wire) || changed;
		if (changed) emit();
	});
	// Al entrar, se pide el estado de las teles a los demás (así no arranco con un contador viejo).
	getDesktopTransport()?.sendWorld?.({kind: 'tv-hello'});
	getDesktopTransport()?.onWorld?.(({payload, from}) => {
		const message = payload as {kind?: string} | null;
		if (message?.kind !== 'tv-hello') return;
		broadcast(Object.values(tvs).filter((t) => t.mode !== 'off').map(toWire), from);
	});
	// Cada tanto se reenvía lo que está prendido: el que entra tarde se entera solo.
	setInterval(() => {
		const active = Object.values(tvs).filter((tv) => tv.mode !== 'off').map(toWire);
		broadcast(active);
	}, 5000);
}

/** Cambia la tele de una sala (lo puede hacer cualquiera que esté ahí). */
export function setTv(room: RoomId, change: (current: TvState) => Partial<TvWire>): void {
	const now = Date.now();
	const current: TvState = tvs[room] ?? {room, t: 0, by: '', mode: 'off', queue: [], index: 0, positionMs: 0, paused: false, anchor: now};
	const patch = change(current);
	// Reloj de Lamport puro (NO la hora de la PC): si el reloj de un amigo estaba atrasado, sus cambios
	// parecían "viejos", se descartaban y el reenvío de los demás le pisaba la música (no arrancaba nunca).
	lastT += 1;
	const next: TvState = {
		...current,
		positionMs: tvPosition(current, now),
		...patch,
		room,
		t: lastT,
		by: meId,
		anchor: now,
	};
	tvs = {...tvs, [room]: next};
	emit();
	broadcast([toWire(next)]);
}

export function getTv(room: RoomId): TvState | null {
	return tvs[room] ?? null;
}

export function useTvs(): Record<string, TvState> {
	return useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => tvs,
	);
}

// ---------------------------------------------------------------- órdenes ---

export const tv = {
	playNow(room: RoomId, track: TvTrack): void {
		setTv(room, (c) => {
			const queue = c.mode === 'music' ? [...c.queue.slice(0, c.index + 1), track, ...c.queue.slice(c.index + 1)] : [track];
			// (Se recuerda quién compartía pantalla: al sacar la música, la tele vuelve a su transmisión.)
			return {mode: 'music', queue, index: c.mode === 'music' ? c.index + 1 : 0, positionMs: 0, paused: false, movieRoomId: null};
		});
	},
	enqueue(room: RoomId, track: TvTrack): void {
		setTv(room, (c) => (c.mode === 'music' ? {queue: [...c.queue, track]} : {mode: 'music', queue: [track], index: 0, positionMs: 0, paused: false, movieRoomId: null}));
	},
	toggle(room: RoomId): void {
		setTv(room, (c) => ({paused: !c.paused}));
	},
	seek(room: RoomId, positionMs: number): void {
		setTv(room, () => ({positionMs: Math.max(0, positionMs)}));
	},
	next(room: RoomId): void {
		setTv(room, (c) => {
			if (c.index + 1 < c.queue.length) return {index: c.index + 1, positionMs: 0, paused: false};
			// Se terminó la cola: si alguien estaba compartiendo pantalla, vuelve a verse.
			return c.sharerId ? {mode: 'screen', index: c.queue.length, positionMs: 0, paused: true} : {index: c.queue.length, positionMs: 0, paused: true};
		});
	},
	previous(room: RoomId): void {
		setTv(room, (c) => (tvPosition(c) > 4000 ? {positionMs: 0} : {index: Math.max(0, c.index - 1), positionMs: 0, paused: false}));
	},
	jump(room: RoomId, index: number): void {
		setTv(room, () => ({index, positionMs: 0, paused: false}));
	},
	remove(room: RoomId, index: number): void {
		setTv(room, (c) => {
			const queue = c.queue.filter((_, i) => i !== index);
			return {queue, index: index < c.index ? c.index - 1 : Math.min(c.index, queue.length)};
		});
	},
	movie(room: RoomId, movieRoomId: string): void {
		setTv(room, () => ({mode: 'movie', movieRoomId, paused: false}));
	},
	screen(room: RoomId, sharerId: string): void {
		setTv(room, () => ({mode: 'screen', sharerId, movieRoomId: null}));
	},
	/** Apaga lo que hay. Si había música/película encima de una pantalla compartida, vuelve la pantalla. */
	off(room: RoomId): void {
		setTv(room, (c) => (c.sharerId && c.mode !== 'screen'
			? {mode: 'screen', movieRoomId: null, paused: true}
			: {mode: 'off', movieRoomId: null, sharerId: null, paused: true}));
	},
	/** El que compartía dejó de hacerlo: la tele se olvida de su pantalla. */
	stopSharing(room: RoomId): void {
		setTv(room, (c) => (c.mode === 'screen' ? {mode: 'off', sharerId: null, paused: true} : {sharerId: null}));
	},
};

/** Volumen según la distancia a la pantalla: fuerte al lado, bajito al fondo, nada afuera. */
export function volumeForDistance(distance: number | null): number {
	if (distance === null) return 0;
	const v = 1 - Math.max(0, distance - 2.2) / 8.5;
	return Math.min(1, Math.max(0.14, v));
}
