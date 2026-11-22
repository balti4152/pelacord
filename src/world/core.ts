/**
 * Mundo 3D de PelaCord: tipos, catálogo, perfil (look, inventario, monedas, casa) y red P2P.
 *
 * Todo lo del mundo viaja por la malla en el canal `world` (igual que la Jam): nada de servidor.
 * El perfil vive en este equipo (localStorage) y se comparte con los demás en cada anuncio.
 */
import {OUTDOOR_ITEMS} from '@/world/outdoorDecor';
import {useEffect, useState, useSyncExternalStore} from 'react';
import {getDesktopTransport} from '@/lib/desktop';
import {isPetId, type PetId} from '@/world/petCatalog';
import {makeFarm, readFarm, type Farm, type FarmLand} from '@/world/farmData';
import {readBlackjack, type Blackjack} from '@/world/blackjackSave';
import {isMountId, readMountColors, type MountColors, type MountId, type MountSelection} from '@/world/mountCatalog';

// ------------------------------------------------------------------ tipos ---

export type Body = 'M' | 'F';
export type Slot = 'hair' | 'eyes' | 'brows' | 'mouth' | 'cheeks' | 'top' | 'bottom' | 'shoes' | 'hat' | 'facewear' | 'back' | 'costume';
export type ColorKey = 'skin' | 'hair' | 'top' | 'bottom' | 'shoes' | 'sole';

export interface Look {
	body: Body;
	hair: string | null;
	eyes: string;
	brows: string;
	mouth: string;
	cheeks: string | null;
	top: string;
	bottom: string;
	shoes: string;
	hat: string | null;
	facewear?: string | null;
	back?: string | null;
	costume: string | null;
	colors: Record<ColorKey, string>;
}

export interface CatalogItem {
	id: string;
	name: string;
	slot: Slot | 'furniture' | 'mount';
	price: number;
	glb?: string;
	meshes?: string[];
	hides?: string | string[];
	attach?: 'head' | 'spine';
	recolor?: string | string[] | null;
	category?: string;
	seats?: number;
	defaultColor?: string | null;
}

export interface Catalog {
	currency: {name: string; startCoins: number};
	avatar: {glb: string; palettes: {hair: string[]; skin: string[]; clothes: string[]}; looks: Record<string, Partial<Look>>};
	items: CatalogItem[];
}

export type RoomId = 'city' | 'living' | 'cinema' | 'campfire' | 'shop' | 'games' | 'port' | 'arena' | 'casino' | 'restaurant' | 'smithy' | `house:${string}` | `yard:${string}`;

export const ROOMS: Array<{id: Exclude<RoomId, `house:${string}` | `yard:${string}`>; name: string; glb: string; icon: string}> = [
	{id: 'city', name: 'Ciudad', glb: 'models/room_city.glb', icon: 'map'},
	{id: 'living', name: 'Living', glb: 'models/room_living.glb', icon: 'sofa'},
	{id: 'cinema', name: 'Cine', glb: 'models/room_cinema.glb', icon: 'clapperboard'},
	{id: 'campfire', name: 'Campamento', glb: 'models/room_campfire.glb', icon: 'flame'},
	{id: 'shop', name: 'Tienda', glb: 'models/room_shop.glb', icon: 'store'},
	{id: 'games', name: 'Casa de juegos', glb: 'models/room_games.glb', icon: 'dice'},
	{id: 'port', name: 'Puerto', glb: 'models/room_port.glb', icon: 'anchor'},
	{id: 'arena', name: 'Arena', glb: 'models/room_arena.glb', icon: 'trophy'},
	{id: 'casino', name: 'Casino', glb: 'models/room_casino.glb', icon: 'dice'},
	{id: 'restaurant', name: 'Restaurante', glb: 'models/room_restaurant.glb', icon: 'store'},
	{id: 'smithy', name: 'Herrería', glb: 'models/room_smithy.glb', icon: 'store'},
];
export const HOUSE_GLB = 'models/room_house.glb';
export const YARD_GLB = 'models/room_yard.glb';

