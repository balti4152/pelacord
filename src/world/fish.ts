/**
 * Pesca: peces, cañas, carnadas y las reglas de qué pica.
 *
 *  - La CAÑA define qué tan fácil es el minijuego (zona verde más grande, medidor que se llena más
 *    rápido y se vacía más lento) y qué tan seguido salen peces raros.
 *  - La CARNADA se gasta de a una por pez que pica: hace que piquen antes y/o mejora la suerte.
 *  - El LUGAR importa: la punta del muelle es más honda y salen cosas más raras.
 */
import {addCoins, getProfile, updateProfile} from '@/world/core';

export type Rarity = 'común' | 'raro' | 'épico' | 'legendario';

export interface FishKind {
	id: string;
	name: string;
	color: string;
	/** Pelamonedas por pez. */
	price: number;
	/** 0 (fácil) a 1 (muy difícil): qué tan nervioso se mueve en el minijuego. */
	difficulty: number;
	/** Peso para el sorteo de qué pica (más alto = más común). */
	weight: number;
	size: [number, number];
	rarity: Rarity;
	/** Sólo pica en lugares hondos (la punta del muelle). */
	deep?: boolean;
	/** No es un pez (bota, lata): se vende por chirolas y no cuenta para el álbum. */
	junk?: boolean;
}

export const FISH: FishKind[] = [
	{id: 'mojarra', name: 'Mojarrita', color: '#9fc7e8', price: 8, difficulty: 0.12, weight: 30, size: [6, 14], rarity: 'común'},
	{id: 'pejerrey', name: 'Pejerrey', color: '#c9d6e3', price: 14, difficulty: 0.25, weight: 24, size: [18, 35], rarity: 'común'},
	{id: 'bagre', name: 'Bagre', color: '#8a7a5a', price: 20, difficulty: 0.32, weight: 16, size: [25, 60], rarity: 'común'},
	{id: 'payaso', name: 'Pez payaso', color: '#ff8a3d', price: 32, difficulty: 0.45, weight: 10, size: [8, 12], rarity: 'raro'},
	{id: 'trucha', name: 'Trucha arcoíris', color: '#e98fb0', price: 40, difficulty: 0.5, weight: 8, size: [30, 70], rarity: 'raro'},
	{id: 'dorado', name: 'Dorado', color: '#f5c542', price: 55, difficulty: 0.6, weight: 7, size: [40, 90], rarity: 'raro'},
	{id: 'globo', name: 'Pez globo', color: '#f2e38b', price: 70, difficulty: 0.55, weight: 5, size: [15, 30], rarity: 'épico'},
	{id: 'pulpo', name: 'Pulpito', color: '#e05a9b', price: 95, difficulty: 0.72, weight: 3.5, size: [20, 45], rarity: 'épico', deep: true},
	{id: 'medusa', name: 'Medusa luz', color: '#9fe3ff', price: 110, difficulty: 0.68, weight: 2.5, size: [15, 40], rarity: 'épico', deep: true},
	{id: 'raya', name: 'Raya violeta', color: '#8a5cff', price: 140, difficulty: 0.82, weight: 2, size: [50, 120], rarity: 'legendario', deep: true},
	{id: 'tiburon', name: 'Tiburoncito', color: '#7f93a8', price: 220, difficulty: 0.9, weight: 0.8, size: [60, 140], rarity: 'legendario', deep: true},
	{id: 'pelaluna', name: 'Pez Pelaluna', color: '#ffd36b', price: 400, difficulty: 0.95, weight: 0.3, size: [33, 33], rarity: 'legendario', deep: true},
	{id: 'bota', name: 'Bota vieja', color: '#5c3d2e', price: 1, difficulty: 0.02, weight: 6, size: [28, 30], rarity: 'común', junk: true},
	{id: 'lata', name: 'Lata oxidada', color: '#b04a3a', price: 1, difficulty: 0.02, weight: 4, size: [12, 12], rarity: 'común', junk: true},
];

export const RARITY_COLOR: Record<Rarity, string> = {común: '#8fb3d9', raro: '#3fb68b', épico: '#e05a9b', legendario: '#f5b326'};

export interface RodKind {
	id: string;
	name: string;
	price: number;
	color: string;
	desc: string;
	/** Agranda la zona verde (fracción de la barra). */
	zone: number;
	/** Multiplica lo que se llena el medidor. */
	gain: number;
	/** Multiplica lo que se vacía. */
	drain: number;
	/** Multiplica la espera hasta que pica (menos = más rápido). */
	wait: number;
	/** Suerte: sube el peso de raros/épicos/legendarios y baja el de la basura. */
	luck: number;
}

export const RODS: RodKind[] = [
	{id: 'bambu', name: 'Caña de bambú', price: 0, color: '#c9a464', desc: 'La de siempre. Hace el trabajo.', zone: 0, gain: 1, drain: 1, wait: 1, luck: 0},
	{id: 'fibra', name: 'Caña de fibra', price: 180, color: '#4fb3ff', desc: 'Zona verde más grande y pican antes.', zone: 0.05, gain: 1.1, drain: 0.9, wait: 0.85, luck: 0.15},
	{id: 'carbono', name: 'Caña de carbono', price: 520, color: '#2a2a3a', desc: 'Liviana y firme: el pez se escapa menos.', zone: 0.08, gain: 1.25, drain: 0.75, wait: 0.75, luck: 0.35},
	{id: 'dorada', name: 'Caña dorada', price: 1500, color: '#ffc93c', desc: 'Para los legendarios. Mucha más suerte.', zone: 0.1, gain: 1.35, drain: 0.65, wait: 0.65, luck: 0.8},
];

