/**
 * Los 11 juegos de la Arena. Cada juego:
 *  - arma su escenario (todo redondito, brillante y de colores fuertes),
 *  - dice dónde hay piso (para caerse), los límites y qué pasa con MI personaje cada cuadro,
 *  - y tiene su lógica de host (bots, reglas, puntos).
 *
 * Lo que se mueve solo (barras, frutas, barriles, colores) se calcula con la semilla + el tiempo de
 * la partida: es igual en todas las PCs sin mandarlo por la red.
 */
import * as THREE from 'three';
import type {WorldEngine} from '@/world/engine';
import {bombBoom, bombPass, bombTick} from '@/world/partySounds';
import {worldSounds} from '@/world/worldSounds';
import {kart} from '@/world/kart/kartGame';
import {getParty, type HostBot, type HostCtx, hostNow, mulberry, type PartyState, pushBot, sendPush} from '@/world/party';

export type GameId = 'race' | 'floor' | 'king' | 'bomb' | 'fruit' | 'colors' | 'soccer' | 'paint' | 'boat' | 'kart';

export interface PartyCtx {
	state: PartyState;
	meId: string;
	engine: WorldEngine;
	t: number;
	send(a: Record<string, unknown>): void;
	push(target: string, dx: number, dz: number, power: number): void;
	positions(): Record<string, {x: number; y: number; z: number}>;
}

export interface GameScene {
	group: THREE.Group;
	clamp?(p: THREE.Vector3): THREE.Vector3;
	support?(x: number, z: number, t: number): boolean;
	update(ctx: PartyCtx, dt: number, t: number): void;
	action?(ctx: PartyCtx): boolean;
	/** En vez de quedar afuera al caerse, volvés a un punto (la carrera). */
	respawn?(ctx: PartyCtx): [number, number];
	/** Mensaje grande para mí. */
	overlay?(ctx: PartyCtx): string | null;
	/** Cartelito chico arriba (vuelta, puesto, poder), sin tapar la pantalla. */
	hud?(ctx: PartyCtx): string | null;
	/** Varios pisos: altura del piso debajo de (x, y, z) o null. */
	ground?(x: number, z: number, y: number, t: number): number | null;
	/** Por debajo de esta altura quedás afuera (por defecto -3.5). */
	outY?: number;
	/** Mapas grandes: dónde quedan los que ya no juegan (mirando), en vez del lobby de la Arena. */
	spectatorClamp?(p: THREE.Vector3): THREE.Vector3;
	/** Dónde aparecen los que miran. */
	spectatorSpot?: [number, number];
	speed?: number;
	/** Karting: manejo con aceleración y cámara detrás (ver WorldMode.drive). */
	drive?(): {top: number; spin?: boolean} | null;
	dispose(): void;
}

export interface GameDef {
	id: GameId;
	name: string;
	desc: string;
	how: string;
	color: string;
	duration: number;
	kind: 'elim' | 'race' | 'score' | 'team';
	/** Al caerse, el bot vuelve (no queda afuera). */
	respawns?: boolean;
	/** Mapa propio y grande: mientras se juega no se ve el estadio de la Arena. */
	bigMap?: boolean;
	spawn(index: number, count: number, g: Record<string, unknown>): [number, number];
	build(ctx: PartyCtx): GameScene;
	hostSetup?(players: string[], seed: number): Record<string, unknown>;
	hostTick?(ctx: HostCtx, dt: number, t: number): void;
	hostInput?(from: string, a: Record<string, unknown>, ctx: HostCtx, t: number): void;
	bot?(b: HostBot, ctx: HostCtx, dt: number, t: number): void;
	rank(s: PartyState): string[][];
}

// --------------------------------------------------------------- ayudas ---

const R = 8.5;
const COLORS = [0xff4fa8, 0xffd23f, 0x3fa4ff, 0x45e07a, 0xa066ff, 0xff8a2a];
const COLOR_NAMES = ['ROSA', 'AMARILLO', 'AZUL', 'VERDE', 'VIOLETA', 'NARANJA'];

function glossy(color: number, emissive = 0): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({color, roughness: 0.28, metalness: 0.02, emissive: color, emissiveIntensity: emissive});
}

function disposeGroup(group: THREE.Group): void {
	group.traverse((o) => {
		const m = o as THREE.Mesh;
		m.geometry?.dispose();
		const mat = m.material as THREE.Material | THREE.Material[] | undefined;
		if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
		else mat?.dispose();
	});
	group.removeFromParent();
}

function circleClamp(radius: number): (p: THREE.Vector3) => THREE.Vector3 {
	return (p) => {
		const d = Math.hypot(p.x, p.z);
		if (d > radius) {
			p.x *= radius / d;
			p.z *= radius / d;
		}
		return p;
	};
}

function ring(index: number, count: number, radius: number): [number, number] {
	const a = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
	return [Math.cos(a) * radius, Math.sin(a) * radius];
}

/** Ranking de eliminación: los que quedan vivos ganan; después, el orden inverso en que cayeron. */
function elimRank(s: PartyState): string[][] {
	const groups: string[][] = [];
	if (s.alive.length) groups.push([...s.alive]);
	for (const id of [...s.order].reverse()) groups.push([id]);
	return groups;
}

function teamRank(s: PartyState, teams: Record<string, string>, scoreOf: (team: string) => number): string[][] {
	const a = scoreOf('a');
	const b = scoreOf('b');
	const ids = (team: string) => s.players.filter((p) => teams[p] === team);
	if (a === b) return [s.players];
	return a > b ? [ids('a'), ids('b')] : [ids('b'), ids('a')];
}

/** Colores de los equipos (a, b, c…): rosa, azul y después los demás. */
export const TEAM_COLORS: Record<string, number> = {a: 0xff4fa8, b: 0x3fa4ff, c: 0xffd23f, d: 0x45e07a, e: 0xa066ff, f: 0xff8a2a, g: 0x2ee6d6, h: 0xff5e5e, i: 0x8d6b4a, j: 0xffffff};

/** Con jugadores impares (3, 5…) cada uno juega solo con su color (si no, quedaba un equipo de más). */
function teamsOrSolo(players: string[]): Record<string, string> {
	if (players.length % 2 === 0) return teamsFor(players);
	const letters = 'abcdefghij';
	return Object.fromEntries(players.map((p, i) => [p, letters[i % letters.length]]));
}

/** Ranking con cualquier cantidad de equipos: el que más tiene primero. */
function multiTeamRank(s: PartyState, teams: Record<string, string>, scoreOf: (team: string) => number): string[][] {
	const names = [...new Set(s.players.map((p) => teams[p]).filter(Boolean))];
	const sorted = names.sort((x, y) => scoreOf(y) - scoreOf(x));
	const groups: string[][] = [];
	let i = 0;
	while (i < sorted.length) {
		const score = scoreOf(sorted[i]);
		const tied = sorted.filter((t) => scoreOf(t) === score);
		groups.push(s.players.filter((p) => tied.includes(teams[p])));
		i += tied.length;
	}
	return groups;
}

function teamsFor(players: string[]): Record<string, string> {
	const pick: Record<string, string> = {};
	const shuffled = [...players].sort(() => Math.random() - 0.5);
	shuffled.forEach((p, i) => (pick[p] = i % 2 ? 'b' : 'a'));
	// En el orden de los jugadores (así el índice de cada uno sirve para ubicarlo al arrancar).
	const teams: Record<string, string> = {};
	for (const p of players) teams[p] = pick[p];
	return teams;
}

/** Textura "de golosina" para los pisos: rayas, cuadros, lunares o rayos de sol. */
function candyTexture(pattern: 'stripes' | 'checker' | 'dots' | 'rays', a: string, b: string, repeat = 1): THREE.CanvasTexture {
	const size = 512;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const c = canvas.getContext('2d')!;
	c.fillStyle = a;
	c.fillRect(0, 0, size, size);
	c.fillStyle = b;
	if (pattern === 'stripes') {
		for (let i = -size; i < size * 2; i += 64) {
			c.beginPath();
			c.moveTo(i, 0);
			c.lineTo(i + 32, 0);
			c.lineTo(i + 32 - size, size);
			c.lineTo(i - size, size);
			c.fill();
		}
	} else if (pattern === 'checker') {
		for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) c.fillRect(x * 64, y * 64, 64, 64);
	} else if (pattern === 'dots') {
		for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
			c.beginPath();
			c.arc(x * 64 + (y % 2 ? 32 : 0), y * 64 + 32, 15, 0, Math.PI * 2);
			c.fill();
		}
	} else {
		for (let k = 0; k < 16; k += 2) {
			c.beginPath();
			c.moveTo(size / 2, size / 2);
			c.arc(size / 2, size / 2, size, (k / 16) * Math.PI * 2, ((k + 1) / 16) * Math.PI * 2);
			c.fill();
		}
	}
	// Brillito suave en el centro (que no se vea "plano").
	const glow = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.7);
	glow.addColorStop(0, 'rgba(255,255,255,0.22)');
	glow.addColorStop(1, 'rgba(255,255,255,0)');
	c.fillStyle = glow;
	c.fillRect(0, 0, size, size);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(repeat, repeat);
	texture.anisotropy = 8;
	return texture;
}

/** Piso acolchado con textura y borde inflable. Redondo (radio) o cuadrado (lado/2). */
function candyFloor(shape: 'round' | 'square', half: number, pattern: 'stripes' | 'checker' | 'dots' | 'rays', a: string, b: string, rim = 0xffd23f): THREE.Group {
	const g = new THREE.Group();
	const top = new THREE.MeshStandardMaterial({map: candyTexture(pattern, a, b, pattern === 'rays' ? 1 : 2), roughness: 0.35, metalness: 0.02});
	const side = glossy(0xffffff);
	if (shape === 'round') {
		const base = new THREE.Mesh(new THREE.CylinderGeometry(half, half * 0.96, 0.55, 72), [side, top, side]);
		base.position.y = -0.275;
		base.receiveShadow = true;
		g.add(base);
		const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(half, 0.26, 16, 80), glossy(rim, 0.08));
		ringMesh.rotation.x = Math.PI / 2;
		ringMesh.position.y = 0.04;
		g.add(ringMesh);
	} else {
		const base = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.55, half * 2), [side, side, top, side, side, side]);
		base.position.y = -0.275;
		base.receiveShadow = true;
		g.add(base);
		const bumper = glossy(rim, 0.08);
		for (const [x, z, rot] of [[0, half, 0], [0, -half, 0], [half, 0, 1], [-half, 0, 1]] as const) {
			const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, half * 2 - 0.4, 8, 16), bumper);
			capsule.rotation.z = Math.PI / 2;
			if (rot) capsule.rotation.y = Math.PI / 2;
			capsule.position.set(x, 0.04, z);
			g.add(capsule);
		}
		for (const [x, z] of [[half, half], [half, -half], [-half, half], [-half, -half]]) {
			const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), glossy(0xff4fa8, 0.1));
			ball.position.set(x, 0.2, z);
			g.add(ball);
		}
	}
	return g;
}

function squareClamp(half: number): (p: THREE.Vector3) => THREE.Vector3 {
	return (p) => {
		p.x = THREE.MathUtils.clamp(p.x, -half, half);
		p.z = THREE.MathUtils.clamp(p.z, -half, half);
		return p;
	};
}

function nearestOther(ctx: PartyCtx, maxD: number, filter: (id: string) => boolean = () => true): {id: string; dx: number; dz: number} | null {
	const me = ctx.engine.myState();
	let best: {id: string; dx: number; dz: number} | null = null;
	let bestD = maxD;
	for (const [id, p] of Object.entries(ctx.positions())) {
		if (id === ctx.meId || !ctx.state.players.includes(id) || !ctx.state.alive.includes(id) || !filter(id)) continue;
		const d = Math.hypot(p.x - me.x, p.z - me.z);
		if (d < bestD) {
			bestD = d;
			best = {id, dx: p.x - me.x, dz: p.z - me.z};
		}
	}
	return best;
}