export interface FurnitureSupport {
	uid: string;
	x: number;
	z: number;
	rot: number;
}

export interface PlacedFurniture {
	uid: string;
	id: string;
	color?: string | null;
	/** null = en el inventario (comprado pero no puesto). */
	x: number | null;
	z: number | null;
	rot: number;
	/** Posición y giro relativos a la tapa del mueble que lo sostiene. */
	support?: FurnitureSupport;
	/** Neones: los puntos de la tira en la sala ([x, y, z, …]). */
	pts?: number[];
	/** Puesto en el patio (no adentro de la casa). */
	yard?: boolean;
	/** Lo fijo de la casa que se sacó (la ventana). */
	hidden?: boolean;
}

export type Anim = 'idle' | 'walk' | 'run' | 'jump' | 'sit' | 'dance' | 'fish' | 'robot' | 'clap' | 'hips' | 'disco' | 'pogo' | 'sway';
/** Los estados que son bailes (duran hasta moverse). */
export const LOOP_ANIMS = ['dance', 'robot', 'clap', 'hips', 'disco', 'pogo', 'sway'] as const;
export type LoopAnim = typeof LOOP_ANIMS[number];

/** Lo que cada uno anuncia del mundo. */
export interface PlayerState {
	id: string;
	name: string;
	color: string;
	room: RoomId;
	x: number;
	z: number;
	ry: number;
	anim: Anim;
	seat: string | null;
	/** Hacia dónde camina (los demás simulan la caminata: no hace falta mandar cada paso). */
	tx?: number;
	tz?: number;
	look: Look;
	house: PlacedFurniture[];
	garden?: FarmLand;
	equippedPet?: PetId | null;
	mount?: MountSelection | null;
	t: number;
	/** Altura (para ver caerse a los demás en los juegos de la Arena). */
	y?: number;
	/** Está en la parte 2D de PelaCord: su personaje queda quieto, gris y medio transparente. */
	away?: boolean;
}

/** Gestos de una vez. Los bailes ('dance', 'robot', 'clap') son estados (`Anim`): duran hasta moverse. */
export type Emote = 'wave' | 'slap' | 'laugh' | 'cheer' | 'bow' | 'shrug' | 'heart';

export type WorldMessage =
	| {kind: 'state'; s: PlayerState}
	| {kind: 'emote'; id: string; room: RoomId; emote: Emote; target?: string | null}
	| {kind: 'leave'; id: string}
	/** "Vení a mi casa": invitación dirigida. */
	| {kind: 'invite'; id: string; name: string; room: RoomId; open?: boolean}
	/** Timbre: "estoy en tu puerta, ¿me dejás entrar?". */
	| {kind: 'bell'; id: string; name: string}
	/** Una apuesta en el casino (los demás ven el globito y, si gana, el festejo). */
	/** Las fichas que alguien tiene puestas en el paño de la ruleta (las ven los de la misma mesa). */
	| {kind: 'casino-chips'; id: string; room: RoomId; chips: Array<{bet: number | string; stake: number}>}
	| {kind: 'casino'; id: string; room: RoomId; bets: CasinoBetInfo[]; payout: number; total: number; delay: number; spin?: unknown}
	| {kind: 'game'; g: GameMessage};

// --------------------------------------------------------------- catálogo ---

let catalogPromise: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
	catalogPromise ??= fetch('catalog.json').then((r) => {
		if (!r.ok) throw new Error(`catalog ${r.status}`);
		return r.json() as Promise<Catalog>;
	}).then((catalog) => {
		// La decoración de afuera (faroles, guirnalda, plantas de la plaza) se suma con código.
		for (const item of OUTDOOR_ITEMS) if (!catalog.items.some((i) => i.id === item.id)) catalog.items.push(item);
		return catalog;
	});
	return catalogPromise;
}

