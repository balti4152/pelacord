/**
 * Karting de Gomitas: tres pistas armadas en Blender (public/models/kart/*.glb, ver tools/kart), 3 vueltas.
 *
 * Como en los juegos de karting de verdad: derrape con chispas y mini-turbo (Shift), salida turbo
 * (acelerar justo en el "2"), monedas que suben la velocidad máxima (y se pierden al chocar), cajas con
 * poderes según el puesto (los de atrás reciben mejores), rebufo detrás de otro auto, flechas de turbo,
 * el pasto frena, y poderes: banana, bola que rebota, misil que sigue la pista hasta el de adelante
 * (si cambia quién va adelante, cambia de objetivo), cometa que va al primero, turbo, estrella y monedas.
 *
 * El host simula los proyectiles y los choques de los bots; cada uno ve sus propias cajas y monedas.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js';
import {getParty, type HostBot, type HostCtx, hostNow} from '@/world/party';
import type {GameDef, PartyCtx} from '@/world/partyGames';
import {worldSounds} from '@/world/worldSounds';
import {type KartItem, resetKartHud, setKartHud} from '@/world/kart/kartHud';
import TRACK_DATA from '@/world/kart/tracks.json';

export const KART_LAPS = 3;
const TOP = 22;
const CELL = 8;
const COLORS = ['#ff4fa8', '#3fa4ff', '#ffd23f', '#45e07a', '#a066ff', '#ff8a2a', '#2ee6d6', '#ff5e5e'];

// ------------------------------------------------------------------------- pista -----

interface RawTrack {
	id: string;
	name: string;
	theme: 'candy' | 'beach' | 'snow';
	half: number;
	offroad: number;
	boxes: number[];
	pads: Array<[number, number]>;
	coins: Array<[number, number]>;
	pts: Array<[number, number, number]>;
}

interface Track extends RawTrack {
	n: number;
	x: Float32Array;
	y: Float32Array;
	z: Float32Array;
	tx: Float32Array;
	tz: Float32Array;
	grid: Map<number, number[]>;
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
}

const cellKey = (cx: number, cz: number) => (cx + 2048) * 4096 + (cz + 2048);

const TRACKS: Track[] = (TRACK_DATA as RawTrack[]).map((raw) => {
	const n = raw.pts.length;
	const x = new Float32Array(n);
	const y = new Float32Array(n);
	const z = new Float32Array(n);
	raw.pts.forEach(([a, b, c], i) => {
		x[i] = a;
		y[i] = b;
		z[i] = c;
	});
	const tx = new Float32Array(n);
	const tz = new Float32Array(n);
	const grid = new Map<number, number[]>();
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (let i = 0; i < n; i++) {
		const dx = x[(i + 1) % n] - x[(i - 1 + n) % n];
		const dz = z[(i + 1) % n] - z[(i - 1 + n) % n];
		const len = Math.hypot(dx, dz) || 1;
		tx[i] = dx / len;
		tz[i] = dz / len;
		const key = cellKey(Math.floor(x[i] / CELL), Math.floor(z[i] / CELL));
		const list = grid.get(key);
		if (list) list.push(i);
		else grid.set(key, [i]);
		minX = Math.min(minX, x[i]);
		maxX = Math.max(maxX, x[i]);
		minZ = Math.min(minZ, z[i]);
		maxZ = Math.max(maxZ, z[i]);
	}
	return {...raw, n, x, y, z, tx, tz, grid, minX, maxX, minZ, maxZ};
});

const trackOf = (g: Record<string, unknown>) => TRACKS[((g.track as number) ?? 0) % TRACKS.length];

/** Punto de la pista más cercano: índice, qué tan corrido del centro (+ = izquierda) y cuánto entre puntos. */
function nearest(t: Track, x: number, z: number): {i: number; side: number; along: number} {
	let best = -1;
	let bestD = Infinity;
	const cx = Math.floor(x / CELL);
	const cz = Math.floor(z / CELL);
	for (let reach = 1; reach <= 4 && best < 0; reach += 3) {
		for (let a = cx - reach; a <= cx + reach; a++) {
			for (let b = cz - reach; b <= cz + reach; b++) {
				const list = t.grid.get(cellKey(a, b));
				if (!list) continue;
				for (const i of list) {
					const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
					if (d < bestD) {
						bestD = d;
						best = i;
					}
				}
			}
		}
	}
	if (best < 0) {
		for (let i = 0; i < t.n; i++) {
			const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
	}
	const dx = x - t.x[best];
	const dz = z - t.z[best];
	return {i: best, side: dx * t.tz[best] - dz * t.tx[best], along: THREE.MathUtils.clamp(dx * t.tx[best] + dz * t.tz[best], -0.5, 0.5)};
}

const wrap = (t: Track, i: number) => ((Math.round(i) % t.n) + t.n) % t.n;

/** Lugar de la pista (índice con decimales) a cierta distancia del centro. */
function trackAt(t: Track, p: number, side: number): {x: number; y: number; z: number} {
	const i0 = Math.floor(p);
	const f = p - i0;
	const a = ((i0 % t.n) + t.n) % t.n;
	const b = (a + 1) % t.n;
	const x = t.x[a] + (t.x[b] - t.x[a]) * f;
	const z = t.z[a] + (t.z[b] - t.z[a]) * f;
	const y = t.y[a] + (t.y[b] - t.y[a]) * f;
	return {x: x + t.tz[a] * side, y, z: z - t.tx[a] * side};
}

function heightAt(t: Track, x: number, z: number): number {
	const {i, along} = nearest(t, x, z);
	const j = along >= 0 ? (i + 1) % t.n : (i - 1 + t.n) % t.n;
	return t.y[i] + (t.y[j] - t.y[i]) * Math.abs(along);
}

const headingAt = (t: Track, i: number) => {
	const k = wrap(t, i);
	return Math.atan2(t.tx[k], t.tz[k]);
};

/** Avance en la carrera: vueltas * largo + dónde está (los de la grilla, antes de la línea, van "en negativo"). */
function progress(t: Track, x: number, z: number, laps: number): number {
	const {i, along} = nearest(t, x, z);
	let p = i + along;
	if (laps <= 0 && p > t.n * 0.75) p -= t.n;
	return laps * t.n + p;
}

/** El mismo punto de la pista, pero contado cerca del avance anterior (para los proyectiles). */
function unwrapNear(t: Track, previous: number, i: number): number {
	const k = Math.round((previous - i) / t.n);
	return k * t.n + i;
}

function grid(t: Track, index: number): {i: number; side: number} {
	const row = Math.floor(index / 4);
	const col = index % 4;
	return {i: t.n - 5 - row * 3, side: (col - 1.5) * 2.3};
}

function clampToTrack(t: Track, p: THREE.Vector3): THREE.Vector3 {
	const {i, side} = nearest(t, p.x, p.z);
	const max = t.half + t.offroad + 0.1;
	if (Math.abs(side) > max) {
		const fix = side - Math.sign(side) * max;
		p.x -= t.tz[i] * fix;
		p.z += t.tx[i] * fix;
	}
	return p;
}

// ------------------------------------------------------------------------- poderes -----

const ITEM_COUNT: Record<KartItem, number> = {banana: 1, banana3: 3, bola: 1, misil: 1, misil3: 3, turbo: 1, turbo3: 3, estrella: 1, cometa: 1, moneda: 1};

/** Qué sale en la caja según el puesto (0 = primero, 1 = último). */
function rollItem(fraction: number): KartItem {
	const tables: Array<Array<[KartItem, number]>> = [
		[['banana', 40], ['bola', 28], ['banana3', 14], ['moneda', 18]],
		[['bola', 18], ['misil', 26], ['turbo', 18], ['banana', 12], ['turbo3', 10], ['moneda', 8], ['estrella', 4], ['banana3', 4]],
		[['turbo3', 24], ['misil', 18], ['misil3', 14], ['estrella', 16], ['cometa', 10], ['turbo', 18]],
	];
	const table = fraction < 0.2 ? tables[0] : fraction < 0.62 ? tables[1] : tables[2];
	const total = table.reduce((a, [, w]) => a + w, 0);
	let r = Math.random() * total;
	for (const [item, w] of table) {
		r -= w;
		if (r <= 0) return item;
	}
	return table[0][0];
}

const ROLL_FACES: KartItem[] = ['banana', 'misil', 'turbo', 'bola', 'estrella', 'moneda', 'cometa'];

interface Proj {
	id: string;
	kind: 'misil' | 'bola' | 'cometa';
	owner: string;
	x: number;
	y: number;
	z: number;
	vx: number;
	vz: number;
	p: number;
	side: number;
	born: number;
	bounces: number;
	target?: string;
}

interface Trap {
	id: string;
	x: number;
	y: number;
	z: number;
}

interface Boom {
	x: number;
	y: number;
	z: number;
	at: number;
	big?: boolean;
}

const SPIN_MS = 1250;

function stunnedAt(g: Record<string, unknown>, id: string): number | null {
	const at = (g.stun as Record<string, number> | undefined)?.[id];
	return at === undefined ? null : at;
}

function isSpinning(g: Record<string, unknown>, id: string): boolean {
	const at = stunnedAt(g, id);
	if (at === null) return false;
	const age = hostNow() - at;
	return age >= 0 && age < SPIN_MS;
}

function hasStar(g: Record<string, unknown>, id: string): boolean {
	return ((g.star as Record<string, number> | undefined)?.[id] ?? 0) > hostNow();
}

// ------------------------------------------------------------------------- host -----

function lapsOf(g: Record<string, unknown>): Record<string, number> {
	return (g.laps as Record<string, number>) ?? {};
}

function racerProgress(ctx: HostCtx, t: Track): Array<{id: string; p: number; x: number; y: number; z: number}> {
	const pos = ctx.positions();
	const laps = lapsOf(ctx.state.g);
	return ctx.state.players
		.filter((id) => pos[id] && !ctx.state.order.includes(id))
		.map((id) => ({id, p: progress(t, pos[id].x, pos[id].z, laps[id] ?? 0), ...pos[id]}));
}

function hostStun(ctx: HostCtx, id: string, booms: Boom[], at: {x: number; y: number; z: number}, big = false): void {
	const g = ctx.state.g;
	booms.push({x: at.x, y: at.y, z: at.z, at: Date.now(), big});
	if (hasStar(g, id)) return;
	ctx.setG({stun: {...((ctx.state.g.stun as Record<string, number>) ?? {}), [id]: Date.now()}});
}

function placeFraction(ctx: HostCtx, t: Track, id: string): number {
	const list = racerProgress(ctx, t).sort((a, b) => b.p - a.p);
	const k = list.findIndex((r) => r.id === id);
	return list.length > 1 ? Math.max(0, k) / (list.length - 1) : 0;
}

function spawnProj(ctx: HostCtx, t: Track, owner: string, kind: Proj['kind'], from: {x: number; y: number; z: number; ry: number}): void {
	const g = ctx.state.g;
	const laps = lapsOf(g);
	const fx = Math.sin(from.ry);
	const fz = Math.cos(from.ry);
	const x = from.x + fx * 2.4;
	const z = from.z + fz * 2.4;
	const near = nearest(t, x, z);
	const speed = kind === 'bola' ? 32 : 0;
	const proj: Proj = {
		id: `${owner}:${Date.now()}:${Math.floor(Math.random() * 1000)}`, kind, owner, x, y: from.y + 0.6, z,
		vx: fx * speed, vz: fz * speed, p: progress(t, x, z, laps[owner] ?? 0), side: near.side, born: Date.now(), bounces: 0,
	};
	const list = ((g.proj as Proj[]) ?? []).slice(-15);
	ctx.setG({proj: [...list, proj], projAt: Date.now()});
}

function hostSim(ctx: HostCtx, dt: number): void {
	const g = ctx.state.g;
	const t = trackOf(g);
	const now = Date.now();
	let projs = ((g.proj as Proj[]) ?? []).map((p) => ({...p}));
	let traps = ((g.traps as Trap[]) ?? []).slice();
	const booms: Boom[] = [];
	const racers = racerProgress(ctx, t);
	const alive: Proj[] = [];
	for (const pr of projs) {
		const age = (now - pr.born) / 1000;
		let hit: string | null = null;
		if (pr.kind === 'bola') {
			pr.x += pr.vx * dt;
			pr.z += pr.vz * dt;
			const near = nearest(t, pr.x, pr.z);
			const max = t.half + t.offroad;
			if (Math.abs(near.side) > max) {
				// Rebota en la baranda.
				const nx = t.tz[near.i] * Math.sign(near.side);
				const nz = -t.tx[near.i] * Math.sign(near.side);
				const dot = pr.vx * nx + pr.vz * nz;
				pr.vx -= 2 * dot * nx;
				pr.vz -= 2 * dot * nz;
				const fix = near.side - Math.sign(near.side) * max;
				pr.x -= t.tz[near.i] * fix;
				pr.z += t.tx[near.i] * fix;
				pr.bounces += 1;
			}
			pr.y = heightAt(t, pr.x, pr.z) + 0.45;
			for (const r of racers) {
				if (r.id === pr.owner && age < 0.7) continue;
				if (Math.hypot(r.x - pr.x, r.z - pr.z) < 1.4) hit = r.id;
			}
			if (pr.bounces > 5 || age > 9) {
				booms.push({x: pr.x, y: pr.y, z: pr.z, at: now});
				continue;
			}
		} else {
			// Misil / cometa: siguen la pista; cerca del objetivo van derecho a él.
			const ahead = racers.filter((r) => r.id !== pr.owner && r.p > pr.p + 0.5).sort((a, b) => a.p - b.p);
			const leader = racers.filter((r) => r.id !== pr.owner).sort((a, b) => b.p - a.p)[0];
			const target = pr.kind === 'cometa' ? leader : ahead[0] ?? leader;
			pr.target = target?.id;
			const speed = pr.kind === 'cometa' ? 46 : 35;
			const homeAt = pr.kind === 'cometa' ? 22 : 15;
			const ox = pr.x;
			const oz = pr.z;
			if (target && Math.hypot(target.x - pr.x, target.z - pr.z) < homeAt && Math.abs(target.p - pr.p) < homeAt + 6) {
				const dx = target.x - pr.x;
				const dz = target.z - pr.z;
				const d = Math.hypot(dx, dz) || 1;
				pr.x += (dx / d) * speed * dt;
				pr.z += (dz / d) * speed * dt;
				pr.y += (target.y + 0.7 - pr.y) * Math.min(1, dt * 6);
				pr.p = unwrapNear(t, pr.p, nearest(t, pr.x, pr.z).i);
				if (Math.hypot(target.x - pr.x, target.z - pr.z) < (pr.kind === 'cometa' ? 2.2 : 1.5)) hit = target.id;
			} else {
				pr.p += speed * dt;
				pr.side *= Math.pow(0.15, dt);
				const at = trackAt(t, pr.p, pr.side);
				pr.x = at.x;
				pr.z = at.z;
				const lift = pr.kind === 'cometa' ? 6 : 0.7;
				pr.y += (at.y + lift - pr.y) * Math.min(1, dt * 5);
			}
			pr.vx = (pr.x - ox) / dt;
			pr.vz = (pr.z - oz) / dt;
			if (age > (pr.kind === 'cometa' ? 25 : 16) || !target) {
				booms.push({x: pr.x, y: pr.y, z: pr.z, at: now});
				continue;
			}
		}
		// Un proyectil choca con una banana: se rompen los dos.
		const trap = traps.find((b) => Math.hypot(b.x - pr.x, b.z - pr.z) < 1.3);
		if (trap) {
			traps = traps.filter((b) => b !== trap);
			booms.push({x: pr.x, y: pr.y, z: pr.z, at: now});
			continue;
		}
		if (hit) {
			const big = pr.kind === 'cometa';
			hostStun(ctx, hit, booms, pr, big);
			if (big) for (const r of racers) if (r.id !== hit && Math.hypot(r.x - pr.x, r.z - pr.z) < 5) hostStun(ctx, r.id, booms, r);
			continue;
		}
		alive.push(pr);
	}
	projs = alive;
	// Los bots pisan bananas (los jugadores lo avisan ellos mismos).
	for (const b of ctx.bots) {
		const trap = traps.find((x) => Math.hypot(x.x - b.x, x.z - b.z) < 1.1);
		if (!trap) continue;
		traps = traps.filter((x) => x !== trap);
		hostStun(ctx, b.id, booms, b);
	}
	// Estrella: el que la tiene tumba a los que toca.
	for (const r of racers) {
		if (!hasStar(ctx.state.g, r.id)) continue;
		for (const o of racers) {
			if (o.id === r.id || isSpinning(ctx.state.g, o.id)) continue;
			if (Math.hypot(o.x - r.x, o.z - r.z) < 2) hostStun(ctx, o.id, booms, o);
		}
	}
	const patch: Record<string, unknown> = {};
	if (projs.length || ((g.proj as Proj[]) ?? []).length) {
		patch.proj = projs.map((p) => ({...p, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100, vx: Math.round(p.vx * 10) / 10, vz: Math.round(p.vz * 10) / 10}));
		patch.projAt = now;
	}
	if (traps.length !== ((g.traps as Trap[]) ?? []).length) patch.traps = traps;
	if (booms.length) patch.booms = [...(((ctx.state.g.booms as Boom[]) ?? []).filter((b) => now - b.at < 3000)), ...booms].slice(-10);
	if (Object.keys(patch).length) ctx.setG(patch);
}

// ------------------------------------------------------------------------- recursos -----

const gltf = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('draco/');
gltf.setDRACOLoader(draco);
const modelCache = new Map<string, Promise<THREE.Group>>();

function loadModel(url: string): Promise<THREE.Group> {
	let p = modelCache.get(url);
	if (!p) {
		p = gltf.loadAsync(url).then((r) => r.scene);
		modelCache.set(url, p);
		p.catch(() => modelCache.delete(url));
	}
	return p;
}

/** Copia de un poder (Banana, Misil, Bola, Estrella, Turbo, Cometa, Caja, Moneda), centrado. */
function itemClone(items: THREE.Group | null, name: string): THREE.Object3D {
	const src = items?.getObjectByName(name);
	if (!src) {
		const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), new THREE.MeshStandardMaterial({color: 0xffffff}));
		return m;
	}
	const copy = src.clone(true);
	copy.position.set(0, 0, 0);
	copy.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (mesh.isMesh) mesh.castShadow = true;
	});
	const holder = new THREE.Group();
	holder.add(copy);
	return holder;
}