function textSprite(text: string, color: string, width = 3.6): THREE.Sprite {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 160;
	const c = canvas.getContext('2d')!;
	c.fillStyle = color;
	c.beginPath();
	c.roundRect(8, 8, 496, 144, 72);
	c.fill();
	c.lineWidth = 12;
	c.strokeStyle = '#2a1747';
	c.stroke();
	c.fillStyle = '#ffffff';
	c.font = '900 86px "Fredoka", "Segoe UI", sans-serif';
	c.textAlign = 'center';
	c.textBaseline = 'middle';
	c.lineWidth = 10;
	c.strokeText(text, 256, 86);
	c.fillText(text, 256, 86);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, toneMapped: false, depthTest: false}));
	sprite.scale.set(width, width * 0.31, 1);
	sprite.renderOrder = 10;
	return sprite;
}

let pushCooldown = 0;

/** Empujar al que tengo enfrente (cachetada). */
function shove(ctx: PartyCtx, power = 9): boolean {
	if (performance.now() < pushCooldown) return true;
	pushCooldown = performance.now() + 1000;
	const target = nearestOther(ctx, 1.7);
	ctx.engine.emote(ctx.meId, 'slap', target?.id ?? null);
	if (target) ctx.push(target.id, target.dx, target.dz, power);
	return true;
}

// ---------------------------------------------------------------- paisaje ---
// Los mapas grandes (carrera y piso que se cae) tienen su propio cielo, montañas y nubes, estilo
// "programa de juegos" pastel.

function skyDome(top: number, bottom: number): THREE.Mesh {
	const geometry = new THREE.SphereGeometry(140, 32, 16);
	const colors: number[] = [];
	const a = new THREE.Color(top);
	const b = new THREE.Color(bottom);
	const pos = geometry.attributes.position as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		const k = THREE.MathUtils.clamp((pos.getY(i) / 140 + 0.15) / 0.8, 0, 1);
		const c = b.clone().lerp(a, k);
		colors.push(c.r, c.g, c.b);
	}
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false}));
	mesh.renderOrder = -10;
	return mesh;
}

/** Cielo, montañas lavanda de fondo, nubes redonditas y un mar de gelatina abajo. */
function landscape(center: THREE.Vector3, opts: {goo?: number; mountains?: number; spread?: number} = {}): THREE.Group {
	const spread = opts.spread ?? 1;
	const g = new THREE.Group();
	const sky = skyDome(0x5fb8ff, 0xd7f0ff);
	sky.position.copy(center);
	g.add(sky);
	const r = mulberry(77);
	const mountain = [0x9b8cff, 0xb8a8ff, 0x8ec5ff, 0xc9b6ff];
	for (let i = 0; i < (opts.mountains ?? 18); i++) {
		const a = (i / (opts.mountains ?? 18)) * Math.PI * 2 + r() * 0.3;
		const d = (85 + r() * 20) * spread;
		const h = (18 + r() * 26) * Math.sqrt(spread);
		const m = new THREE.Mesh(new THREE.ConeGeometry(10 + r() * 10, h, 5 + Math.floor(r() * 3)), new THREE.MeshStandardMaterial({color: mountain[i % mountain.length], roughness: 0.9, flatShading: true}));
		m.position.set(center.x + Math.cos(a) * d, -14 + h / 2, center.z + Math.sin(a) * d);
		m.rotation.y = r() * 3;
		g.add(m);
		// Nieve en la punta.
		const cap = new THREE.Mesh(new THREE.ConeGeometry((10 + 5) * 0.35, h * 0.25, 5), new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.8, flatShading: true}));
		cap.position.set(m.position.x, -14 + h - h * 0.12, m.position.z);
		g.add(cap);
	}
	const cloudMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25});
	for (let i = 0; i < 14; i++) {
		const cloud = new THREE.Group();
		for (let k = 0; k < 4; k++) {
			const puff = new THREE.Mesh(new THREE.SphereGeometry(2.4 + r() * 1.6, 14, 10), cloudMat);
			puff.position.set(k * 2.6 - 4, r() * 1.2, r() * 1.5);
			cloud.add(puff);
		}
		const a = r() * Math.PI * 2;
		const d = (45 + r() * 40) * spread;
		cloud.position.set(center.x + Math.cos(a) * d, 14 + r() * 16, center.z + Math.sin(a) * d);
		cloud.scale.setScalar(0.8 + r() * 0.8);
		g.add(cloud);
	}
	if (opts.goo !== undefined) {
		const goo = new THREE.Mesh(new THREE.CircleGeometry(180, 48), new THREE.MeshStandardMaterial({color: 0xff7ac8, roughness: 0.25, metalness: 0.05, emissive: 0xff4fa8, emissiveIntensity: 0.15}));
		goo.rotation.x = -Math.PI / 2;
		goo.position.set(center.x, opts.goo, center.z);
		g.add(goo);
	}
	return g;
}

