/** Lo que muestra el HUD del karting (lo escribe el juego, lo lee la pantalla). */

export type KartItem = 'banana' | 'banana3' | 'bola' | 'misil' | 'misil3' | 'turbo' | 'turbo3' | 'estrella' | 'cometa' | 'moneda';

export interface KartHudDot {
	id: string;
	x: number;
	y: number;
	me: boolean;
	color: string;
}

export interface KartHudState {
	active: boolean;
	item: KartItem | null;
	/** Mientras gira la ruleta de la caja: qué imagen se ve ahora. */
	rolling: KartItem | null;
	count: number;
	coins: number;
	lap: number;
	laps: number;
	place: number;
	racers: number;
	/** 3, 2, 1, 0 (= ¡YA!) o null. */
	countdown: number | null;
	banner: string | null;
	wrongWay: boolean;
	finished: boolean;
	mapPath: string;
	dots: KartHudDot[];
	/** Destello de la salida turbo / del turbo del derrape. */
	flash: number;
}

const EMPTY: KartHudState = {
	active: false, item: null, rolling: null, count: 0, coins: 0, lap: 1, laps: 3, place: 1, racers: 1,
	countdown: null, banner: null, wrongWay: false, finished: false, mapPath: '', dots: [], flash: 0,
};

let current: KartHudState = EMPTY;
const listeners = new Set<() => void>();

export function setKartHud(patch: Partial<KartHudState>): void {
	let changed = false;
	for (const key of Object.keys(patch) as Array<keyof KartHudState>) {
		if (current[key] !== patch[key]) {
			changed = true;
			break;
		}
	}
	if (!changed) return;
	current = {...current, ...patch};
	for (const fn of listeners) fn();
}

export function resetKartHud(): void {
	current = EMPTY;
	for (const fn of listeners) fn();
}

export function getKartHud(): KartHudState {
	return current;
}

export function subscribeKartHud(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/** Imagen de cada poder (renders del modelo 3D). */
export const KART_ITEM_IMAGE: Record<KartItem, string> = {
	banana: 'images/kart/banana.png', banana3: 'images/kart/banana.png', bola: 'images/kart/bola.png',
	misil: 'images/kart/misil.png', misil3: 'images/kart/misil.png', turbo: 'images/kart/turbo.png',
	turbo3: 'images/kart/turbo.png', estrella: 'images/kart/estrella.png', cometa: 'images/kart/cometa.png',
	moneda: 'images/kart/moneda.png',
};