function spriteTexture(): THREE.CanvasTexture {
	const c = document.createElement('canvas');
	c.width = c.height = 64;
	const x = c.getContext('2d')!;
	const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
	grad.addColorStop(0, 'rgba(255,255,255,1)');
	grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
	grad.addColorStop(1, 'rgba(255,255,255,0)');
	x.fillStyle = grad;
	x.fillRect(0, 0, 64, 64);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function skyDome(theme: Track['theme']): THREE.Mesh {
	const top = new THREE.Color(theme === 'snow' ? 0x7fb2e8 : theme === 'beach' ? 0x3aa6ff : 0x5fb8ff);
	const bottom = new THREE.Color(theme === 'snow' ? 0xe8f2ff : 0xd9f2ff);
	const geometry = new THREE.SphereGeometry(400, 32, 16);
	const colors: number[] = [];
	const pos = geometry.attributes.position as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		const k = THREE.MathUtils.clamp((pos.getY(i) / 400 + 0.05) / 0.6, 0, 1);
		const c = bottom.clone().lerp(top, k);
		colors.push(c.r, c.g, c.b);
	}
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false}));
	mesh.renderOrder = -10;
	return mesh;
}

/** Mapa chiquito (SVG) del recorrido, en coordenadas 0..100. */
function mapGeometry(t: Track): {path: string; toMap(x: number, z: number): [number, number]} {
	const size = Math.max(t.maxX - t.minX, t.maxZ - t.minZ);
	const ox = (t.minX + t.maxX) / 2;
	const oz = (t.minZ + t.maxZ) / 2;
	// Visto desde arriba con la largada abajo: x a la derecha, z hacia arriba (espejado para que coincida con la vista).
	const toMap = (x: number, z: number): [number, number] => [50 - ((x - ox) / size) * 100, 50 - ((z - oz) / size) * 100];
	let d = '';
	for (let i = 0; i < t.n; i += 4) {
		const [a, b] = toMap(t.x[i], t.z[i]);
		d += `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`;
	}
	return {path: d + 'Z', toMap};
}