/** Bloque inflable (cajas redonditas). */
function puffyBox(w: number, h: number, d: number, color: number): THREE.Mesh {
	const geometry = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
	const mesh = new THREE.Mesh(geometry, glossy(color, 0.05));
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

// ================================================================= 1 =====
// Carrera de Gomitas: una pista larga con barras que giran, rodillos (hay que correr en contra para
// no caerse), puertas falsas y pelotas que bajan rodando. Llegar primero a la corona.

const COURSE_X = 6;
const RACE_START = -10;
const RACE_FINISH = 112;
/** Secciones (z donde empiezan). */
const SEC_SLIDE = -3;
const SEC_BARS = 18;
const SEC_DRUMS = 44;
const SEC_DOORS = 70;
const SEC_BALLS = 92;
const CHECKPOINTS = [RACE_START + 2, SEC_BARS, SEC_DRUMS, SEC_DOORS, SEC_BALLS];
const BARS = [24, 32, 40];
const BAR_REACH = 5.9;
/** Rodillos: z del centro y para dónde empuja la parte de arriba (-1 = para atrás). */
const DRUMS: Array<{z: number; dir: number}> = [
	{z: 47, dir: -1}, {z: 51, dir: -1}, {z: 55, dir: 1}, {z: 59, dir: -1}, {z: 63, dir: -1}, {z: 67, dir: -1},
];
const DRUM_R = 1.98;
/** Los rodillos van pegados (no hay huecos): el desafío es correr contra el giro. */
const DRUM_HALF = 2.02;
const DRUM_SPEED = 2.6;
const DOOR_ROWS = [76, 85];
const DOOR_W = (COURSE_X * 2) / 5;
const SLIDERS = [2, 7, 12];
const BALL_LANES = [-4.2, -1.4, 1.4, 4.2];

function barAngle(i: number, t: number, seed: number): number {
	const dir = i % 2 ? -1 : 1;
	return dir * (t * (1.2 + i * 0.22)) + (seed % 100) / 16 + i;
}

/** Empujón de una barra que gira (si te toca). */
function barHit(x: number, z: number, t: number, seed: number): {dx: number; dz: number} | null {
	for (let i = 0; i < BARS.length; i++) {
		const a = barAngle(i, t, seed);
		const ux = Math.cos(a);
		const uz = Math.sin(a);
		const rx = x;
		const rz = z - BARS[i];
		const along = rx * ux + rz * uz;
		if (Math.abs(along) > BAR_REACH) continue;
		const perp = -rx * uz + rz * ux;
		if (Math.abs(perp) < 0.5) {
			const dir = i % 2 ? -1 : 1;
			return {dx: -uz * Math.sign(along) * dir, dz: ux * Math.sign(along) * dir};
		}
	}
	return null;
}

/** Puertas abiertas de cada fila (las demás son de mentira: no se pasan). */
function openDoors(seed: number): number[][] {
	const r = mulberry(seed + 9);
	return DOOR_ROWS.map(() => {
		const a = Math.floor(r() * 5);
		let b = Math.floor(r() * 5);
		if (b === a) b = (a + 2) % 5;
		return [a, b];
	});
}

const doorIndex = (x: number) => THREE.MathUtils.clamp(Math.floor((x + COURSE_X) / DOOR_W), 0, 4);

/** Los bloques que van y vienen al principio. */
function sliderX(i: number, t: number): number {
	return Math.sin(t * (0.9 + i * 0.25) + i * 2) * 3.8;
}

/** Pelotas que bajan rodando al final (una por carril). */
function ballZ(lane: number, t: number, seed: number): number {
	const period = 3.4 + lane * 0.45;
	const k = ((t + lane * 1.1 + (seed % 7)) % period) / period;
	return RACE_FINISH - 3 - k * (RACE_FINISH - 3 - SEC_BALLS);
}

function onDrum(z: number): {dir: number} | null {
	for (const d of DRUMS) if (Math.abs(z - d.z) < DRUM_HALF) return d;
	return null;
}

function raceSupport(x: number, z: number): boolean {
	if (Math.abs(x) > COURSE_X + 0.15) return false;
	// Los rodillos están pegados entre sí (no hay huecos donde caerse).
	if (z > SEC_DRUMS + 1 && z < SEC_DOORS - 1) return Boolean(onDrum(z));
	return z >= RACE_START - 3 && z <= RACE_FINISH + 8;
}

function doorClamp(p: THREE.Vector3, open: number[][]): void {
	DOOR_ROWS.forEach((row, k) => {
		if (Math.abs(p.z - row) >= 0.5) return;
		if (open[k].includes(doorIndex(p.x))) return;
		p.z = p.z < row ? row - 0.5 : row + 0.5;
	});
}

const race: GameDef = {
	id: 'race', name: 'Carrera de Gomitas', color: '#ff4fa8', duration: 150, kind: 'race', respawns: true, bigMap: true,
	desc: 'Una pista enorme: bloques que van y vienen, barras que giran, rodillos, puertas falsas y pelotas que bajan. ¡Llegá a la corona!',
	how: 'En los rodillos corré contra el giro para no caerte. Saltá las barras con Espacio. Si te caés, volvés al último punto.',
	spawn: (i) => [((i % 6) - 2.5) * 1.5, RACE_START - Math.floor(i / 6) * 1.3],
	build(ctx) {
		const group = new THREE.Group();
		const seed = ctx.state.seed;
		group.add(landscape(new THREE.Vector3(0, 0, 50), {goo: -6}));
		const floorTop = (z0: number, z1: number, a: string, b: string, pattern: 'stripes' | 'checker' | 'dots' = 'stripes') => {
			const tex = candyTexture(pattern, a, b, 1);
			tex.repeat.set(2, Math.max(1, (z1 - z0) / 6));
			const slab = new THREE.Mesh(new THREE.BoxGeometry(COURSE_X * 2, 1.2, z1 - z0), [glossy(0xffffff), glossy(0xffffff), new THREE.MeshStandardMaterial({map: tex, roughness: 0.35}), glossy(0xffffff), glossy(0xffffff), glossy(0xffffff)]);
			slab.position.set(0, -0.6, (z0 + z1) / 2);
			slab.receiveShadow = true;
			group.add(slab);
		};
		// Tramos de piso (los rodillos tienen huecos).
		floorTop(RACE_START - 3, SEC_SLIDE, '#ff4fa8', '#ffffff', 'checker');
		floorTop(SEC_SLIDE, SEC_BARS, '#5fe3e9', '#8af0f2');
		floorTop(SEC_BARS, SEC_DRUMS + 1, '#a066ff', '#c29bff', 'dots');
		floorTop(SEC_DOORS - 1, SEC_BALLS, '#ffd23f', '#ffe27a');
		floorTop(SEC_BALLS, RACE_FINISH + 8, '#5fe3e9', '#8af0f2');
		// Barandas inflables a los costados (sin tapar los rodillos).
		const rail = glossy(0xff8ac6, 0.08);
		for (const [z0, z1] of [[RACE_START - 3, SEC_DRUMS + 1], [SEC_DOORS - 1, RACE_FINISH + 8]] as const) {
			for (const side of [-1, 1]) {
				const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, z1 - z0 - 0.9, 8, 16), rail);
				tube.rotation.x = Math.PI / 2;
				tube.position.set(side * (COURSE_X + 0.45), 0.35, (z0 + z1) / 2);
				group.add(tube);
			}
		}
		// Flechas en el piso.
		for (const z of [0, 10, 20, 30, 74, 96, 104]) {
			const arrow = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-1.2, -0.6), new THREE.Vector2(0, 0.9), new THREE.Vector2(1.2, -0.6), new THREE.Vector2(0.5, -0.6), new THREE.Vector2(0.5, -1.4), new THREE.Vector2(-0.5, -1.4), new THREE.Vector2(-0.5, -0.6)])), new THREE.MeshBasicMaterial({color: 0xff4fa8, transparent: true, opacity: 0.85}));
			arrow.rotation.x = -Math.PI / 2;
			arrow.position.set(0, 0.02, z);
			group.add(arrow);
		}
		// 1) Bloques que van y vienen.
		const sliders = SLIDERS.map((z) => {
			const block = puffyBox(3, 1.4, 1.3, 0xff4fa8);
			block.position.set(0, 0.7, z);
			group.add(block);
			return block;
		});
		// 2) Barras que giran.
		const bars = BARS.map((z, i) => {
			const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.2, 20), glossy(0xffffff));
			pivot.position.set(0, 0.6, z);
			const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, BAR_REACH * 2 - 0.6, 8, 16), glossy(i % 2 ? 0xff8a2a : 0xffd23f, 0.12));
			bar.rotation.z = Math.PI / 2;
			bar.castShadow = true;
			const holder = new THREE.Group();
			holder.position.set(0, 0.62, z);
			holder.add(bar);
			group.add(pivot, holder);
			return holder;
		});
		// 3) Rodillos rayados (el de arriba se mueve para atrás o para adelante).
		const drums = DRUMS.map((d, i) => {
			const tex = candyTexture('stripes', i % 2 ? '#45e07a' : '#3fa4ff', '#ffffff', 1);
			tex.repeat.set(1, 3);
			const drum = new THREE.Mesh(new THREE.CylinderGeometry(DRUM_R, DRUM_R, COURSE_X * 2, 40), [new THREE.MeshStandardMaterial({map: tex, roughness: 0.3}), glossy(0xffffff), glossy(0xffffff)]);
			drum.rotation.z = Math.PI / 2;
			drum.position.set(0, -DRUM_R, d.z);
			drum.castShadow = true;
			drum.receiveShadow = true;
			group.add(drum);
			// Tapas con flechas de giro.
			for (const side of [-1, 1]) {
				const cap = new THREE.Mesh(new THREE.TorusGeometry(DRUM_R * 0.7, 0.12, 8, 24, Math.PI * 1.4), glossy(0xff4fa8, 0.3));
				cap.rotation.y = Math.PI / 2;
				cap.position.set(side * (COURSE_X + 0.05), -DRUM_R, d.z);
				group.add(cap);
			}
			return drum;
		});
		// 4) Puertas: dos filas de cinco; sólo dos de cada fila se rompen.
		const open = openDoors(seed);
		const doorMeshes: Array<{mesh: THREE.Mesh; open: boolean; row: number; slot: number}> = [];
		DOOR_ROWS.forEach((row, k) => {
			for (let slot = 0; slot < 5; slot++) {
				const x = -COURSE_X + DOOR_W * (slot + 0.5);
				const frame = puffyBox(0.3, 3, 0.6, 0xffffff);
				frame.position.set(x - DOOR_W / 2, 1.5, row);
				group.add(frame);
				const door = puffyBox(DOOR_W - 0.35, 2.6, 0.35, [0x3fa4ff, 0xa066ff, 0x45e07a, 0xff8a2a, 0xffd23f][slot]);
				door.position.set(x, 1.3, row);
				group.add(door);
				doorMeshes.push({mesh: door, open: open[k].includes(slot), row, slot});
			}
			const last = puffyBox(0.3, 3, 0.6, 0xffffff);
			last.position.set(COURSE_X, 1.5, row);
			group.add(last);
			const top = puffyBox(COURSE_X * 2 + 0.6, 0.4, 0.7, 0xff4fa8);
			top.position.set(0, 3.1, row);
			group.add(top);
		});
		// 5) Pelotas gigantes que bajan rodando.
		const balls = BALL_LANES.map((x) => {
			const tex = candyTexture('dots', '#ffffff', '#ff4fa8', 1);
			const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshStandardMaterial({map: tex, roughness: 0.3, flatShading: true}));
			ball.position.set(x, 1.15, SEC_BALLS + 10);
			ball.castShadow = true;
			group.add(ball);
			return ball;
		});
		// Meta: arco inflable, corona y alfombra a cuadros.
		const finishPad = new THREE.Mesh(new THREE.BoxGeometry(COURSE_X * 2, 0.06, 8), new THREE.MeshStandardMaterial({map: candyTexture('checker', '#ff4fa8', '#ffffff', 2), roughness: 0.4}));
		finishPad.position.set(0, 0.03, RACE_FINISH + 4);
		group.add(finishPad);
		const arch = new THREE.Mesh(new THREE.TorusGeometry(COURSE_X, 0.55, 16, 48, Math.PI), glossy(0x45e07a, 0.2));
		arch.position.set(0, 0, RACE_FINISH);
		group.add(arch);
		const crown = new THREE.Group();
		const band = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.9, 24, 1, true), glossy(0xffd23f, 0.35));
		crown.add(band);
		for (let k = 0; k < 5; k++) {
			const spike = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 10), glossy(0xffd23f, 0.35));
			const a = (k / 5) * Math.PI * 2;
			spike.position.set(Math.cos(a) * 1.3, 0.9, Math.sin(a) * 1.3);
			crown.add(spike);
		}
		crown.position.set(0, 9, RACE_FINISH + 6);
		group.add(crown);
		const meta = textSprite('META', '#45e07a', 3.4);
		meta.position.set(0, COURSE_X + 1.4, RACE_FINISH);
		group.add(meta);

		let hitCooldown = 0;
		let finished = false;
		let checkpoint = CHECKPOINTS[0];
		return {
			group,
			speed: 1.12,
			clamp: (p) => {
				p.x = THREE.MathUtils.clamp(p.x, -COURSE_X, COURSE_X);
				p.z = THREE.MathUtils.clamp(p.z, RACE_START - 2.5, RACE_FINISH + 7.5);
				if (finished && p.z < RACE_FINISH + 0.4) p.z = RACE_FINISH + 0.4;
				doorClamp(p, open);
				return p;
			},
			support: (x, z) => raceSupport(x, z),
			update(c, dt, t) {
				sliders.forEach((b, i) => (b.position.x = sliderX(i, t)));
				bars.forEach((h, i) => (h.rotation.y = -barAngle(i, t, seed)));
				drums.forEach((d, i) => (d.rotation.x += DRUMS[i].dir * (DRUM_SPEED / DRUM_R) * dt));
				balls.forEach((b, lane) => {
					b.position.z = ballZ(lane, t, seed);
					b.rotation.x -= dt * 4;
				});
				const me = c.engine.myState();
				// Las puertas buenas se caen para atrás cuando alguien se acerca.
				for (const d of doorMeshes) {
					if (!d.open) continue;
					const near = Math.abs(me.z - d.row) < 2.2 && Math.abs(me.x - (-COURSE_X + DOOR_W * (d.slot + 0.5))) < DOOR_W;
					const target = near || (d.mesh.userData.down as boolean) ? -Math.PI / 2 : 0;
					if (near) d.mesh.userData.down = true;
					d.mesh.rotation.x += (target - d.mesh.rotation.x) * Math.min(1, dt * 8);
					d.mesh.position.y = 1.3 * Math.cos(d.mesh.rotation.x) + 0.2;
					d.mesh.position.z = d.row + 1.3 * Math.sin(-d.mesh.rotation.x);
				}
				if (c.state.phase !== 'play' || !c.state.alive.includes(c.meId)) return;
				for (const cp of CHECKPOINTS) if (me.z > cp + 0.5 && cp > checkpoint) checkpoint = cp;
				// Arriba de un rodillo: te lleva (para no caerte hay que correr en contra).
				const drum = !me.falling ? onDrum(me.z) : null;
				if (drum && me.z > SEC_DRUMS && me.z < SEC_DOORS) c.engine.nudge(0, drum.dir * DRUM_SPEED * dt);
				hitCooldown -= dt;
				if (hitCooldown <= 0 && me.y < 0.6) {
					const hit = barHit(me.x, me.z, t, seed);
					if (hit) {
						c.engine.push(hit.dx, hit.dz, 12);
						hitCooldown = 0.5;
					}
					SLIDERS.forEach((z, i) => {
						const bx = sliderX(i, t);
						if (Math.abs(me.x - bx) < 1.9 && Math.abs(me.z - z) < 1.05) {
							c.engine.push(Math.sign(me.x - bx) || 1, 0, 10);
							hitCooldown = 0.4;
						}
					});
					BALL_LANES.forEach((x, lane) => {
						const bz = ballZ(lane, t, seed);
						if (Math.hypot(me.x - x, me.z - bz) < 1.55) {
							c.engine.push((me.x - x) * 0.4, -1, 13);
							hitCooldown = 0.6;
						}
					});
				}
				if (!finished && me.z > RACE_FINISH) {
					finished = true;
					c.send({finish: true});
				}
			},
			respawn: () => [(Math.random() - 0.5) * 6, checkpoint + 0.8],
			dispose: () => disposeGroup(group),
		};
	},
	bot(b, ctx, dt, t) {
		if (ctx.state.order.includes(b.id)) {
			b.anim = 'idle';
			return;
		}
		const seed = ctx.state.seed;
		b.brain.lane ??= (Math.random() - 0.5) * 7;
		b.brain.cp ??= CHECKPOINTS[0];
		let tx = b.brain.lane as number;
		// Busca una puerta abierta.
		const open = openDoors(seed);
		DOOR_ROWS.forEach((row, k) => {
			if (b.z > row - 6 && b.z < row + 0.6) tx = -COURSE_X + DOOR_W * (open[k][(b.id.length + k) % 2] + 0.5);
		});
		const wait = b.z > SEC_BARS - 2 && b.z < SEC_DRUMS && Math.sin(t * 0.9 + b.x * 3) > 0.9;
		if (!wait) ctx.moveBot(b, tx, b.z + 1.4, 3.6 + Math.sin(b.x) * 0.4, dt);
		// En los rodillos el piso los lleva.
		const drum = onDrum(b.z);
		if (drum && b.z > SEC_DRUMS && b.z < SEC_DOORS) b.z += drum.dir * DRUM_SPEED * dt;
		for (const cp of CHECKPOINTS) if (b.z > cp + 0.5 && cp > (b.brain.cp as number)) b.brain.cp = cp;
		const hit = barHit(b.x, b.z, t, seed);
		if (hit && (b.brain.hit ?? 0) < t) {
			pushBot(b, hit.dx, hit.dz, 10);
			b.brain.hit = t + 0.5;
		}
		// Puertas falsas: no pasa.
		const p = new THREE.Vector3(b.x, 0, b.z);
		doorClamp(p, open);
		b.z = p.z;
		if (!raceSupport(b.x, b.z) && b.vy === 0) {
			b.x = (Math.random() - 0.5) * 5;
			b.z = (b.brain.cp as number) + 0.8;
		}
		if (b.z > RACE_FINISH) ctx.finish(b.id);
	},
	rank(s) {
		const groups = s.order.map((id) => [id]);
		const rest = s.players.filter((p) => !s.order.includes(p));
		if (rest.length) groups.push(rest);
		return groups;
	},
};

// ================================================================= 2 =====
// Piso que se Cae: hexágonos que desaparecen un ratito después de pisarlos.

const HEX = 1.0;
const HEX_W = HEX * Math.sqrt(3);
const HEX_ROWS = 22;

/** Los pisos (de arriba hacia abajo): altura, radio y colores. Bien grandes y separados. */
const LAYERS: Array<{y: number; r: number; colors: number[]}> = [
	{y: 0, r: 15, colors: [0xffb21f, 0xffc94a, 0xffd978]},
	{y: -5, r: 13.5, colors: [0xff4fa8, 0xff7ac0, 0xffa3d4]},
	{y: -10, r: 12, colors: [0x3fa4ff, 0x6fbcff, 0x9fd3ff]},
];
const rowParity = (row: number) => ((row % 2) + 2) % 2;
const hexCenter = (row: number, col: number): [number, number] => [col * HEX_W + (rowParity(row) ? HEX_W / 2 : 0), row * HEX * 1.5];

/** Casilleros de cada piso, con un índice rápido "fila,columna" → número. */
const LAYER_TILES = LAYERS.map((layer) => {
	const tiles: Array<[number, number]> = [];
	const index = new Map<string, number>();
	for (let row = -HEX_ROWS; row <= HEX_ROWS; row++) {
		for (let col = -HEX_ROWS; col <= HEX_ROWS; col++) {
			const [x, z] = hexCenter(row, col);
			if (Math.hypot(x, z) < layer.r) {
				index.set(`${row},${col}`, tiles.length);
				tiles.push([x, z]);
			}
		}
	}
	return {tiles, index};
});