export function useCatalog(): Catalog | null {
	const [catalog, setCatalog] = useState<Catalog | null>(null);
	useEffect(() => {
		let alive = true;
		void loadCatalog().then((c) => alive && setCatalog(c)).catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	return catalog;
}

export const SLOT_LABEL: Record<string, string> = {
	hair: 'Pelo', eyes: 'Ojos', brows: 'Cejas', mouth: 'Boca', cheeks: 'Cachetes', top: 'Arriba',
	bottom: 'Abajo', shoes: 'Calzado', hat: 'Sombreros', facewear: 'Lentes y más', back: 'Bolsos y alas',
	costume: 'Disfraces', furniture: 'Muebles', mount: 'Monturas',
	plantas: 'Plantas', deco: 'Decoración', exterior: 'Exterior',
};
export const SLOT_EMOJI: Record<string, string> = {
	hair: '💇', eyes: '👀', brows: '🤨', mouth: '😄', cheeks: '😊', top: '👕', bottom: '👖', shoes: '👟',
	hat: '🎩', facewear: '👓', back: '🎒', costume: '🌭', asientos: '🛋️', dormitorio: '🛏️', mesas: '🪵', luces: '💡', deco: '🪴',
};

// ----------------------------------------------------------------- perfil ---

export interface WorldProfile {
	look: Look;
	/** Artículos comprados (los gratis no hace falta anotarlos). */
	owned: string[];
	coins: number;
	/** Muebles comprados: puestos en la casa (x/z) o guardados (x null). */
	furniture: PlacedFurniture[];
	/** Ya armó su personaje la primera vez. */
	created: boolean;
	/** Peces pescados (id del pez → cuántos), para vender en el puerto. */
	fish: Record<string, number>;
	/** Récord de cada pez (el más grande, en cm). */
	fishBest: Record<string, number>;
	/** Cañas compradas y la que está usando. */
	rods: string[];
	rod: string;
	/** Carnadas (id → cuántas quedan) y la que tiene puesta. */
	bait: Record<string, number>;
	activeBait: string | null;
	captureSpheres: number;
	pets: Record<string, number>;
	equippedPet: PetId | null;
	equippedMount: MountId | null;
	mountColors: MountColors;
	farm: Farm;
	blackjack?: Blackjack | null;
}

const PROFILE_KEY = 'pelacord.world.v1';
const START_COINS = 500;

export const DEFAULT_LOOK: Look = {
	body: 'M', hair: 'hair_bowl', eyes: 'eyes_dot', brows: 'brows_line', mouth: 'mouth_smile', cheeks: null,
	top: 'top_tee', bottom: 'bottom_pants', shoes: 'shoes_sneakers', hat: null, facewear: null, back: null, costume: null,
	colors: {skin: '#f3bd96', hair: '#3b2418', top: '#8a5cff', bottom: '#2f3b78', shoes: '#f4f4f4', sole: '#ff7350'},
};

function readProfile(): WorldProfile {
	try {
		const raw = localStorage.getItem(PROFILE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<WorldProfile>;
			const pets = Object.fromEntries(Object.entries(parsed.pets ?? {}).filter(([, count]) => Number.isSafeInteger(count) && count > 0));
			const owned = Array.isArray(parsed.owned) ? parsed.owned : [];
			return {
				look: {...DEFAULT_LOOK, ...(parsed.look ?? {}), colors: {...DEFAULT_LOOK.colors, ...(parsed.look?.colors ?? {})}},
				owned,
				coins: typeof parsed.coins === 'number' ? parsed.coins : START_COINS,
				furniture: Array.isArray(parsed.furniture) ? parsed.furniture : [],
				created: Boolean(parsed.created),
				fish: parsed.fish && typeof parsed.fish === 'object' ? parsed.fish : {},
				fishBest: parsed.fishBest && typeof parsed.fishBest === 'object' ? parsed.fishBest : {},
				rods: Array.isArray(parsed.rods) && parsed.rods.length ? parsed.rods : ['bambu'],
				rod: typeof parsed.rod === 'string' ? parsed.rod : 'bambu',
				bait: parsed.bait && typeof parsed.bait === 'object' ? parsed.bait : {},
				activeBait: typeof parsed.activeBait === 'string' ? parsed.activeBait : null,
				captureSpheres: Number.isSafeInteger(parsed.captureSpheres) ? Math.max(0, parsed.captureSpheres!) : 0,
				pets,
				equippedPet: isPetId(parsed.equippedPet) && pets[parsed.equippedPet] ? parsed.equippedPet : null,
				equippedMount: isMountId(parsed.equippedMount) && owned.includes(parsed.equippedMount) ? parsed.equippedMount : null,
				mountColors: readMountColors(parsed.mountColors),
				farm: readFarm(parsed.farm),
				blackjack: readBlackjack(parsed.blackjack),
			};
		}
	} catch {
		// perfil roto: se arranca de cero
	}
	return {look: DEFAULT_LOOK, owned: [], coins: START_COINS, furniture: [], created: false, fish: {}, fishBest: {}, rods: ['bambu'], rod: 'bambu', bait: {}, activeBait: null, captureSpheres: 0, pets: {}, equippedPet: null, equippedMount: null, mountColors: {}, farm: makeFarm()};
}

let profile: WorldProfile = typeof localStorage === 'undefined' ? readProfile() : readProfile();
const profileListeners = new Set<() => void>();

export function getProfile(): WorldProfile {
	return profile;
}

export function updateProfile(patch: Partial<WorldProfile> | ((p: WorldProfile) => Partial<WorldProfile>)): void {
	const next = typeof patch === 'function' ? patch(profile) : patch;
	profile = {...profile, ...next};
	try {
		localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
	} catch {
		// sin espacio: sigue en memoria
	}
	for (const listener of profileListeners) listener();
}

export function useProfile(): WorldProfile {
	return useSyncExternalStore(
		(cb) => {
			profileListeners.add(cb);
			return () => profileListeners.delete(cb);
		},
		() => profile,
	);
}

export function owns(item: CatalogItem | undefined, p: WorldProfile = profile): boolean {
	if (!item) return false;
	return item.price === 0 || p.owned.includes(item.id);
}

/** Compra un artículo. Devuelve un error legible o null si salió bien. */
export function buy(item: CatalogItem, color?: string | null): string | null {
	if (item.slot !== 'furniture' && owns(item)) return 'Ya lo tenés';
	if (profile.coins < item.price) return `Te faltan ${item.price - profile.coins} monedas`;
	updateProfile((p) => ({
		coins: p.coins - item.price,
		owned: item.slot === 'furniture' || p.owned.includes(item.id) ? p.owned : [...p.owned, item.id],
		furniture: item.slot === 'furniture'
			? [...p.furniture, {uid: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, id: item.id, color: color ?? item.defaultColor ?? null, x: null, z: null, rot: 0}]
			: p.furniture,
	}));
	return null;
}

export function addCoins(amount: number): void {
	if (amount) updateProfile((p) => ({coins: Math.max(0, p.coins + amount)}));
}

// --------------------------------------------------------------------- red --

const STALE_MS = 9000;
/** La última hora (del reloj de cada uno) que mandó cada jugador: para ordenar sus mensajes. */
const sentAt = new Map<string, number>();
let peers: Record<string, PlayerState> = {};
const peerListeners = new Set<() => void>();
const emoteListeners = new Set<(m: Extract<WorldMessage, {kind: 'emote'}>) => void>();
const gameListeners = new Set<(g: GameMessage, from: string) => void>();
const inviteListeners = new Set<(m: Extract<WorldMessage, {kind: 'invite'}>) => void>();
const bellListeners = new Set<(m: Extract<WorldMessage, {kind: 'bell'}>) => void>();
const casinoListeners = new Set<(m: Extract<WorldMessage, {kind: 'casino'}>) => void>();

export interface CasinoBetInfo {
	label: string;
	stake: number;
	tone?: string;
}

const chipsListeners = new Set<(m: Extract<WorldMessage, {kind: 'casino-chips'}>) => void>();
export function onCasinoChips(callback: (m: Extract<WorldMessage, {kind: 'casino-chips'}>) => void): () => void {
	startNet();
	chipsListeners.add(callback);
	return () => chipsListeners.delete(callback);
}

export function onCasinoBet(callback: (m: Extract<WorldMessage, {kind: 'casino'}>) => void): () => void {
	startNet();
	casinoListeners.add(callback);
	return () => casinoListeners.delete(callback);
}

export function onBell(callback: (m: Extract<WorldMessage, {kind: 'bell'}>) => void): () => void {
	startNet();
	bellListeners.add(callback);
	return () => bellListeners.delete(callback);
}

export function onInvite(callback: (m: Extract<WorldMessage, {kind: 'invite'}>) => void): () => void {
	startNet();
	inviteListeners.add(callback);
	return () => inviteListeners.delete(callback);
}
let netStarted = false;

function emitPeers(): void {
	for (const listener of peerListeners) listener();
}

export function sendWorld(message: WorldMessage, to?: string): void {
	getDesktopTransport()?.sendWorld?.(message, to);
}

function startNet(): void {
	if (netStarted) return;
	netStarted = true;
	const transport = getDesktopTransport();
	transport?.onWorld?.(({from, payload}) => {
		const message = payload as WorldMessage | null;
		if (!message || typeof message !== 'object') return;
		if (message.kind === 'state' && message.s?.id === from) {
			// Orden: se compara la hora DEL QUE LO MANDA con su mensaje anterior (no con mi hora).
			// Antes se mezclaban: si su reloj estaba atrasado, se descartaban sus mensajes, se quedaba
			// congelado y después "desaparecía".
			const lastSent = sentAt.get(from) ?? -Infinity;
			if (message.s.t < lastSent) return;
			sentAt.set(from, message.s.t);
			peers = {...peers, [from]: {...message.s, t: Date.now()}};
			emitPeers();
		} else if (message.kind === 'leave' && message.id === from) {
			sentAt.delete(from);
			if (!peers[from]) return;
			const next = {...peers};
			delete next[from];
			peers = next;
			emitPeers();
		} else if (message.kind === 'emote' && message.id === from) {
			for (const listener of emoteListeners) listener(message);
		} else if (message.kind === 'invite' && message.id === from) {
			for (const listener of inviteListeners) listener(message);
		} else if (message.kind === 'casino-chips' && message.id === from && Array.isArray(message.chips)) {
			for (const listener of chipsListeners) listener(message);
		} else if (message.kind === 'casino' && message.id === from && Array.isArray(message.bets)) {
			for (const listener of casinoListeners) listener(message);
		} else if (message.kind === 'bell' && message.id === from) {
			for (const listener of bellListeners) listener(message);
		} else if (message.kind === 'game' && message.g) {
			for (const listener of gameListeners) listener(message.g, from);
		}
	});
	transport?.onPeerLeft?.(({id}) => {
		sentAt.delete(id);
		if (!peers[id]) return;
		const next = {...peers};
		delete next[id];
		peers = next;
		emitPeers();
	});
	setInterval(() => {
		const now = Date.now();
		let changed = false;
		const next: Record<string, PlayerState> = {};
		for (const [id, state] of Object.entries(peers)) {
			if (now - state.t > STALE_MS) {
				changed = true;
				sentAt.delete(id);
			}
			else next[id] = state;
		}
		if (changed) {
			peers = next;
			emitPeers();
		}
	}, 3000);
}

export function getPeers(): Record<string, PlayerState> {
	return peers;
}

export function useWorldPeers(): Record<string, PlayerState> {
	startNet();
	return useSyncExternalStore(
		(cb) => {
			peerListeners.add(cb);
			return () => peerListeners.delete(cb);
		},
		() => peers,
	);
}

export function onEmote(callback: (m: Extract<WorldMessage, {kind: 'emote'}>) => void): () => void {
	startNet();
	emoteListeners.add(callback);
	return () => emoteListeners.delete(callback);
}

export function onGame(callback: (g: GameMessage, from: string) => void): () => void {
	startNet();
	gameListeners.add(callback);
	return () => gameListeners.delete(callback);
}

// ------------------------------------------------------- juegos (tipos) -----

/** Mensajes de los juegos de la mesa (ver tableGames.ts). */
export type GameMessage = {type: string; [key: string]: unknown};