// ------------------------------------------------------------------------- el juego -----

export const kart: GameDef = {
	id: 'kart', name: 'Karting de Gomitas', color: '#45e07a', duration: 240, kind: 'race', bigMap: true,
	desc: 'Karting en tres pistas enormes: Valle Caramelo, Playa Gelatina y Pico Nevado. 3 vueltas, derrapes, turbos y poderes.',
	how: 'W acelera, S frena, A/D doblan. Shift + doblar = derrapar (soltá con chispas para turbo). Espacio usa el poder. Acelerá justo en el 2 para salir con turbo.',
	spawn: (i, n, g) => {
		const t = trackOf(g);
		// Los jugadores largan atrás de todo (los bots adelante), como en los juegos de karting.
		const s = grid(t, n - 1 - i);
		const at = trackAt(t, s.i, s.side);
		return [at.x, at.z];
	},
	hostSetup: (_players, seed) => ({track: seed % TRACKS.length, traps: [], stun: {}, laps: {}, proj: [], projAt: 0, star: {}, booms: []}),
	build(ctx) {
		const t = trackOf(ctx.state.g);
		const group = new THREE.Group();
		const sky = skyDome(t.theme);
		group.add(sky);
		const camera = ctx.engine.viewContext().camera as THREE.PerspectiveCamera;
		const oldFar = camera.far;
		camera.far = 900;
		camera.updateProjectionMatrix();
		let disposed = false;
		let items: THREE.Group | null = null;

		// La pista de Blender.
		void loadModel(`models/kart/${t.id}.glb`).then((scene) => {
			if (disposed) return;
			const copy = scene.clone(true);
			copy.traverse((o) => {
				const mesh = o as THREE.Mesh;
				if (!mesh.isMesh) return;
				mesh.receiveShadow = true;
				const name = (mesh.material as THREE.Material)?.name ?? '';
				// Lo que tiene altura hace sombra (el piso, el asfalto y las líneas no).
				mesh.castShadow = !/^(Ground|Road|RoadLine|Curb|Checker|BoostPad|Water|Rock)/.test(name) && !/^(Ground|terrain)/.test(mesh.name);
				if (name === 'Water') {
					const m = mesh.material as THREE.MeshStandardMaterial;
					m.transparent = true;
					m.opacity = 0.82;
					m.roughness = 0.05;
				}
			});
			group.add(copy);
		});

		// Cajas, monedas, bananas y proyectiles.
		const boxSlots: Array<{x: number; y: number; z: number; obj: THREE.Object3D; q: THREE.Object3D; back: number}> = [];
		const coinSlots: Array<{x: number; y: number; z: number; obj: THREE.Object3D; back: number}> = [];
		const trapMeshes = new Map<string, THREE.Object3D>();
		const projMeshes = new Map<string, THREE.Object3D>();
		const fx = new THREE.Group();
		group.add(fx);
		void loadModel('models/kart/items.glb').then((scene) => {
			if (disposed) return;
			items = scene;
			for (const idx of t.boxes) {
				for (const side of [-4.4, -1.5, 1.5, 4.4]) {
					const at = trackAt(t, idx, side);
					const obj = itemClone(items, 'Caja');
					obj.scale.setScalar(1.15);
					group.add(obj);
					const q = itemClone(items, 'CajaQ');
					q.scale.setScalar(1.15);
					group.add(q);
					boxSlots.push({...at, obj, q, back: 0});
				}
			}
			for (const [idx, side] of t.coins) {
				const at = trackAt(t, idx, side);
				const obj = itemClone(items, 'Moneda');
				obj.scale.setScalar(1.2);
				group.add(obj);
				coinSlots.push({...at, obj, back: 0});
			}
		});

		// Partículas: chispas del derrape, fuego del turbo, explosiones, rebufo, estrella.
		const dot = spriteTexture();
		const sparkPool: Array<{s: THREE.Sprite; life: number; vx: number; vy: number; vz: number}> = [];
		for (let k = 0; k < 70; k++) {
			const s = new THREE.Sprite(new THREE.SpriteMaterial({map: dot, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
			s.visible = false;
			fx.add(s);
			sparkPool.push({s, life: 0, vx: 0, vy: 0, vz: 0});
		}
		let sparkNext = 0;
		const emit = (x: number, y: number, z: number, color: number, size: number, life: number, vx = 0, vy = 0, vz = 0) => {
			const p = sparkPool[sparkNext];
			sparkNext = (sparkNext + 1) % sparkPool.length;
			p.s.position.set(x, y, z);
			p.s.scale.setScalar(size);
			(p.s.material as THREE.SpriteMaterial).color.setHex(color);
			(p.s.material as THREE.SpriteMaterial).opacity = 1;
			p.s.visible = true;
			p.life = life;
			p.vx = vx;
			p.vy = vy;
			p.vz = vz;
		};
		const booms: Array<{mesh: THREE.Mesh; at: number; big: boolean}> = [];
		const boomGeo = new THREE.SphereGeometry(1, 18, 12);
		const seenBooms = new Set<number>();
		const starAura = new THREE.Sprite(new THREE.SpriteMaterial({map: dot, color: 0xffee55, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8}));
		starAura.visible = false;
		fx.add(starAura);

		// Estado local.
		const me = {lap: 0, quarter: 3, visited: 0, coins: 0, item: null as KartItem | null, count: 0, rollUntil: 0, rollFace: 0, finished: false,
			draft: 0, wrong: 0, lastStun: 0, throttleAt: 0, earlyStart: false, startDone: false, placed: 0, lastTier: 0, wasBoost: false, banner: '' as string, bannerUntil: 0, lastBox: 0, starUntil: 0};
		const hitTraps = new Set<string>();
		const map = mapGeometry(t);
		let hudAt = 0;
		let countPlayed = -1;
		const ordinalColor = (id: string) => COLORS[Math.max(0, ctx.state.players.indexOf(id)) % COLORS.length];
		const showBanner = (text: string, ms = 1800) => {
			me.banner = text;
			me.bannerUntil = performance.now() + ms;
		};
		setKartHud({active: true, laps: KART_LAPS, mapPath: map.path, item: null, rolling: null, coins: 0, lap: 1, countdown: null, banner: null, finished: false, place: ctx.state.players.length, racers: ctx.state.players.length});

		const myPlace = (c: PartyCtx): number => {
			const laps = lapsOf(c.state.g);
			const pos = c.positions();
			const self = c.engine.myState();
			const mine = progress(t, self.x, self.z, me.lap);
			const done = c.state.order.length;
			if (me.finished) return Math.max(1, c.state.order.indexOf(c.meId) + 1);
			const ahead = c.state.players.filter((id) => id !== c.meId && !c.state.order.includes(id) && pos[id] && progress(t, pos[id].x, pos[id].z, laps[id] ?? 0) > mine).length;
			return done + ahead + 1;
		};

		return {
			group,
			clamp: (p) => clampToTrack(t, p),
			spectatorClamp: (p) => clampToTrack(t, p),
			spectatorSpot: [trackAt(t, 12, 0).x, trackAt(t, 12, 0).z],
			ground: (x, z) => heightAt(t, x, z),
			outY: -60,
			drive: () => {
				const g = getParty()?.g ?? ctx.state.g;
				const self = ctx.engine.myState();
				const side = nearest(t, self.x, self.z).side;
				const star = hasStar(g, ctx.meId);
				return {top: TOP * (1 + me.coins * 0.009) * (star ? 1.12 : 1), spin: isSpinning(g, ctx.meId) && !star, offroad: Math.abs(side) > t.half + 0.4 && !star};
			},
			action(c) {
				if (!me.item || performance.now() < me.rollUntil || c.state.phase !== 'play' || me.finished) return true;
				const s = c.engine.myState();
				const item = me.item;
				const from = {x: s.x, y: s.y, z: s.z, ry: s.ry};
				if (item === 'banana' || item === 'banana3') {
					c.send({drop: [s.x - Math.sin(s.ry) * 2.2, s.y, s.z - Math.cos(s.ry) * 2.2]});
					worldSounds.play('kartDrop');
				} else if (item === 'bola' || item === 'misil' || item === 'misil3' || item === 'cometa') {
					c.send({shoot: item === 'misil3' ? 'misil' : item, from});
					worldSounds.play('kartMissile');
				} else if (item === 'turbo' || item === 'turbo3') {
					c.engine.kartBoost(1.4, 1.55);
					worldSounds.play('kartBoost');
					setKartHud({flash: performance.now()});
				} else if (item === 'estrella') {
					me.starUntil = performance.now() + 7500;
					c.engine.kartBoost(7.5, 1.12);
					c.send({star: true});
					worldSounds.play('kartBoost');
				} else if (item === 'moneda') {
					me.coins = Math.min(10, me.coins + 2);
					worldSounds.play('kartCoin');
				}
				me.count -= 1;
				if (me.count <= 0) {
					me.item = null;
					me.count = 0;
				}
				return true;
			},
			update(c, dt, time) {
				const g = c.state.g;
				const now = performance.now();
				const hnow = hostNow();
				sky.position.copy(camera.position);
				const playing = c.state.players.includes(c.meId);
				const self = c.engine.myState();

				// Cajas que giran (se rompen al pasar y vuelven a los 2 segundos).
				for (const b of boxSlots) {
					const visible = now > b.back;
					b.obj.visible = visible;
					b.q.visible = visible;
					if (!visible) continue;
					b.obj.position.set(b.x, b.y + 1.25 + Math.sin(time * 2.2 + b.x) * 0.18, b.z);
					b.obj.rotation.set(Math.sin(time * 1.1) * 0.35, time * 1.5, 0.3);
					// El "?" adentro siempre mirando a la cámara.
					b.q.position.copy(b.obj.position);
					b.q.rotation.y = Math.atan2(camera.position.x - b.x, camera.position.z - b.z);
				}
				for (const m of coinSlots) {
					m.obj.visible = now > m.back;
					m.obj.position.set(m.x, m.y + 0.75, m.z);
					m.obj.rotation.y = time * 3 + m.x;
				}

				// Bananas en el piso.
				const traps = (g.traps as Trap[]) ?? [];
				const liveTraps = new Set(traps.map((x) => x.id));
				for (const [id, mesh] of trapMeshes) {
					if (liveTraps.has(id)) continue;
					mesh.removeFromParent();
					trapMeshes.delete(id);
				}
				for (const trap of traps) {
					if (trapMeshes.has(trap.id)) continue;
					const b = itemClone(items, 'Banana');
					b.position.set(trap.x, trap.y + 0.02, trap.z);
					b.rotation.y = Math.random() * 6;
					b.scale.setScalar(1.25);
					group.add(b);
					trapMeshes.set(trap.id, b);
				}

				// Proyectiles: se mueven suave hacia donde dice el host (y un poco más adelante).
				const projs = (g.proj as Proj[]) ?? [];
				const ahead = Math.min(0.25, Math.max(0, (hnow - ((g.projAt as number) ?? hnow)) / 1000));
				const liveProj = new Set(projs.map((p) => p.id));
				for (const [id, mesh] of projMeshes) {
					if (liveProj.has(id)) continue;
					mesh.removeFromParent();
					projMeshes.delete(id);
				}
				for (const pr of projs) {
					let mesh = projMeshes.get(pr.id);
					const tx = pr.x + pr.vx * ahead;
					const tz = pr.z + pr.vz * ahead;
					if (!mesh) {
						mesh = itemClone(items, pr.kind === 'misil' ? 'Misil' : pr.kind === 'bola' ? 'Bola' : 'Cometa');
						mesh.scale.setScalar(pr.kind === 'misil' ? 1.1 : 1.3);
						mesh.position.set(tx, pr.y, tz);
						group.add(mesh);
						projMeshes.set(pr.id, mesh);
					}
					const k = 1 - Math.pow(0.0005, dt);
					mesh.position.x += (tx - mesh.position.x) * k;
					mesh.position.z += (tz - mesh.position.z) * k;
					mesh.position.y += (pr.y - mesh.position.y) * k;
					if (Math.hypot(pr.vx, pr.vz) > 0.5) mesh.rotation.y = Math.atan2(pr.vx, pr.vz) - Math.PI / 2;
					if (pr.kind === 'bola') mesh.children[0].rotation.z -= dt * 12;
					if (pr.kind === 'cometa') mesh.children[0].rotation.y += dt * 8;
					if (Math.random() < 0.6) emit(mesh.position.x, mesh.position.y + 0.1, mesh.position.z, pr.kind === 'misil' ? 0xff7a2a : pr.kind === 'cometa' ? 0x66aaff : 0xffffff, 0.45, 0.35);
				}

				// Explosiones.
				for (const b of (g.booms as Boom[]) ?? []) {
					if (seenBooms.has(b.at + b.x)) continue;
					seenBooms.add(b.at + b.x);
					if (hnow - b.at > 1500) continue;
					const mesh = new THREE.Mesh(boomGeo, new THREE.MeshBasicMaterial({color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false}));
					mesh.position.set(b.x, b.y + 0.5, b.z);
					fx.add(mesh);
					booms.push({mesh, at: now, big: Boolean(b.big)});
					for (let k = 0; k < 14; k++) emit(b.x, b.y + 0.6, b.z, k % 2 ? 0xffd23f : 0xff5a2a, 0.7, 0.6, (Math.random() - 0.5) * 9, Math.random() * 7, (Math.random() - 0.5) * 9);
					const d = Math.hypot(b.x - self.x, b.z - self.z);
					if (d < 60) worldSounds.play('kartExplode', Math.max(0.25, 1 - d / 60));
				}
				for (let k = booms.length - 1; k >= 0; k--) {
					const b = booms[k];
					const age = (now - b.at) / 1000;
					const size = (b.big ? 5 : 2.4) * Math.min(1, age * 5);
					b.mesh.scale.setScalar(size);
					(b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - age * 1.6);
					if (age > 0.6) {
						b.mesh.removeFromParent();
						(b.mesh.material as THREE.Material).dispose();
						booms.splice(k, 1);
					}
				}

				// Partículas.
				for (const p of sparkPool) {
					if (!p.s.visible) continue;
					p.life -= dt;
					if (p.life <= 0) {
						p.s.visible = false;
						continue;
					}
					p.s.position.x += p.vx * dt;
					p.s.position.y += p.vy * dt;
					p.s.position.z += p.vz * dt;
					p.vy -= 9 * dt;
					(p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, p.life * 3);
				}

				if (!playing) {
					setKartHud({active: false});
					return;
				}

				// Antes de largar: en la grilla, mirando para adelante.
				if (c.state.phase === 'intro') {
					if (now - me.placed > 700) {
						me.placed = now;
						const s = grid(t, c.state.players.length - 1 - c.state.players.indexOf(c.meId));
						const at = trackAt(t, s.i, s.side);
						c.engine.teleport(at.x, at.z, headingAt(t, s.i));
					}
					const left = (c.state.phaseEnds - hnow) / 1000;
					const shown = left <= 3 ? Math.max(1, Math.ceil(left)) : null;
					if (shown !== null && shown !== countPlayed) {
						countPlayed = shown;
						worldSounds.play('kartCount');
					}
					// Salida turbo: acelerar entre el "2" y el "1" (antes de eso, te quedás).
					const held = c.engine.kartThrottle();
					if (held && !me.throttleAt) {
						me.throttleAt = left;
						me.earlyStart = left > 2.15;
					}
					if (!held) me.throttleAt = 0;
					setKartHud({countdown: shown});
				} else if (c.state.phase === 'play' && !me.startDone) {
					me.startDone = true;
					worldSounds.play('kartGo');
					setKartHud({countdown: 0});
					window.setTimeout(() => setKartHud({countdown: null}), 900);
					if (me.throttleAt && !me.earlyStart && me.throttleAt <= 2.15) {
						c.engine.kartBoost(1.1, 1.5);
						worldSounds.play('kartBoost');
						setKartHud({flash: now});
					} else if (me.earlyStart) {
						// Aceleró antes de tiempo: se le ahoga el motor un ratito.
						c.engine.kartBoost(0, 1);
						c.send({stall: true});
					}
				}
				worldSounds.setEngine(c.state.phase === 'play' || c.state.phase === 'intro' ? Math.min(1, Math.abs(c.engine.kartSpeed) / (TOP * 1.4)) : null);
				if (c.state.phase !== 'play') return;

				const near = nearest(t, self.x, self.z);
				// Vueltas: hay que pasar por los cuatro cuartos, en orden.
				const quarter = Math.floor((near.i / t.n) * 4);
				if (quarter !== me.quarter) {
					if (quarter === (me.quarter + 1) % 4) {
						if (quarter === 0) {
							if (me.visited === 0b1110 || me.lap === 0) {
								if (me.visited === 0b1110) {
									me.lap += 1;
									c.send({lap: me.lap});
									if (me.lap >= KART_LAPS && !me.finished) {
										me.finished = true;
										c.send({finish: true});
										worldSounds.play('kartFinish');
										showBanner('¡META!', 4000);
									} else if (me.lap === KART_LAPS - 1) {
										worldSounds.play('kartLap');
										showBanner('VUELTA FINAL', 2200);
									} else {
										worldSounds.play('kartLap');
										showBanner(`VUELTA ${me.lap + 1}`, 1500);
									}
								}
							}
							me.visited = 0;
						} else me.visited |= 1 << quarter;
					}
					me.quarter = quarter;
				}
				// Sentido contrario.
				const dirDot = Math.sin(self.ry) * t.tx[near.i] + Math.cos(self.ry) * t.tz[near.i];
				me.wrong = dirDot < -0.35 && Math.abs(c.engine.kartSpeed) > 4 ? me.wrong + dt : 0;

				if (!me.finished) {
					// Cajas.
					for (const b of boxSlots) {
						if (now < b.back || Math.hypot(b.x - self.x, b.z - self.z) > 1.7 || Math.abs(b.y - self.y) > 3) continue;
						b.back = now + 2000;
						worldSounds.play('kartBox');
						for (let k = 0; k < 10; k++) emit(b.x, b.y + 1.2, b.z, [0xff4fa8, 0xffd23f, 0x3fa4ff, 0x45e07a][k % 4], 0.5, 0.5, (Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8);
						if (!me.item && now > me.rollUntil) {
							const place = myPlace(c);
							const fraction = c.state.players.length > 1 ? (place - 1) / (c.state.players.length - 1) : 0;
							me.item = rollItem(fraction);
							me.count = ITEM_COUNT[me.item];
							me.rollUntil = now + 1400;
						}
					}
					// Monedas.
					for (const m of coinSlots) {
						if (now < m.back || Math.hypot(m.x - self.x, m.z - self.z) > 1.5) continue;
						m.back = now + 14000;
						if (me.coins < 10) me.coins += 1;
						worldSounds.play('kartCoin');
					}
				}
				// Flechas de turbo.
				for (const [idx, side] of t.pads) {
					const at = trackAt(t, idx, side);
					if (Math.hypot(at.x - self.x, at.z - self.z) < 2.2 && !c.engine.kartBoosting()) {
						c.engine.kartBoost(1.0, 1.5);
						worldSounds.play('kartBoost');
					}
				}
				// Bananas (las aviso yo: así no hay demora).
				const star = hasStar(g, c.meId) || now < me.starUntil;
				for (const trap of traps) {
					if (hitTraps.has(trap.id) || Math.hypot(trap.x - self.x, trap.z - self.z) > 1.1) continue;
					hitTraps.add(trap.id);
					c.send({trap: trap.id});
				}
				// Me pegaron: pierdo monedas.
				const stun = stunnedAt(g, c.meId);
				if (stun !== null && stun !== me.lastStun && !star) {
					me.lastStun = stun;
					me.coins = Math.max(0, me.coins - 3);
					worldSounds.play('kartSlip');
					for (let k = 0; k < 3; k++) emit(self.x, self.y + 1, self.z, 0xffd23f, 0.6, 0.8, (Math.random() - 0.5) * 6, 5, (Math.random() - 0.5) * 6);
				}
				// Chocar la baranda.
				if (c.engine.kartBumped > 0) {
					worldSounds.play('kartWall', Math.min(1, c.engine.kartBumped / TOP));
					c.engine.kartBumped = 0;
				}
				// Rebufo: detrás de otro auto un rato = turbo.
				const pos = c.positions();
				const fwdX = Math.sin(self.ry);
				const fwdZ = Math.cos(self.ry);
				let drafting = false;
				if (c.engine.kartSpeed > 14) {
					for (const id of c.state.players) {
						if (id === c.meId || !pos[id]) continue;
						const dx = pos[id].x - self.x;
						const dz = pos[id].z - self.z;
						const along = dx * fwdX + dz * fwdZ;
						const across = Math.abs(dx * fwdZ - dz * fwdX);
						if (along > 2.5 && along < 13 && across < 1.6) drafting = true;
					}
				}
				me.draft = drafting ? me.draft + dt : Math.max(0, me.draft - dt * 2);
				if (drafting && Math.random() < 0.5) emit(self.x + fwdX * 3 + (Math.random() - 0.5) * 2, self.y + 0.5 + Math.random() * 1.2, self.z + fwdZ * 3, 0xffffff, 0.12, 0.3, -fwdX * 30, 0, -fwdZ * 30);
				if (me.draft > 1.6) {
					me.draft = 0;
					c.engine.kartBoost(1.1, 1.42);
					worldSounds.play('kartBoost', 0.8);
				}

				// Chispas del derrape (de las ruedas de atrás) y fuego del turbo.
				const drift = c.engine.kartDrift();
				const backX = self.x - fwdX * 0.9;
				const backZ = self.z - fwdZ * 0.9;
				if (drift.tier > 0) {
					const color = [0, 0x55a8ff, 0xffa020, 0xc070ff][drift.tier];
					for (const s of [-1, 1]) emit(backX + fwdZ * 0.6 * s, self.y + 0.15, backZ - fwdX * 0.6 * s, color, 0.32 + drift.tier * 0.06, 0.18, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
					if (drift.tier !== me.lastTier) worldSounds.play('kartSpark', 0.6);
				}
				const boosting = c.engine.kartBoosting();
				if (me.lastTier > 0 && drift.dir === 0 && boosting) {
					worldSounds.play('kartMiniTurbo');
					setKartHud({flash: now});
				}
				me.lastTier = drift.tier;
				if (boosting) {
					for (const s of [-1, 1]) emit(backX + fwdZ * 0.3 * s - fwdX * 0.4, self.y + 0.45, backZ - fwdX * 0.3 * s - fwdZ * 0.4, Math.random() < 0.5 ? 0xff7a1a : 0xffd23f, 0.55, 0.16, -fwdX * 6, 1, -fwdZ * 6);
				}
				// Aura de la estrella (para todos los que la tienen, yo incluido).
				starAura.visible = star;
				if (star) {
					starAura.position.set(self.x, self.y + 0.9, self.z);
					starAura.scale.setScalar(3.2 + Math.sin(time * 18) * 0.3);
					(starAura.material as THREE.SpriteMaterial).color.setHSL((time * 2) % 1, 0.9, 0.6);
				}

				// HUD (10 veces por segundo).
				if (now - hudAt > 100) {
					hudAt = now;
					const rolling = now < me.rollUntil;
					if (rolling && now - me.rollFace > 90) {
						me.rollFace = now;
						worldSounds.play('kartRoll', 0.5);
					}
					if (!rolling && me.rollFace && me.item && now - me.rollFace < 300) worldSounds.play('kartItem');
					const laps = lapsOf(g);
					const dots = c.state.players.filter((id) => pos[id] || id === c.meId).map((id) => {
						const p = id === c.meId ? self : pos[id];
						const [x, y] = map.toMap(p.x, p.z);
						return {id, x, y, me: id === c.meId, color: ordinalColor(id)};
					});
					void laps;
					setKartHud({
						item: me.item,
						count: me.count,
						rolling: rolling ? ROLL_FACES[Math.floor(now / 90) % ROLL_FACES.length] : null,
						coins: me.coins,
						lap: Math.min(KART_LAPS, me.lap + 1),
						place: myPlace(c),
						racers: c.state.players.length,
						banner: now < me.bannerUntil ? me.banner : null,
						wrongWay: me.wrong > 1.2,
						finished: me.finished,
						dots,
					});
				}
			},
			dispose: () => {
				disposed = true;
				camera.far = oldFar;
				camera.updateProjectionMatrix();
				worldSounds.setEngine(null);
				resetKartHud();
				for (const p of sparkPool) (p.s.material as THREE.Material).dispose();
				dot.dispose();
				boomGeo.dispose();
				group.traverse((o) => {
					const mesh = o as THREE.Mesh;
					// Las texturas y geometrías del GLB quedan en caché (se reusan en la próxima carrera).
					if (mesh.isMesh && mesh.geometry === boomGeo) return;
				});
				group.removeFromParent();
			},
		};
	},
	hostInput(from, a, ctx) {
		const g = ctx.state.g;
		const t = trackOf(g);
		if (typeof a.lap === 'number') ctx.setG({laps: {...lapsOf(g), [from]: a.lap}});
		const drop = a.drop as [number, number, number] | undefined;
		if (drop) {
			const traps = ((g.traps as Trap[]) ?? []).slice(-13);
			ctx.setG({traps: [...traps, {id: `${from}:${Date.now()}`, x: drop[0], y: drop[1], z: drop[2]}]});
		}
		if (typeof a.trap === 'string') {
			const traps = (g.traps as Trap[]) ?? [];
			const trap = traps.find((x) => x.id === a.trap);
			if (trap) {
				ctx.setG({traps: traps.filter((x) => x !== trap)});
				const booms: Boom[] = [];
				hostStun(ctx, from, booms, trap);
			}
		}
		if (typeof a.shoot === 'string' && a.from) spawnProj(ctx, t, from, a.shoot as Proj['kind'], a.from as {x: number; y: number; z: number; ry: number});
		if (a.star) ctx.setG({star: {...((g.star as Record<string, number>) ?? {}), [from]: Date.now() + 7500}});
		if (a.stall) ctx.setG({stun: {...((g.stun as Record<string, number>) ?? {}), [from]: Date.now() - SPIN_MS + 700}});
	},
	hostTick(ctx, dt) {
		hostSim(ctx, Math.min(0.1, dt || 0.05));
	},
	bot(b, ctx, dt, time) {
		botDrive(b, ctx, dt, time);
	},
	rank(s) {
		const t = trackOf(s.g);
		const groups = s.order.map((id) => [id]);
		const laps = lapsOf(s.g);
		const rest = s.players.filter((p) => !s.order.includes(p));
		void t;
		rest.sort((a, b) => (laps[b] ?? 0) - (laps[a] ?? 0));
		for (const id of rest) groups.push([id]);
		return groups;
	},
};

// ------------------------------------------------------------------------- bots -----

function botDrive(b: HostBot, ctx: HostCtx, dt: number, time: number): void {
	const g = ctx.state.g;
	const t = trackOf(g);
	if (ctx.state.order.includes(b.id) || ctx.state.phase !== 'play') {
		if (ctx.state.phase === 'intro') {
			const s = grid(t, ctx.state.players.length - 1 - ctx.state.players.indexOf(b.id));
			b.ry = headingAt(t, s.i);
		}
		b.anim = 'idle';
		return;
	}
	if (isSpinning(g, b.id) && !hasStar(g, b.id)) {
		b.ry += dt * 13;
		b.brain.speed = 0;
		return;
	}
	const near = nearest(t, b.x, b.z);
	const brain = b.brain as Record<string, number>;
	brain.lane ??= (Math.random() - 0.5) * 6;
	if ((brain.laneAt ?? 0) < time) {
		brain.lane = THREE.MathUtils.clamp(brain.lane + (Math.random() - 0.5) * 3, -t.half + 1.2, t.half - 1.2);
		brain.laneAt = time + 1.5 + Math.random() * 2;
	}
	brain.skill ??= 0.86 + Math.random() * 0.07;
	brain.lap ??= 0;
	brain.q ??= 3;
	brain.vis ??= 0;
	// Ritmo: los de atrás aprietan un poco más, los de adelante aflojan (como en los juegos de karting).
	const racers = racerProgress(ctx, t).sort((x, y) => y.p - x.p);
	const mine = racers.find((r) => r.id === b.id)?.p ?? 0;
	const humans = racers.filter((r) => !r.id.startsWith('abot:'));
	const bestHuman = humans.length ? humans[0].p : mine;
	const band = THREE.MathUtils.clamp((bestHuman - mine) / 60, -1, 1);
	let target = TOP * brain.skill * (1 + band * 0.07);
	if ((brain.boostUntil ?? 0) > time) target *= 1.45;
	if (hasStar(g, b.id)) target *= 1.15;
	brain.speed = (brain.speed ?? 0) + THREE.MathUtils.clamp(target - (brain.speed ?? 0), -30 * dt, 16 * dt);
	const look = trackAt(t, near.i + 7 + brain.speed * 0.15, brain.lane);
	ctx.moveBot(b, look.x, look.z, brain.speed, dt);
	b.anim = 'run';
	// Vueltas.
	const quarter = Math.floor((near.i / t.n) * 4);
	if (quarter !== brain.q) {
		if (quarter === (brain.q + 1) % 4) {
			if (quarter === 0) {
				if (brain.vis === 0b1110) {
					brain.lap += 1;
					ctx.setG({laps: {...lapsOf(ctx.state.g), [b.id]: brain.lap}});
					if (brain.lap >= KART_LAPS) ctx.finish(b.id);
				}
				brain.vis = 0;
			} else brain.vis |= 1 << quarter;
		}
		brain.q = quarter;
	}
	// Cajas: agarran un poder según el puesto y lo usan al rato.
	if (!brain.item && t.boxes.some((idx) => Math.abs(near.i - idx) < 1.5)) {
		const items: KartItem[] = ['banana', 'bola', 'misil', 'turbo', 'estrella', 'cometa'];
		const pick = rollItem(placeFraction(ctx, t, b.id));
		brain.item = Math.max(1, items.indexOf(pick.replace('3', '') as KartItem) + 1);
		brain.useAt = time + 1.5 + Math.random() * 4;
	}
	if (brain.item && time > (brain.useAt ?? 0)) {
		const kind = ['banana', 'bola', 'misil', 'turbo', 'estrella', 'cometa'][brain.item - 1];
		const from = {x: b.x, y: b.y, z: b.z, ry: b.ry};
		if (kind === 'banana') {
			const traps = ((ctx.state.g.traps as Trap[]) ?? []).slice(-13);
			ctx.setG({traps: [...traps, {id: `${b.id}:${Date.now()}`, x: b.x - Math.sin(b.ry) * 2.2, y: b.y, z: b.z - Math.cos(b.ry) * 2.2}]});
		} else if (kind === 'turbo') brain.boostUntil = time + 1.4;
		else if (kind === 'estrella') ctx.setG({star: {...((ctx.state.g.star as Record<string, number>) ?? {}), [b.id]: Date.now() + 7500}});
		else if (kind === 'bola' || kind === 'misil' || kind === 'cometa') spawnProj(ctx, t, b.id, kind, from);
		brain.item = 0;
	}
}