const FALL_DELAY = 750;

function tileGone(g: Record<string, unknown>, key: number): boolean {
	const fall = (g.fall as Record<number, number> | undefined)?.[key];
	return fall !== undefined && hostNow() - fall > FALL_DELAY;
}

/** Índice global de un casillero: piso * 10000 + casillero. */
const tileKey = (layer: number, i: number) => layer * 10000 + i;

/**
 * El casillero debajo de (x, z): el hexágono más cercano (cubre todo el piso, sin agujeritos en las
 * esquinas donde se juntan tres; antes te caías "entre" los casilleros).
 */
function layerTileAt(layer: number, x: number, z: number): number {
	const {index} = LAYER_TILES[layer];
	const row0 = Math.round(z / (HEX * 1.5));
	let best = -1;
	let bestD = HEX * 1.08;
	for (let row = row0 - 1; row <= row0 + 1; row++) {
		const col0 = Math.round((x - (rowParity(row) ? HEX_W / 2 : 0)) / HEX_W);
		for (let col = col0 - 1; col <= col0 + 1; col++) {
			const i = index.get(`${row},${col}`);
			if (i === undefined) continue;
			const [cx, cz] = hexCenter(row, col);
			const d = Math.hypot(cx - x, cz - z);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
	}
	return best;
}

/** En qué piso estoy (por mi altura). */
function layerOf(y: number): number {
	let best = 0;
	for (let k = 0; k < LAYERS.length; k++) if (y <= LAYERS[k].y + 0.6) best = k;
	return best;
}

function floorGround(g: Record<string, unknown>, x: number, z: number, y: number): number | null {
	for (let k = 0; k < LAYERS.length; k++) {
		if (LAYERS[k].y > y + 0.05) continue;
		const i = layerTileAt(k, x, z);
		if (i >= 0 && !tileGone(g, tileKey(k, i))) return LAYERS[k].y;
	}
	return null;
}

/** Tribuna para los que se cayeron del último piso (miran desde ahí). */
const STANDS_Z = -21;

const floor: GameDef = {
	id: 'floor', name: 'Piso que se Cae', color: '#ffb21f', duration: 150, kind: 'elim', bigMap: true,
	desc: 'Tres pisos gigantes de hexágonos que se rompen al pisarlos. Si caés, aterrizás en el de abajo y seguís.',
	how: 'No te quedes quieto y saltá (Espacio) los huecos. Quedás afuera recién cuando te caés del último piso.',
	spawn: (i, n) => ring(i, n, 9),
	hostSetup: () => ({fall: {}}),
	build(ctx) {
		const group = new THREE.Group();
		group.add(landscape(new THREE.Vector3(0, 0, 0), {goo: -16}));
		// Hexágono con el borde un poco más oscuro (se distinguen bien uno del otro).
		const geometry = new THREE.CylinderGeometry(HEX * 0.93, HEX * 0.88, 0.55, 6);
		geometry.rotateY(Math.PI / 6);
		const m = new THREE.Matrix4();
		const color = new THREE.Color();
		const layers = LAYERS.map((layer, k) => {
			const {tiles} = LAYER_TILES[k];
			const mat = new THREE.MeshStandardMaterial({roughness: 0.3, metalness: 0.04, transparent: true, opacity: 1});
			const mesh = new THREE.InstancedMesh(geometry, mat, tiles.length);
			tiles.forEach(([x, z], i) => {
				m.makeTranslation(x, layer.y - 0.275, z);
				mesh.setMatrixAt(i, m);
				mesh.setColorAt(i, color.setHex(layer.colors[(i * 7) % layer.colors.length]));
			});
			mesh.receiveShadow = true;
			mesh.castShadow = k === 0;
			group.add(mesh);
			// Borde inflable alrededor de cada piso.
			const rim = new THREE.Mesh(new THREE.TorusGeometry(layer.r + 0.6, 0.35, 10, 72), glossy(0xffffff, 0.05));
			rim.rotation.x = Math.PI / 2;
			rim.position.y = layer.y - 0.25;
			group.add(rim);
			return {mesh, mat};
		});
		// Tribuna.
		const stands = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 6), new THREE.MeshStandardMaterial({map: candyTexture('checker', '#ff4fa8', '#ffffff', 3), roughness: 0.4}));
		stands.position.set(0, -0.3, STANDS_Z);
		stands.receiveShadow = true;
		group.add(stands);
		const sign = textSprite('TRIBUNA', '#ff4fa8', 3.2);
		sign.position.set(0, 3, STANDS_Z - 2.5);
		group.add(sign);
		let lastSent = -1;
		const broken = new Set<number>();
		return {
			group,
			outY: LAYERS[LAYERS.length - 1].y - 4,
			clamp: circleClamp(LAYERS[0].r + 2),
			spectatorClamp: (p) => {
				p.x = THREE.MathUtils.clamp(p.x, -14, 14);
				p.z = THREE.MathUtils.clamp(p.z, STANDS_Z - 2.6, STANDS_Z + 2.6);
				return p;
			},
			spectatorSpot: [0, STANDS_Z],
			// El estado de la partida cambia todo el tiempo: se lee el actual, no el del arranque.
			ground: (x, z, y) => floorGround(getParty()?.g ?? ctx.state.g, x, z, y),
			update(c, _dt, t) {
				const fall = (c.state.g.fall as Record<number, number>) ?? {};
				const now = hostNow();
				const meState = c.engine.myState();
				const myLayer = layerOf(meState.y);
				layers.forEach(({mesh, mat}, k) => {
					// Los pisos de arriba del mío se ven transparentes (si no, taparían todo).
					mat.opacity = k < myLayer ? 0.15 : 1;
					mat.depthWrite = k >= myLayer;
					const {tiles} = LAYER_TILES[k];
					let changed = false;
					for (const key of Object.keys(fall)) {
						const n = Number(key);
						if (Math.floor(n / 10000) !== k) continue;
						const i = n % 10000;
						const at = fall[n];
						if (at === undefined || !tiles[i]) continue;
						changed = true;
						const age = now - at;
						const [x, z] = tiles[i];
						if (age > FALL_DELAY) {
							m.makeScale(0.0001, 0.0001, 0.0001);
							// ¡Crack! (sólo los que se rompen cerca mío).
							if (!broken.has(n)) {
								broken.add(n);
								if (Math.abs(LAYERS[k].y - meState.y) < 3 && Math.hypot(x - meState.x, z - meState.z) < 9) worldSounds.play('tileBreak', 0.75);
							}
						} else {
							const shake = Math.sin(t * 60 + i) * 0.05 * (age / FALL_DELAY);
							m.makeTranslation(x + shake, LAYERS[k].y - 0.275 - (age / FALL_DELAY) * 0.2, z);
							mesh.setColorAt(i, color.setHex(0xff3355).lerp(new THREE.Color(LAYERS[k].colors[(i * 7) % LAYERS[k].colors.length]), 1 - age / FALL_DELAY));
						}
						mesh.setMatrixAt(i, m);
					}
					if (changed) {
						mesh.instanceMatrix.needsUpdate = true;
						if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
					}
				});
				if (c.state.phase !== 'play' || !c.state.alive.includes(c.meId)) return;
				if (meState.falling) return;
				const k = layerOf(meState.y);
				const i = layerTileAt(k, meState.x, meState.z);
				const key = i >= 0 ? tileKey(k, i) : -1;
				if (key >= 0 && key !== lastSent && fall[key] === undefined) {
					lastSent = key;
					c.send({step: key});
				}
			},
			dispose: () => disposeGroup(group),
		};
	},
	hostInput(_from, a, ctx) {
		const key = a.step as number | undefined;
		if (typeof key !== 'number') return;
		const fall = (ctx.state.g.fall as Record<number, number>) ?? {};
		if (fall[key] === undefined) ctx.setG({fall: {...fall, [key]: Date.now()}});
	},
	bot(b, ctx, dt, t) {
		const fall = (ctx.state.g.fall as Record<number, number>) ?? {};
		const k = layerOf(b.y);
		if (b.vy !== 0) return;
		const here = layerTileAt(k, b.x, b.z);
		if (here >= 0 && fall[tileKey(k, here)] === undefined) ctx.setG({fall: {...fall, [tileKey(k, here)]: Date.now()}});
		if ((b.brain.next ?? 0) < t || b.brain.tx === undefined || b.brain.layer !== k) {
			const {tiles} = LAYER_TILES[k];
			let best = -1;
			let bestScore = Infinity;
			for (let n = 0; n < 50; n++) {
				const i = Math.floor(Math.random() * tiles.length);
				if (fall[tileKey(k, i)] !== undefined) continue;
				const d = Math.hypot(tiles[i][0] - b.x, tiles[i][1] - b.z);
				const score = Math.abs(d - 1.8);
				if (score < bestScore) {
					bestScore = score;
					best = i;
				}
			}
			if (best >= 0) {
				b.brain.tx = tiles[best][0];
				b.brain.tz = tiles[best][1];
			}
			b.brain.layer = k;
			b.brain.next = t + 0.3 + Math.random() * 0.35;
		}
		ctx.moveBot(b, b.brain.tx ?? b.x, b.brain.tz ?? b.z, 3.4, dt);
	},
	rank: elimRank,
};

// ================================================================= 3 =====
// Rey de la Colina: la plataforma se achica; a cachetazos se tira a los demás.

function hillRadius(t: number): number {
	return Math.max(2.4, 8.2 - t * 0.085);
}

const king: GameDef = {
	id: 'king', name: 'Rey de la Colina', color: '#ffd23f', duration: 75, kind: 'elim',
	desc: 'La plataforma se achica. ¡Tirá a los demás a la gelatina!',
	how: 'E o clic para empujar al que tengas enfrente. Espacio para saltar.',
	spawn: (i, n) => ring(i, n, 5),
	build() {
		const group = new THREE.Group();
		const plat = candyFloor('round', 1, 'rays', '#ffd23f', '#ff9a3c', 0xff4fa8);
		group.add(plat);
		const crown = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 5), glossy(0xffd23f, 0.5));
		crown.position.y = 5;
		group.add(crown);
		return {
			group,
			clamp: circleClamp(11),
			support: (x, z, t) => Math.hypot(x, z) <= hillRadius(t),
			update(_c, _dt, t) {
				const r = hillRadius(t);
				plat.scale.set(r, 1, r);
				crown.rotation.y = t;
				crown.position.y = 5 + Math.sin(t * 2) * 0.2;
			},
			action: (c) => shove(c, 10),
			dispose: () => disposeGroup(group),
		};
	},
	bot(b, ctx, dt, t) {
		const r = hillRadius(t);
		const pos = ctx.positions();
		let target: string | null = null;
		let best = 99;
		for (const id of ctx.state.alive) {
			if (id === b.id || !pos[id]) continue;
			const d = Math.hypot(pos[id].x - b.x, pos[id].z - b.z);
			if (d < best) {
				best = d;
				target = id;
			}
		}
		// Se queda cerca del centro y empuja al más cercano.
		const toCenter = Math.hypot(b.x, b.z) > r * 0.6;
		if (target && !toCenter) {
			const p = pos[target];
			ctx.moveBot(b, p.x, p.z, 2.6, dt);
			if (best < 1.3 && (b.brain.cd ?? 0) < t) {
				b.brain.cd = t + 1.4 + Math.random();
				sendPush(target, p.x - b.x, p.z - b.z, 9);
			}
		} else ctx.moveBot(b, 0, 0, 2.6, dt);
	},
	rank: elimRank,
};

// ================================================================= 4 =====
// Pasá la Bomba: el que la tiene se la tiene que pasar a otro (tocándolo) antes de que explote.

const FUSE_MIN = 9000;
const FUSE_MAX = 15000;