export interface BaitKind {
	id: string;
	name: string;
	price: number;
	pack: number;
	color: string;
	desc: string;
	wait: number;
	luck: number;
	/** Atrae sólo peces (nada de basura). */
	noJunk?: boolean;
}

export const BAITS: BaitKind[] = [
	{id: 'lombriz', name: 'Lombrices', price: 20, pack: 10, color: '#e88f8f', desc: 'Pican mucho más rápido.', wait: 0.55, luck: 0.05},
	{id: 'camaron', name: 'Camarones', price: 45, pack: 6, color: '#ff9e6b', desc: 'Rápido y atrae peces más ricos.', wait: 0.7, luck: 0.35, noJunk: true},
	{id: 'brillo', name: 'Cebo brillante', price: 120, pack: 4, color: '#c6a2ff', desc: 'Brilla en lo hondo: raros y legendarios.', wait: 0.85, luck: 0.9, noJunk: true},
];

export function rodById(id: string): RodKind {
	return RODS.find((r) => r.id === id) ?? RODS[0];
}

export function baitById(id: string | null): BaitKind | null {
	return id ? BAITS.find((b) => b.id === id) ?? null : null;
}

export function fishById(id: string): FishKind | undefined {
	return FISH.find((f) => f.id === id);
}

/** La carnada que hay puesta (si quedan). */
export function currentBait(): BaitKind | null {
	const p = getProfile();
	const bait = baitById(p.activeBait);
	return bait && (p.bait[bait.id] ?? 0) > 0 ? bait : null;
}

/** Cuánto esperar hasta que pique (ms), según caña y carnada. */
export function biteWaitMs(): number {
	const rod = rodById(getProfile().rod);
	const bait = currentBait();
	const base = 2400 + Math.random() * 6000;
	return base * rod.wait * (bait?.wait ?? 1);
}

/** Qué pica: depende de la caña, la carnada y si el lugar es hondo. */
export function rollFish(deep: boolean): FishKind {
	const rod = rodById(getProfile().rod);
	const bait = currentBait();
	const luck = rod.luck + (bait?.luck ?? 0) + (deep ? 0.3 : 0);
	const bonus: Record<Rarity, number> = {común: 1, raro: 1 + luck * 0.8, épico: 1 + luck * 1.6, legendario: 1 + luck * 3};
	const pool = FISH.filter((f) => (deep || !f.deep) && !(f.junk && bait?.noJunk));
	const weights = pool.map((f) => (f.junk ? f.weight / (1 + luck * 2) : f.weight * bonus[f.rarity]));
	const total = weights.reduce((a, b) => a + b, 0);
	let r = Math.random() * total;
	for (let i = 0; i < pool.length; i++) {
		r -= weights[i];
		if (r <= 0) return pool[i];
	}
	return pool[0];
}

/** Gasta una carnada (cuando pica algo). */
export function useBait(): void {
	const bait = currentBait();
	if (!bait) return;
	updateProfile((p) => {
		const left = Math.max(0, (p.bait[bait.id] ?? 0) - 1);
		return {bait: {...p.bait, [bait.id]: left}, activeBait: left > 0 ? p.activeBait : null};
	});
}

/** Guarda un pez pescado. `perfect` = no se le escapó nunca (vale más). */
export function keepFish(kind: FishKind, perfect: boolean): {size: number; record: boolean; first: boolean} {
	const big = perfect ? 0.25 : 0;
	const t = Math.min(1, Math.random() * (1 - big) + big);
	const size = Math.round(kind.size[0] + t * (kind.size[1] - kind.size[0]));
	const best = getProfile().fishBest[kind.id] ?? 0;
	updateProfile((p) => ({
		fish: {...p.fish, [kind.id]: (p.fish[kind.id] ?? 0) + 1},
		fishBest: size > best ? {...p.fishBest, [kind.id]: size} : p.fishBest,
	}));
	return {size, record: size > best && best > 0, first: best === 0};
}

/** Vende peces en el puerto. Devuelve cuánto se cobró. */
export function sellFish(id: string | 'all'): number {
	const p = getProfile();
	let earned = 0;
	const fish = {...p.fish};
	for (const [key, count] of Object.entries(p.fish)) {
		if (id !== 'all' && key !== id) continue;
		earned += (fishById(key)?.price ?? 0) * count;
		delete fish[key];
	}
	updateProfile({fish});
	addCoins(earned);
	return earned;
}

/** Compra una caña (y la deja puesta). Devuelve un error legible o null. */
export function buyRod(id: string): string | null {
	const rod = rodById(id);
	const p = getProfile();
	if (p.rods.includes(rod.id)) {
		updateProfile({rod: rod.id});
		return null;
	}
	if (p.coins < rod.price) return `Te faltan ${rod.price - p.coins} monedas`;
	updateProfile({coins: p.coins - rod.price, rods: [...p.rods, rod.id], rod: rod.id});
	return null;
}

export function buyBait(id: string): string | null {
	const bait = baitById(id);
	if (!bait) return 'No existe';
	const p = getProfile();
	if (p.coins < bait.price) return `Te faltan ${bait.price - p.coins} monedas`;
	updateProfile({coins: p.coins - bait.price, bait: {...p.bait, [bait.id]: (p.bait[bait.id] ?? 0) + bait.pack}, activeBait: p.activeBait ?? bait.id});
	return null;
}

export function setActiveBait(id: string | null): void {
	updateProfile({activeBait: id});
}