function bombMesh(): {group: THREE.Group; body: THREE.MeshStandardMaterial; spark: THREE.Sprite} {
	const group = new THREE.Group();
	const body = new THREE.MeshStandardMaterial({color: 0x2a1747, roughness: 0.25, emissive: 0xff2200, emissiveIntensity: 0});
	const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 18), body);
	const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 16), glossy(0x8a7aa8));
	cap.position.y = 0.36;
	const fuse = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 8, 16, Math.PI), glossy(0xd9b48a));
	fuse.position.set(0.12, 0.44, 0);
	fuse.rotation.z = Math.PI / 2;
	const shine = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.6}));
	shine.position.set(-0.13, 0.14, 0.22);
	const spark = new THREE.Sprite(new THREE.SpriteMaterial({color: 0xffd23f, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
	spark.position.set(0.26, 0.56, 0);
	spark.scale.setScalar(0.35);
	group.add(ball, cap, fuse, shine, spark);
	group.userData.partyProp = true;
	return {group, body, spark};
}

/** Chispas de la explosión (pool de partículas). */
function sparkBurst(parent: THREE.Group, at: THREE.Vector3): void {
	const count = 70;
	const positions = new Float32Array(count * 3);
	const velocities: THREE.Vector3[] = [];
	for (let i = 0; i < count; i++) {
		positions.set([at.x, at.y, at.z], i * 3);
		const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize();
		velocities.push(dir.multiplyScalar(4 + Math.random() * 6));
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	const colors = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const c = new THREE.Color([0xffd23f, 0xff8a2a, 0xff4422, 0xffffff][i % 4]);
		colors.set([c.r, c.g, c.b], i * 3);
	}
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	const points = new THREE.Points(geometry, new THREE.PointsMaterial({size: 0.22, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
	parent.add(points);
	// Bola de fuego que crece y se va.
	const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({color: 0xffb02e, transparent: true, opacity: 0.9, toneMapped: false}));
	flash.position.copy(at);
	parent.add(flash);
	const born = performance.now();
	const tick = () => {
		const age = (performance.now() - born) / 1000;
		const pos = geometry.attributes.position as THREE.BufferAttribute;
		for (let i = 0; i < count; i++) {
			const v = velocities[i];
			v.y -= 9.8 * 0.016;
			pos.setXYZ(i, pos.getX(i) + v.x * 0.016, Math.max(0.05, pos.getY(i) + v.y * 0.016), pos.getZ(i) + v.z * 0.016);
		}
		pos.needsUpdate = true;
		(points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age / 1.3);
		flash.scale.setScalar(0.3 + age * 6);
		(flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - age * 3);
		if (age < 1.4) requestAnimationFrame(tick);
		else {
			points.removeFromParent();
			flash.removeFromParent();
			geometry.dispose();
		}
	};
	tick();
}

const bomb: GameDef = {
	id: 'bomb', name: 'Pasá la Bomba', color: '#ff4422', duration: 150, kind: 'elim',
	desc: 'Una bomba con la mecha encendida va pasando de mano en mano. ¡Que no te explote a vos!',
	how: 'Si la tenés, tocá a alguien (o E / clic cerca) para pasársela. Escuchá el tic-tac.',
	spawn: (i, n) => ring(i, n, 5),
	hostSetup(players) {
		const holder = players[Math.floor(Math.random() * players.length)];
		return {holder, explodeAt: Date.now() + 6500 + FUSE_MIN + Math.random() * (FUSE_MAX - FUSE_MIN), last: null, passAt: 0, boom: 0, boomAt: [0, 0]};
	},
	build(ctx) {
		const group = new THREE.Group();
		group.add(candyFloor('square', 7.4, 'stripes', '#ff9ad0', '#ffd6ec', 0xff4422));
		const {group: bombGroup, body, spark} = bombMesh();
		let attachedTo = '';
		let nextBeep = 0;
		let shownBoom = (ctx.state.g.boom as number) ?? 0;
		let passCd = 0;
		return {
			group,
			clamp: squareClamp(7.1),
			update(c, dt, t) {
				const g = c.state.g;
				const holder = g.holder as string;
				// La bomba va arriba de la cabeza del que la tiene.
				const root = c.state.alive.includes(holder) ? c.engine.actorRoot(holder) : null;
				if (root && attachedTo !== holder) {
					root.add(bombGroup);
					bombGroup.position.set(0, 2.25, 0);
					attachedTo = holder;
					bombPass();
				} else if (!root && attachedTo) {
					bombGroup.removeFromParent();
					attachedTo = '';
				}
				const left = ((g.explodeAt as number) ?? 0) - hostNow();
				const urgency = Math.max(0, Math.min(1, 1 - left / FUSE_MAX));
				bombGroup.position.y = 2.25 + Math.sin(t * (6 + urgency * 20)) * 0.06;
				bombGroup.scale.setScalar(1 + Math.max(0, Math.sin(t * (4 + urgency * 26))) * 0.12 * urgency);
				body.emissiveIntensity = Math.max(0, Math.sin(t * (4 + urgency * 26))) * (0.2 + urgency * 0.8);
				spark.scale.setScalar(0.25 + Math.random() * 0.2);
				// El tic-tac: cada vez más rápido.
				if (c.state.phase === 'play' && attachedTo && performance.now() > nextBeep && left > 0) {
					bombTick(left < 2500);
					nextBeep = performance.now() + Math.max(90, Math.min(900, left / 9));
				}
				// ¡Explotó!
				const boom = (g.boom as number) ?? 0;
				if (boom !== shownBoom) {
					shownBoom = boom;
					const [bx, bz] = (g.boomAt as number[]) ?? [0, 0];
					sparkBurst(group, new THREE.Vector3(bx, 1.4, bz));
					bombBoom();
					const me = c.engine.myState();
					const d = Math.hypot(me.x - bx, me.z - bz);
					if (d < 3.5 && d > 0.01) c.engine.push(me.x - bx, me.z - bz, 9 * (1 - d / 3.5));
				}
				// Si la tengo, se la paso al que toco.
				passCd -= dt;
				if (holder === c.meId && c.state.phase === 'play' && passCd <= 0) {
					const target = nearestOther(c, 0.95, (id) => id !== g.last);
					if (target) {
						passCd = 0.6;
						c.send({pass: target.id});
					}
				}
			},
			action(c) {
				if (c.state.g.holder !== c.meId) return true;
				const target = nearestOther(c, 1.7, (id) => id !== c.state.g.last);
				if (target) c.send({pass: target.id});
				return true;
			},
			dispose: () => {
				bombGroup.removeFromParent();
				disposeGroup(group);
			},
		};
	},
	hostInput(from, a, ctx) {
		const target = a.pass as string | undefined;
		if (target) passBomb(from, target, ctx);
	},
	hostTick(ctx) {
		const g = ctx.state.g;
		const now = Date.now();
		if (now < ((g.explodeAt as number) ?? Infinity)) return;
		const holder = g.holder as string;
		const pos = ctx.positions()[holder] ?? {x: 0, z: 0};
		ctx.out(holder);
		const alive = ctx.state.alive.filter((id) => id !== holder);
		const next = alive[Math.floor(Math.random() * alive.length)] ?? holder;
		ctx.setG({
			boom: ((g.boom as number) ?? 0) + 1,
			boomAt: [Math.round(pos.x * 100) / 100, Math.round(pos.z * 100) / 100],
			holder: next,
			last: null,
			passAt: now + 1500,
			explodeAt: now + 2500 + FUSE_MIN + Math.random() * (FUSE_MAX - FUSE_MIN),
		});
	},
	bot(b, ctx, dt, t) {
		const g = ctx.state.g;
		const holder = g.holder as string;
		const pos = ctx.positions();
		if (b.id === holder) {
			let best: string | null = null;
			let bestD = 99;
			for (const id of ctx.state.alive) {
				if (id === b.id || id === g.last || !pos[id]) continue;
				const d = Math.hypot(pos[id].x - b.x, pos[id].z - b.z);
				if (d < bestD) {
					bestD = d;
					best = id;
				}
			}
			if (!best) return;
			ctx.moveBot(b, pos[best].x, pos[best].z, 3.7, dt);
			if (bestD < 1.0 && (b.brain.cd ?? 0) < t) {
				b.brain.cd = t + 0.5;
				passBomb(b.id, best, ctx);
			}
		} else if (pos[holder]) {
			const h = pos[holder];
			const dx = b.x - h.x;
			const dz = b.z - h.z;
			const d = Math.hypot(dx, dz) || 1;
			if (d < 5) {
				let tx = b.x + (dx / d) * 2;
				let tz = b.z + (dz / d) * 2;
				if (Math.abs(tx) > 6.5 || Math.abs(tz) > 6.5) {
					tx = b.x - (dz / d) * 2;
					tz = b.z + (dx / d) * 2;
				}
				ctx.moveBot(b, tx, tz, 3.1, dt);
			} else ctx.moveBot(b, Math.sin(t + b.x) * 4, Math.cos(t * 0.8 + b.z) * 4, 1.6, dt);
		}
	},
	rank: elimRank,
};

function passBomb(from: string, target: string, ctx: HostCtx): void {
	const g = ctx.state.g;
	if (g.holder !== from || from === target || !ctx.state.alive.includes(target) || Date.now() < ((g.passAt as number) ?? 0)) return;
	const pos = ctx.positions();
	const a = pos[from];
	const b = pos[target];
	if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > 2.2) return;
	ctx.setG({holder: target, last: from, passAt: Date.now() + 500});
}

// ================================================================= 5 =====
// Lluvia de Frutas: cae fruta gigante; la sombra avisa dónde.

interface Drop {
	t: number;
	x: number;
	z: number;
	r: number;
	kind: number;
}

function drops(seed: number, duration: number): Drop[] {
	const r = mulberry(seed);
	const list: Drop[] = [];
	let t = 2.2;
	while (t < duration) {
		const a = r() * Math.PI * 2;
		const d = Math.sqrt(r()) * 7.6;
		const big = r() < 0.18 && t > 20;
		list.push({t, x: Math.cos(a) * d, z: Math.sin(a) * d, r: big ? 1.9 : 1.15, kind: big ? 3 : Math.floor(r() * 3)});
		t += Math.max(0.28, 1.15 - t * 0.012) * (0.6 + r() * 0.8);
	}
	return list;
}

const FRUIT_COLORS = [0xff3355, 0xffd23f, 0xff8a2a, 0x45e07a];
const WARN = 1.6;

const fruit: GameDef = {
	id: 'fruit', name: 'Lluvia de Frutas', color: '#45e07a', duration: 75, kind: 'elim',
	desc: '¡Llueven frutas gigantes! Mirá las sombras y esquivalas.',
	how: 'Salí de las sombras antes de que caiga la fruta.',
	spawn: (i, n) => ring(i, n, 4),
	build(ctx) {
		const group = new THREE.Group();
		group.add(candyFloor('round', R, 'dots', '#8fd0ff', '#ffffff', 0xff4fa8));
		const list = drops(ctx.state.seed, this.duration);
		const pool: Array<{fruit: THREE.Mesh; shadow: THREE.Mesh}> = [];
		const shadowMat = new THREE.MeshBasicMaterial({color: 0x2a1747, transparent: true, opacity: 0.35, depthWrite: false});
		for (let i = 0; i < 14; i++) {
			const fruitMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), glossy(0xffffff, 0.15));
			fruitMesh.castShadow = true;
			const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), shadowMat);
			shadow.rotation.x = -Math.PI / 2;
			shadow.position.y = 0.03;
			fruitMesh.visible = shadow.visible = false;
			group.add(fruitMesh, shadow);
			pool.push({fruit: fruitMesh, shadow});
		}
		const hit = new Set<number>();
		return {
			group,
			clamp: circleClamp(R - 0.3),
			update(c, _dt, t) {
				let used = 0;
				list.forEach((d, i) => {
					if (t < d.t - WARN || t > d.t + 0.5 || used >= pool.length) return;
					const slot = pool[used++];
					const k = Math.min(1, (t - (d.t - WARN)) / WARN);
					slot.shadow.visible = true;
					slot.shadow.position.set(d.x, 0.03, d.z);
					slot.shadow.scale.setScalar(d.r * (0.3 + 0.7 * k));
					slot.fruit.visible = true;
					const y = Math.max(d.r * 0.6, (d.t - t) * 14);
					slot.fruit.position.set(d.x, t > d.t ? d.r * 0.6 * (1 - (t - d.t) * 2) : y, d.z);
					slot.fruit.scale.set(d.r * 0.9, d.r * (t > d.t ? 0.55 : 0.85), d.r * 0.9);
					(slot.fruit.material as THREE.MeshStandardMaterial).color.setHex(FRUIT_COLORS[d.kind]);
					// ¡Me cayó encima!
					if (t >= d.t && t < d.t + 0.15 && !hit.has(i) && c.state.phase === 'play' && c.state.alive.includes(c.meId)) {
						const me = c.engine.myState();
						if (Math.hypot(me.x - d.x, me.z - d.z) < d.r) {
							hit.add(i);
							c.engine.push(me.x - d.x || 1, me.z - d.z, 14);
							window.setTimeout(() => c.send({out: true}), 300);
							window.setTimeout(() => c.engine.teleport((Math.random() - 0.5) * 6, -13.2, 0), 700);
						}
					}
				});
				for (let i = used; i < pool.length; i++) pool[i].fruit.visible = pool[i].shadow.visible = false;
			},
			dispose: () => disposeGroup(group),
		};
	},
	bot(b, ctx, dt, t) {
		const list = (b.brain.list as unknown as Drop[] | undefined) ?? drops(ctx.state.seed, 75);
		(b.brain as unknown as {list: Drop[]}).list = list;
		let danger: Drop | null = null;
		for (const d of list) {
			if (d.t < t - 0.1 || d.t > t + 1.3) continue;
			if (Math.hypot(b.x - d.x, b.z - d.z) < d.r + 0.6) danger = d;
			if (d.t <= t && d.t > t - 0.06 && Math.hypot(b.x - d.x, b.z - d.z) < d.r * 0.85) ctx.out(b.id);
		}
		if (danger && Math.random() > 0.08) {
			const dx = b.x - danger.x || 0.5;
			const dz = b.z - danger.z;
			const d = Math.hypot(dx, dz) || 1;
			let tx = b.x + (dx / d) * 2.4;
			let tz = b.z + (dz / d) * 2.4;
			const len = Math.hypot(tx, tz);
			if (len > R - 1) {
				tx *= (R - 1) / len;
				tz *= (R - 1) / len;
			}
			ctx.moveBot(b, tx, tz, 3.4, dt);
		} else if ((b.brain.wander ?? 0) < t) {
			b.brain.wander = t + 1.5;
			b.brain.wx = (Math.random() - 0.5) * 9;
			b.brain.wz = (Math.random() - 0.5) * 9;
		} else ctx.moveBot(b, b.brain.wx ?? 0, b.brain.wz ?? 0, 1.8, dt);
	},
	rank: elimRank,
};

// ================================================================= 6 =====
// Colores Locos: aparece un color y en un ratito se caen todos los demás.

const CELL = 2.9;
const GRID = 5;

interface ColorRound {
	start: number;
	warnEnd: number;
	dropEnd: number;
	target: number;
	colors: number[];
}

function colorRounds(seed: number, duration: number): ColorRound[] {
	const rounds: ColorRound[] = [];
	let t = 2;
	let k = 0;
	while (t < duration) {
		const r = mulberry(seed + k * 97);
		const colors = Array.from({length: GRID * GRID}, () => Math.floor(r() * 5));
		const target = colors[Math.floor(r() * colors.length)];
		const warn = Math.max(2.2, 5.2 - k * 0.35);
		rounds.push({start: t, warnEnd: t + warn, dropEnd: t + warn + 2.2, target, colors});
		t += warn + 2.2 + 0.6;
		k++;
	}
	return rounds;
}

function cellCenter(i: number): [number, number] {
	return [((i % GRID) - (GRID - 1) / 2) * CELL, (Math.floor(i / GRID) - (GRID - 1) / 2) * CELL];
}

function cellIndex(x: number, z: number): number {
	const col = Math.round(x / CELL + (GRID - 1) / 2);
	const row = Math.round(z / CELL + (GRID - 1) / 2);
	if (col < 0 || row < 0 || col >= GRID || row >= GRID) return -1;
	return row * GRID + col;
}

function roundAt(rounds: ColorRound[], t: number): ColorRound | null {
	for (const r of rounds) if (t >= r.start && t < r.dropEnd + 0.6) return r;
	return null;
}

const colors: GameDef = {
	id: 'colors', name: 'Colores Locos', color: '#a066ff', duration: 90, kind: 'elim',
	desc: 'Aparece un color: ¡parate en él antes de que se caigan los otros!',
	how: 'Mirá el cartel de arriba y corré a un cuadrado de ese color.',
	spawn: (i, n) => ring(i, n, 3.5),
	build(ctx) {
		const group = new THREE.Group();
		const rounds = colorRounds(ctx.state.seed, this.duration);
		const tiles = Array.from({length: GRID * GRID}, (_, i) => {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.12, 0.5, CELL - 0.12), glossy(0xffffff));
			const [x, z] = cellCenter(i);
			mesh.position.set(x, -0.25, z);
			mesh.receiveShadow = true;
			group.add(mesh);
			return mesh;
		});
		let sign: THREE.Sprite | null = null;
		let signKey = -1;
		return {
			group,
			clamp: (p) => {
				const half = (GRID * CELL) / 2 + 1.5;
				p.x = THREE.MathUtils.clamp(p.x, -half, half);
				p.z = THREE.MathUtils.clamp(p.z, -half, half);
				return p;
			},
			support: (x, z, t) => {
				const i = cellIndex(x, z);
				if (i < 0) return false;
				const r = roundAt(rounds, t);
				if (!r || t < r.warnEnd || t >= r.dropEnd) return true;
				return r.colors[i] === r.target;
			},
			update(c, _dt, t) {
				const r = roundAt(rounds, t);
				tiles.forEach((tile, i) => {
					const colorIndex = r ? r.colors[i] : i % 5;
					const mat = tile.material as THREE.MeshStandardMaterial;
					mat.color.setHex(COLORS[colorIndex]);
					const dropping = r && t >= r.warnEnd && t < r.dropEnd && colorIndex !== r.target;
					tile.position.y = dropping ? -0.25 - Math.min(6, (t - r!.warnEnd) * 14) : -0.25;
					const flashing = r && t > r.warnEnd - 1 && t < r.warnEnd && colorIndex !== r.target;
					mat.emissive.setHex(COLORS[colorIndex]);
					mat.emissiveIntensity = flashing ? (Math.sin(t * 30) > 0 ? 0.6 : 0) : 0.05;
				});
				const key = r && t < r.dropEnd ? r.target : -1;
				if (key !== signKey) {
					signKey = key;
					sign?.removeFromParent();
					sign = null;
					if (key >= 0) {
						sign = textSprite(COLOR_NAMES[key], `#${COLORS[key].toString(16).padStart(6, '0')}`, 5);
						sign.position.set(0, 5.2, 0);
						group.add(sign);
					}
				}
				if (sign) sign.position.y = 5.2 + Math.sin(t * 4) * 0.15;
				void c;
			},
			dispose: () => disposeGroup(group),
		};
	},
	bot(b, ctx, dt, t) {
		const rounds = (b.brain.r as unknown as ColorRound[] | undefined) ?? colorRounds(ctx.state.seed, 90);
		(b.brain as unknown as {r: ColorRound[]}).r = rounds;
		const r = roundAt(rounds, t);
		if (!r) return;
		if (b.brain.round !== r.start) {
			b.brain.round = r.start;
			b.brain.react = r.start + 0.6 + Math.random() * 1.6;
			// A veces se equivoca (es un bot).
			const wrong = Math.random() < 0.12;
			let best = -1;
			let bestD = 99;
			r.colors.forEach((col, i) => {
				if ((col === r.target) === wrong) return;
				const [x, z] = cellCenter(i);
				const d = Math.hypot(x - b.x, z - b.z);
				if (d < bestD) {
					bestD = d;
					best = i;
				}
			});
			if (best >= 0) [b.brain.tx, b.brain.tz] = cellCenter(best);
		}
		if (t > (b.brain.react ?? 0)) ctx.moveBot(b, b.brain.tx ?? b.x, b.brain.tz ?? b.z, 3.4, dt);
	},
	rank: elimRank,
};

// ================================================================= 7 =====
// Fútbol de Pelotota: cancha rectangular, arcos a los costados y una pelota enorme.

const PITCH_X = 8.2;
const PITCH_Z = 5.2;
const GOAL_HALF = 1.7;
const GOAL_DEPTH = 1.3;
const BALL_R = 0.6;

/** Textura de pasto a franjas con las líneas de la cancha. */
function pitchTexture(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 1024;
	canvas.height = 650;
	const c = canvas.getContext('2d')!;
	for (let i = 0; i < 12; i++) {
		c.fillStyle = i % 2 ? '#3fd47f' : '#35c272';
		c.fillRect((i * canvas.width) / 12, 0, canvas.width / 12 + 1, canvas.height);
	}
	c.strokeStyle = '#ffffff';
	c.lineWidth = 10;
	const pad = 18;
	c.strokeRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
	c.beginPath();
	c.moveTo(canvas.width / 2, pad);
	c.lineTo(canvas.width / 2, canvas.height - pad);
	c.stroke();
	c.beginPath();
	c.arc(canvas.width / 2, canvas.height / 2, 90, 0, Math.PI * 2);
	c.stroke();
	c.fillStyle = '#ffffff';
	c.beginPath();
	c.arc(canvas.width / 2, canvas.height / 2, 10, 0, Math.PI * 2);
	c.fill();
	// Áreas.
	const areaW = 150;
	const areaH = 300;
	c.strokeRect(pad, canvas.height / 2 - areaH / 2, areaW, areaH);
	c.strokeRect(canvas.width - pad - areaW, canvas.height / 2 - areaH / 2, areaW, areaH);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

function goalMesh(color: number, side: number): THREE.Group {
	const g = new THREE.Group();
	const mat = glossy(color, 0.15);
	const postGeo = new THREE.CylinderGeometry(0.13, 0.13, 1.8, 16);
	for (const z of [-GOAL_HALF, GOAL_HALF]) {
		const post = new THREE.Mesh(postGeo, mat);
		post.position.set(0, 0.9, z);
		post.castShadow = true;
		g.add(post);
	}
	const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, GOAL_HALF * 2, 16), mat);
	bar.rotation.x = Math.PI / 2;
	bar.position.y = 1.8;
	g.add(bar);
	// Red: un "techo" y un fondo semitransparentes.
	const netMat = new THREE.MeshStandardMaterial({color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, roughness: 0.9});
	const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF * 2, 1.8), netMat);
	back.rotation.y = Math.PI / 2;
	back.position.set(side * GOAL_DEPTH, 0.9, 0);
	const top = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HALF * 2), netMat);
	top.rotation.x = -Math.PI / 2;
	top.position.set(side * GOAL_DEPTH * 0.5, 1.8, 0);
	g.add(back, top);
	g.position.x = side * PITCH_X;
	return g;
}

const soccer: GameDef = {
	id: 'soccer', name: 'Fútbol de Pelotota', color: '#3fa4ff', duration: 120, kind: 'team',
	desc: 'Rosa contra Azul en una cancha de verdad. ¡Primero a 3 goles!',
	how: 'Chocá la pelota o apretá E / clic cerca de ella para patear fuerte.',
	spawn: (i, _n, g) => {
		const teams = (g.teams as Record<string, string>) ?? {};
		const ids = Object.keys(teams);
		const id = ids[i];
		const team = teams[id] ?? (i % 2 ? 'b' : 'a');
		const k = ids.filter((x) => teams[x] === team).indexOf(id);
		return [team === 'a' ? -3.5 - Math.floor(k / 3) * 1.5 : 3.5 + Math.floor(k / 3) * 1.5, ((k % 3) - 1) * 2];
	},
	hostSetup(players) {
		return {teams: teamsFor(players), ball: [0, 0, 0, 0], goals: {a: 0, b: 0}, kickoff: 0};
	},
	build(buildCtx) {
		const group = new THREE.Group();
		let seenKickoff = (buildCtx.state.g.kickoff as number) ?? 0;
		const scaled = new Set<string>();
		const pitch = new THREE.Mesh(new THREE.BoxGeometry(PITCH_X * 2, 0.4, PITCH_Z * 2), [
			glossy(0x2fb565), glossy(0x2fb565), new THREE.MeshStandardMaterial({map: pitchTexture(), roughness: 0.7}), glossy(0x2fb565), glossy(0x2fb565), glossy(0x2fb565),
		]);
		pitch.position.y = -0.2;
		pitch.receiveShadow = true;
		group.add(pitch);
		// Vallas inflables alrededor (con hueco en los arcos).
		const boardMat = [glossy(0xff4fa8), glossy(0xffd23f)];
		for (const z of [-PITCH_Z - 0.3, PITCH_Z + 0.3]) {
			for (let k = 0; k < 8; k++) {
				const board = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.6, 8, 16), boardMat[k % 2]);
				board.rotation.z = Math.PI / 2;
				board.position.set(-PITCH_X + 1 + k * 2.05, 0.3, z);
				group.add(board);
			}
		}
		for (const side of [-1, 1]) {
			for (const z of [-PITCH_Z + 1.2, PITCH_Z - 1.2]) {
				const board = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 2.2, 8, 16), boardMat[0]);
				board.rotation.x = Math.PI / 2;
				board.position.set(side * (PITCH_X + 0.3), 0.3, z);
				group.add(board);
			}
		}
		group.add(goalMesh(0x3fa4ff, 1), goalMesh(0xff4fa8, -1));
		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 128;
		const c2 = canvas.getContext('2d')!;
		['#ff4fa8', '#ffffff', '#ffd23f', '#ffffff', '#3fa4ff', '#ffffff'].forEach((col, i) => {
			c2.fillStyle = col;
			c2.fillRect(i * 43, 0, 43, 128);
		});
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 20), new THREE.MeshStandardMaterial({map: tex, roughness: 0.25}));
		ball.castShadow = true;
		group.add(ball);
		const shown = new THREE.Vector3();
		const rings = new Map<string, THREE.Mesh>();
		return {
			group,
			clamp: (p) => {
				p.x = THREE.MathUtils.clamp(p.x, -PITCH_X + 0.3, PITCH_X - 0.3);
				p.z = THREE.MathUtils.clamp(p.z, -PITCH_Z + 0.3, PITCH_Z - 0.3);
				return p;
			},
			update(c, dt) {
				const [x, z, vx, vz] = (c.state.g.ball as number[]) ?? [0, 0, 0, 0];
				shown.lerp(new THREE.Vector3(x + vx * 0.1, BALL_R, z + vz * 0.1), Math.min(1, dt * 14));
				ball.position.copy(shown);
				ball.rotation.x += vz * dt * 1.6;
				ball.rotation.z -= vx * dt * 1.6;
				const teams = (c.state.g.teams as Record<string, string>) ?? {};
				// Gol: todos vuelven a su lugar (así la pelota no queda servida para el otro equipo).
				const kickoff = (c.state.g.kickoff as number) ?? 0;
				if (kickoff !== seenKickoff) {
					seenKickoff = kickoff;
					const index = c.state.players.indexOf(c.meId);
					if (index >= 0 && c.state.alive.includes(c.meId)) {
						const [sx, sz] = soccer.spawn(index, c.state.players.length, c.state.g);
						c.engine.teleport(sx, sz, 0);
					}
				}
				for (const id of c.state.players) {
					const root = c.engine.actorRoot(id);
					if (!root) continue;
					// El equipo con menos jugadores se ve (y choca) más grande.
					const size = soccerScale(teams, id);
					if (Math.abs(root.scale.x - size) > 0.01) {
						root.scale.setScalar(size);
						scaled.add(id);
					}
					let ringMesh = rings.get(id);
					if (!ringMesh || ringMesh.parent !== root) {
						ringMesh?.removeFromParent();
						ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 28), glossy(teams[id] === 'a' ? 0xff4fa8 : 0x3fa4ff, 0.6));
						ringMesh.rotation.x = Math.PI / 2;
						ringMesh.position.y = 0.05;
						ringMesh.userData.partyProp = true;
						root.add(ringMesh);
						rings.set(id, ringMesh);
					}
				}
			},
			action(c) {
				const me = c.engine.myState();
				const [x, z] = (c.state.g.ball as number[]) ?? [0, 0];
				if (Math.hypot(x - me.x, z - me.z) < 1.6) c.send({kick: [x - me.x, z - me.z]});
				return true;
			},
			dispose: () => {
				for (const r of rings.values()) r.removeFromParent();
				for (const id of scaled) buildCtx.engine.actorRoot(id)?.scale.setScalar(1);
				disposeGroup(group);
			},
		};
	},
	hostInput(from, a, ctx) {
		const kick = a.kick as [number, number] | undefined;
		if (!kick) return;
		kickBall(ctx, from, kick[0], kick[1], 12);
	},
	hostTick(ctx, dt) {
		const g = ctx.state.g;
		let [x, z, vx, vz] = (g.ball as number[]) ?? [0, 0, 0, 0];
		const goals = {...((g.goals as {a: number; b: number}) ?? {a: 0, b: 0})};
		// Al chocarla, la pelota sale para el lado contrario (más fuerte si venías corriendo).
		const teamsNow = (g.teams as Record<string, string>) ?? {};
		for (const [id, p] of Object.entries(ctx.positions())) {
			if (!ctx.state.players.includes(id)) continue;
			const reach = 0.4 * soccerScale(teamsNow, id);
			const dx = x - p.x;
			const dz = z - p.z;
			const d = Math.hypot(dx, dz);
			if (d < BALL_R + reach && d > 0.01) {
				vx += (dx / d) * 2.2;
				vz += (dz / d) * 2.2;
				x = p.x + (dx / d) * (BALL_R + reach);
				z = p.z + (dz / d) * (BALL_R + reach);
			}
		}
		const speed = Math.hypot(vx, vz);
		if (speed > 13) {
			vx *= 13 / speed;
			vz *= 13 / speed;
		}
		x += vx * dt;
		z += vz * dt;
		vx *= Math.pow(0.5, dt);
		vz *= Math.pow(0.5, dt);
		let scored: 'a' | 'b' | null = null;
		const inMouth = Math.abs(z) < GOAL_HALF - 0.15;
		// Gol: la pelota pasó la línea entre los palos.
		if (inMouth && x > PITCH_X) scored = 'a';
		else if (inMouth && x < -PITCH_X) scored = 'b';
		if (!scored) {
			// Rebota en las vallas (no en la boca del arco).
			if (Math.abs(z) > PITCH_Z - BALL_R) {
				z = Math.sign(z) * (PITCH_Z - BALL_R);
				vz = -vz * 0.8;
			}
			if (Math.abs(x) > PITCH_X - BALL_R && !inMouth) {
				x = Math.sign(x) * (PITCH_X - BALL_R);
				vx = -vx * 0.8;
			}
			// En los palos.
			for (const sx of [-PITCH_X, PITCH_X]) for (const sz of [-GOAL_HALF, GOAL_HALF]) {
				const dx = x - sx;
				const dz = z - sz;
				const d = Math.hypot(dx, dz);
				if (d < BALL_R + 0.13 && d > 0.001) {
					const nx = dx / d;
					const nz = dz / d;
					const dot = vx * nx + vz * nz;
					if (dot < 0) {
						vx -= 1.8 * dot * nx;
						vz -= 1.8 * dot * nz;
					}
					x = sx + nx * (BALL_R + 0.14);
					z = sz + nz * (BALL_R + 0.14);
				}
			}
		}
		if (scored) {
			goals[scored] += 1;
			[x, z, vx, vz] = [0, 0, 0, 0];
			if (goals[scored] >= 3) ctx.finished = true;
			// Los bots también vuelven a su lugar.
			for (const b of ctx.bots) {
				const index = ctx.state.players.indexOf(b.id);
				if (index < 0) continue;
				[b.x, b.z] = soccer.spawn(index, ctx.state.players.length, g);
			}
		}
		const moving = Math.hypot(vx, vz) > 0.05;
		if (scored || moving || (g.ball as number[])?.[2] !== 0) {
			ctx.setG({ball: [x, z, vx, vz].map((v) => Math.round(v * 100) / 100), goals, ...(scored ? {kickoff: ((g.kickoff as number) ?? 0) + 1} : {})});
		}
	},
	bot(b, ctx, dt, t) {
		const teams = (ctx.state.g.teams as Record<string, string>) ?? {};
		const [x, z] = (ctx.state.g.ball as number[]) ?? [0, 0];
		const goalX = teams[b.id] === 'a' ? PITCH_X + 1 : -PITCH_X - 1;
		// Se pone detrás de la pelota (mirando al arco rival) y la patea.
		const dx = goalX - x;
		const dz = 0 - z;
		const d = Math.hypot(dx, dz) || 1;
		const bx = x - (dx / d) * 1.1;
		const bz = z - (dz / d) * 1.1;
		const behind = Math.hypot(b.x - bx, b.z - bz) < 0.5;
		ctx.moveBot(b, behind ? x : bx, behind ? z : bz, 3.3, dt);
		if (behind && Math.hypot(b.x - x, b.z - z) < 1.3 && (b.brain.kick ?? 0) < t) {
			b.brain.kick = t + 1.2 + Math.random();
			kickBall(ctx, b.id, dx, dz, 9);
		}
		b.x = THREE.MathUtils.clamp(b.x, -PITCH_X + 0.3, PITCH_X - 0.3);
		b.z = THREE.MathUtils.clamp(b.z, -PITCH_Z + 0.3, PITCH_Z - 0.3);
	},
	rank(s) {
		const goals = (s.g.goals as {a: number; b: number}) ?? {a: 0, b: 0};
		return teamRank(s, (s.g.teams as Record<string, string>) ?? {}, (t) => goals[t as 'a' | 'b'] ?? 0);
	},
};

/** El equipo chico juega con jugadores más grandes (con 3 jugadores, el que está solo). */
function soccerScale(teams: Record<string, string>, id: string): number {
	const team = teams[id];
	if (!team) return 1;
	const mine = Object.values(teams).filter((t) => t === team).length;
	const other = Object.values(teams).length - mine;
	return mine < other ? Math.min(1.7, 1 + 0.4 * (other - mine) / Math.max(1, mine)) : 1;
}

function kickBall(ctx: HostCtx, from: string, dx: number, dz: number, power: number): void {
	const pos = ctx.positions()[from];
	const [x, z, vx, vz] = (ctx.state.g.ball as number[]) ?? [0, 0, 0, 0];
	if (!pos || Math.hypot(x - pos.x, z - pos.z) > 1.8) return;
	const d = Math.hypot(dx, dz) || 1;
	ctx.setG({ball: [x, z, vx + (dx / d) * power, vz + (dz / d) * power]});
}

// ================================================================= 9 =====
// Pintura Pegajosa: pintá el piso con el color de tu equipo.

const PAINT = 20;

function paintCell(x: number, z: number): number {
	const col = Math.floor((x + R) / ((R * 2) / PAINT));
	const row = Math.floor((z + R) / ((R * 2) / PAINT));
	if (col < 0 || row < 0 || col >= PAINT || row >= PAINT) return -1;
	return row * PAINT + col;
}

const paint: GameDef = {
	id: 'paint', name: 'Pintura Pegajosa', color: '#ff4fa8', duration: 60, kind: 'team',
	desc: '¡Pintá más piso que los demás! En pares, Rosa contra Azul; si son impares, cada uno con su color.',
	how: 'Caminá por todos lados: donde pisás queda tu color (el aro de abajo te dice cuál es).',
	spawn: (i, n) => ring(i, n, 2),
	hostSetup(players) {
		return {teams: teamsOrSolo(players), cells: '0'.repeat(PAINT * PAINT)};
	},
	build(buildCtx) {
		const rings = new Map<string, THREE.Mesh>();
		const group = new THREE.Group();
		group.add(candyFloor('square', R, 'stripes', '#ffffff', '#f3ecff', 0xa066ff));
		const size = (R * 2) / PAINT;
		const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size * 0.96, 0.06, size * 0.96), new THREE.MeshStandardMaterial({roughness: 0.25}), PAINT * PAINT);
		const m = new THREE.Matrix4();
		const color = new THREE.Color();
		for (let i = 0; i < PAINT * PAINT; i++) {
			const x = -R + (i % PAINT + 0.5) * size;
			const z = -R + (Math.floor(i / PAINT) + 0.5) * size;
			m.makeTranslation(x, 0.08, z);
			mesh.setMatrixAt(i, m);
			mesh.setColorAt(i, color.setHex(0xffffff));
		}
		group.add(mesh);
		let shownCells = '';
		return {
			group,
			clamp: squareClamp(R - 0.3),
			update(c) {
				const teams = (c.state.g.teams as Record<string, string>) ?? {};
				for (const id of c.state.players) {
					const root = c.engine.actorRoot(id);
					if (!root || rings.get(id)?.parent === root) continue;
					rings.get(id)?.removeFromParent();
					const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 28), glossy(TEAM_COLORS[teams[id]] ?? 0xffffff, 0.6));
					ringMesh.rotation.x = Math.PI / 2;
					ringMesh.position.y = 0.06;
					ringMesh.userData.partyProp = true;
					root.add(ringMesh);
					rings.set(id, ringMesh);
				}
				const cells = (c.state.g.cells as string) ?? '';
				if (cells === shownCells) return;
				for (let i = 0; i < cells.length; i++) if (cells[i] !== shownCells[i]) mesh.setColorAt(i, color.setHex(TEAM_COLORS[cells[i]] ?? 0xffffff));
				shownCells = cells;
				if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
			},
			dispose: () => {
				for (const r of rings.values()) r.removeFromParent();
				void buildCtx;
				disposeGroup(group);
			},
		};
	},
	hostTick(ctx) {
		const teams = (ctx.state.g.teams as Record<string, string>) ?? {};
		const cells = ((ctx.state.g.cells as string) ?? '0'.repeat(PAINT * PAINT)).split('');
		let changed = false;
		for (const [id, p] of Object.entries(ctx.positions())) {
			if (!teams[id]) continue;
			for (const [ox, oz] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
				const i = paintCell(p.x + ox, p.z + oz);
				if (i >= 0 && cells[i] !== teams[id]) {
					cells[i] = teams[id];
					changed = true;
				}
			}
		}
		if (changed) ctx.setG({cells: cells.join('')});
	},
	bot(b, ctx, dt, t) {
		const teams = (ctx.state.g.teams as Record<string, string>) ?? {};
		const cells = (ctx.state.g.cells as string) ?? '';
		if ((b.brain.next ?? 0) < t) {
			b.brain.next = t + 1.2;
			let best: [number, number] = [0, 0];
			let bestD = 99;
			for (let k = 0; k < 20; k++) {
				const a = Math.random() * Math.PI * 2;
				const d = Math.random() * 7.5;
				const x = Math.cos(a) * d;
				const z = Math.sin(a) * d;
				const i = paintCell(x, z);
				if (i < 0 || cells[i] === teams[b.id]) continue;
				const dist = Math.hypot(x - b.x, z - b.z);
				if (dist < bestD) {
					bestD = dist;
					best = [x, z];
				}
			}
			[b.brain.tx, b.brain.tz] = best;
		}
		ctx.moveBot(b, b.brain.tx ?? 0, b.brain.tz ?? 0, 3.2, dt);
	},
	rank(s) {
		const cells = (s.g.cells as string) ?? '';
		const count = (team: string) => cells.split('').filter((c) => c === team).length;
		return multiTeamRank(s, (s.g.teams as Record<string, string>) ?? {}, count);
	},
};

// ================================================================= 10 ====
// Barco que se Hunde: la cubierta se ladea y los cañones de alrededor disparan cada vez más.

const DECK_X = 6.4;
const DECK_Z = 3.4;

function tilt(t: number, seed: number): number {
	const amp = 0.08 + Math.min(0.12, t * 0.002);
	return amp * Math.sin(t * 0.7 + (seed % 7)) + 0.04 * Math.sin(t * 1.7 + (seed % 5));
}

/** Los cañones: alrededor de la cubierta, apuntando hacia adentro. */
const CANNONS: Array<[number, number]> = Array.from({length: 12}, (_, k) => {
	const a = (k / 12) * Math.PI * 2;
	return [Math.cos(a) * (DECK_X + 2.2), Math.sin(a) * (DECK_Z + 2.4)];
});

interface Shot {
	t: number;
	cannon: number;
	tx: number;
	tz: number;
}

const SHOT_SPEED = 7.5;
const WARN_SHOT = 1.0;

/** Las andanadas: cada vez más seguido y con más cañones a la vez. */
function volleys(seed: number, duration: number): Shot[] {
	const r = mulberry(seed + 21);
	const shots: Shot[] = [];
	let t = 3;
	while (t < duration) {
		const count = Math.min(6, 1 + Math.floor(t / 11));
		const used = new Set<number>();
		for (let k = 0; k < count; k++) {
			let c = Math.floor(r() * CANNONS.length);
			while (used.has(c)) c = (c + 1) % CANNONS.length;
			used.add(c);
			shots.push({t: t + k * 0.12, cannon: c, tx: (r() - 0.5) * DECK_X * 1.6, tz: (r() - 0.5) * DECK_Z * 1.6});
		}
		t += Math.max(1.3, 3.0 - t * 0.025) * (0.8 + r() * 0.4);
	}
	return shots;
}

/** Dónde va la bala en el tiempo t (null si todavía no salió o ya se fue). */
function shotPos(s: Shot, t: number): {x: number; z: number; y: number; dx: number; dz: number} | null {
	const age = t - s.t;
	if (age < 0) return null;
	const [cx, cz] = CANNONS[s.cannon];
	const dx = s.tx - cx;
	const dz = s.tz - cz;
	const len = Math.hypot(dx, dz) || 1;
	const travel = age * SHOT_SPEED;
	const total = len + 9;
	if (travel > total) return null;
	return {x: cx + (dx / len) * travel, z: cz + (dz / len) * travel, y: 0.6 + Math.sin(Math.min(1, travel / total) * Math.PI) * 0.6, dx: dx / len, dz: dz / len};
}

const boat: GameDef = {
	id: 'boat', name: 'Barco que se Hunde', color: '#ff8a2a', duration: 80, kind: 'elim',
	desc: 'La cubierta se ladea y los cañones disparan cada vez más. ¡No te caigas!',
	how: 'Caminá contra la inclinación y saltá (Espacio) las bolas de cañón. El cañón brilla antes de disparar.',
	spawn: (i) => [((i % 5) - 2) * 1.6, (Math.floor(i / 5) - 0.5) * 1.6],
	build(ctx) {
		const group = new THREE.Group();
		const deck = new THREE.Group();
		const hull = new THREE.Mesh(new THREE.BoxGeometry(DECK_X * 2 + 0.4, 0.9, DECK_Z * 2 + 0.4), glossy(0xff8a2a));
		hull.position.y = -0.45;
		hull.castShadow = true;
		deck.add(hull);
		for (let k = 0; k < 8; k++) {
			const plank = new THREE.Mesh(new THREE.BoxGeometry(DECK_X * 2, 0.06, (DECK_Z * 2) / 8 - 0.06), glossy(k % 2 ? 0xffd9a0 : 0xffc978));
			plank.position.set(0, 0.03, -DECK_Z + ((k + 0.5) * DECK_Z * 2) / 8);
			plank.receiveShadow = true;
			deck.add(plank);
		}
		const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 5, 16), glossy(0xffffff));
		mast.position.set(0, 2.5, 0);
		const flag = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 3), glossy(0xff4fa8, 0.3));
		flag.rotation.z = -Math.PI / 2;
		flag.position.set(0.8, 4.4, 0);
		deck.add(mast, flag);
		group.add(deck);
		// Cañones sobre boyas inflables.
		const cannons = CANNONS.map(([x, z]) => {
			const g = new THREE.Group();
			const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.32, 14, 28), glossy(0xff4fa8));
			buoy.rotation.x = Math.PI / 2;
			const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.4, 20), glossy(0x5a3ea8));
			base.position.y = 0.25;
			const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.3, 20), glossy(0x2a1747, 0.05));
			barrel.rotation.x = Math.PI / 2 - 0.3;
			barrel.position.set(0, 0.7, 0.35);
			const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 10, 24), glossy(0xffd23f, 0.4));
			ringMesh.position.set(0, 0.92, 0.95);
			ringMesh.rotation.x = -0.3;
			g.add(buoy, base, barrel, ringMesh);
			g.position.set(x, -2.6, z);
			g.visible = false;
			group.add(g);
			return {g, barrel: barrel.material as THREE.MeshStandardMaterial};
		});
		const list = volleys(ctx.state.seed, this.duration);
		const pool = Array.from({length: 10}, () => {
			const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), glossy(0x2a1747, 0.1));
			ball.castShadow = true;
			ball.visible = false;
			group.add(ball);
			return ball;
		});
		const hit = new Set<number>();
		return {
			group,
			clamp: (p) => {
				p.x = THREE.MathUtils.clamp(p.x, -9, 9);
				p.z = THREE.MathUtils.clamp(p.z, -6, 6);
				return p;
			},
			support: (x, z) => Math.abs(x) <= DECK_X + 0.15 && Math.abs(z) <= DECK_Z + 0.15,
			update(c, dt, t) {
				const a = tilt(t, c.state.seed);
				deck.rotation.z = a;
				// Cada cañón sale del agua, gira hasta apuntar adonde va a tirar, brilla, dispara y se hunde.
				cannons.forEach(({g, barrel}, i) => {
					const shot = list.find((x) => x.cannon === i && t > x.t - WARN_SHOT - 0.4 && t < x.t + 0.8);
					if (!shot) {
						g.position.y += (-2.6 - g.position.y) * Math.min(1, dt * 5);
						g.visible = g.position.y > -2.4;
						return;
					}
					g.visible = true;
					g.position.y += (0 - g.position.y) * Math.min(1, dt * 7);
					const want = Math.atan2(shot.tx - g.position.x, shot.tz - g.position.z);
					let delta = want - g.rotation.y;
					delta = Math.atan2(Math.sin(delta), Math.cos(delta));
					g.rotation.y += delta * Math.min(1, dt * 8);
					const soon = t > shot.t - WARN_SHOT && t < shot.t;
					barrel.emissive.setHex(soon ? 0xff4422 : 0x2a1747);
					barrel.emissiveIntensity = soon ? 0.6 + Math.sin(t * 40) * 0.4 : 0.05;
					// Retroceso al disparar.
					const kick = t > shot.t && t < shot.t + 0.25 ? 1 - (t - shot.t) / 0.25 : 0;
					g.scale.set(1 + kick * 0.15, 1 - kick * 0.1, 1 + kick * 0.15);
				});
				let used = 0;
				const me = c.engine.myState();
				const alive = c.state.phase === 'play' && c.state.alive.includes(c.meId);
				list.forEach((s, i) => {
					const p = shotPos(s, t);
					if (!p || used >= pool.length) return;
					const ball = pool[used++];
					ball.visible = true;
					ball.position.set(p.x, p.y, p.z);
					if (alive && !hit.has(i) && me.y < 0.55 && Math.hypot(me.x - p.x, me.z - p.z) < 0.75) {
						hit.add(i);
						c.engine.push(p.dx, p.dz, 13);
					}
				});
				for (let i = used; i < pool.length; i++) pool[i].visible = false;
				if (alive) c.engine.push(-Math.sign(a) || 1, 0, Math.abs(a) * 26 * dt);
			},
			dispose: () => disposeGroup(group),
		};
	},
	bot(b, ctx, dt, t) {
		const list = (b.brain.list as unknown as Shot[] | undefined) ?? volleys(ctx.state.seed, 80);
		(b.brain as unknown as {list: Shot[]}).list = list;
		const a = tilt(t, ctx.state.seed);
		pushBot(b, -Math.sign(a) || 1, 0, Math.abs(a) * 22 * dt);
		let tx = Math.sign(a) * 2.2;
		let tz = b.z;
		for (let i = 0; i < list.length; i++) {
			const s = list[i];
			if (s.t > t + 1.2 || s.t < t - 3) continue;
			// Mira dónde va a estar la bala en el próximo segundo y se corre de esa línea.
			const later = shotPos(s, t + 0.6);
			if (later && Math.hypot(later.x - b.x, later.z - b.z) < 1.6) {
				tx = b.x - later.dz * 2;
				tz = b.z + later.dx * 2;
			}
			const now = shotPos(s, t);
			if (now && Math.hypot(now.x - b.x, now.z - b.z) < 0.7 && (b.brain[`h${i}`] ?? 0) === 0) {
				b.brain[`h${i}`] = 1;
				pushBot(b, now.dx, now.dz, 12);
			}
		}
		tx = THREE.MathUtils.clamp(tx, -DECK_X + 0.6, DECK_X - 0.6);
		tz = THREE.MathUtils.clamp(tz, -DECK_Z + 0.6, DECK_Z - 0.6);
		ctx.moveBot(b, tx, tz, 2.6, dt);
	},
	rank: elimRank,
};


export const GAMES: Record<GameId, GameDef> = {race, floor, king, bomb, fruit, colors, soccer, paint, boat, kart};
export const GAME_ORDER: GameId[] = ['race', 'kart', 'floor', 'king', 'bomb', 'fruit', 'colors', 'soccer', 'paint', 'boat'];
