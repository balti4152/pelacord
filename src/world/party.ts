/**
 * La ARENA: partidas de juegos party (estilo show de TV) con amigos y bots.
 *
 * Quién manda: el que arranca la partida (el "host") lleva el reloj de la partida, decide quién
 * queda afuera, mueve a los bots y reparte los puntos. Cada uno mueve SU personaje (como siempre) y
 * le avisa al host lo importante ("me caí", "pisé este casillero", "agarré la cola").
 *
 * Todo lo que se mueve solo (barras, frutas, barriles, colores) sale de una SEMILLA + el reloj de la
 * partida: cada PC lo calcula igual sin mandarlo por la red.
 *
 * Reloj: el host manda su hora en cada mensaje; cada cliente guarda la diferencia con la suya.
 */
import {useSyncExternalStore} from 'react';
import * as THREE from 'three';
import {getDesktopTransport} from '@/lib/desktop';
import {addCoins, type Look} from '@/world/core';
import type {WorldEngine, WorldMode} from '@/world/engine';
import {GAMES, type GameId, type GameScene, type PartyCtx} from '@/world/partyGames';
import {randomLook} from '@/world/npcs';

export type Phase = 'intro' | 'play' | 'results' | 'final';

export interface PartyState {
	id: string;
	host: string;
	phase: Phase;
	games: GameId[];
	round: number;
	players: string[];
	names: Record<string, string>;
	/** Vivos / todavía en juego (en los de eliminación). */
	alive: string[];
	/** Orden en que fueron quedando afuera o llegando (según el juego). */
	order: string[];
	/** Puntos de la ronda actual (para juegos por puntaje/equipos). */
	roundPts: Record<string, number>;
	scores: Record<string, number>;
	/** Último ranking de ronda (para la pantalla de resultados). */
	lastRanking: Array<{id: string; pts: number}>;
	phaseAt: number;
	phaseEnds: number;
	seed: number;
	/** Datos compartidos del juego (equipos, casilleros, pelota…). */
	g: Record<string, unknown>;
	t: number;
}

export interface PartySetup {
	games: GameId[];
	bots: number;
}

const INTRO_MS = 6500;
const RESULTS_MS = 6000;
const LOBBY: [number, number] = [0, -13.2];

let state: PartyState | null = null;
let offset = 0;
let meId = '';
let started = false;
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of listeners) l();
}

/** La hora "de la partida" (la del host). */
export function hostNow(): number {
	return Date.now() + offset;
}

export function getParty(): PartyState | null {
	return state;
}

export function useParty(): PartyState | null {
	return useSyncExternalStore((cb) => {
		listeners.add(cb);
		return () => listeners.delete(cb);
	}, () => state);
}

function send(message: Record<string, unknown>, to?: string): void {
	getDesktopTransport()?.sendWorld?.({kind: 'party', ...message, now: Date.now()}, to);
}

// ------------------------------------------------------------------ red ---

type Incoming = {kind?: string; type?: string; now?: number; s?: PartyState; b?: BotWire[]; a?: Record<string, unknown>; from?: string; target?: string; dx?: number; dz?: number; power?: number};
type BotWire = [string, number, number, number, number, string];

const botWire: Record<string, {x: number; y: number; z: number; ry: number; anim: string}> = {};
const inputListeners = new Set<(from: string, a: Record<string, unknown>) => void>();
const pushListeners = new Set<(target: string, dx: number, dz: number, power: number) => void>();

export function startParty(id: string): void {
	meId = id;
	if (started) return;
	started = true;
	getDesktopTransport()?.onWorld?.(({from, payload}) => {
		const m = payload as Incoming | null;
		if (m?.kind !== 'party') return;
		if (m.type === 'state' && m.s) {
			if (typeof m.now === 'number') offset = m.now - Date.now();
			if (m.s.host === meId) return;
			if (state && state.id === m.s.id && state.t >= m.s.t) return;
			state = m.s;
			emit();
		} else if (m.type === 'end') {
			if (state && state.host === from) {
				state = null;
				emit();
			}
		} else if (m.type === 'bots' && Array.isArray(m.b)) {
			for (const [id, x, y, z, ry, anim] of m.b) botWire[id] = {x, y, z, ry, anim};
		} else if (m.type === 'input' && m.a && state?.host === meId) {
			for (const l of inputListeners) l(from, m.a);
		} else if (m.type === 'push' && m.target) {
			for (const l of pushListeners) l(m.target, m.dx ?? 0, m.dz ?? 0, m.power ?? 6);
		}
	});
}

export function onPartyInput(cb: (from: string, a: Record<string, unknown>) => void): () => void {
	inputListeners.add(cb);
	return () => inputListeners.delete(cb);
}

export function onPartyPush(cb: (target: string, dx: number, dz: number, power: number) => void): () => void {
	pushListeners.add(cb);
	return () => pushListeners.delete(cb);
}

export function botPositions(): typeof botWire {
	return botWire;
}

// ---------------------------------------------------------------- host ---

/** Estado de los bots en la PC del host. */
interface HostBot {
	id: string;
	x: number;
	y: number;
	z: number;
	ry: number;
	vx: number;
	vz: number;
	vy: number;
	anim: 'idle' | 'walk' | 'run';
	alive: boolean;
	brain: Record<string, number>;
}

let hostTimer: number | null = null;
let hostBots: HostBot[] = [];
let botSendAt = 0;
let stateSendAt = 0;
let dirty = false;

const BOT_NAMES = ['Gomita', 'Pochoclo', 'Turrón', 'Chicle', 'Alfajor', 'Merengue', 'Caramelo', 'Frutilla', 'Mantecol'];

function publish(force = false): void {
	if (!state) return;
	state.t += 1;
	state = {...state};
	emit();
	dirty = true;
	if (force) flush();
}

function flush(): void {
	if (!state || !dirty) return;
	dirty = false;
	stateSendAt = Date.now();
	send({type: 'state', s: state});
}

/** El admin arma la partida con los que están en la Arena. */
export function hostStart(setup: PartySetup, people: Array<{id: string; name: string}>): void {
	if (!setup.games.length) return;
	const names: Record<string, string> = {};
	for (const p of people) names[p.id] = p.name;
	const bots: string[] = [];
	for (let i = 0; i < setup.bots; i++) {
		const id = `abot:${i}`;
		bots.push(id);
		names[id] = BOT_NAMES[i % BOT_NAMES.length];
	}
	const players = [...people.map((p) => p.id), ...bots];
	hostBots = bots.map((id) => ({id, x: 0, y: 0, z: 0, ry: 0, vx: 0, vz: 0, vy: 0, anim: 'idle', alive: true, brain: {}}));
	state = {
		id: `${meId}-${Date.now().toString(36)}`, host: meId, phase: 'intro', games: setup.games, round: 0, players, names,
		alive: [...players], order: [], roundPts: {}, scores: Object.fromEntries(players.map((p) => [p, 0])), lastRanking: [],
		phaseAt: Date.now(), phaseEnds: Date.now() + INTRO_MS, seed: Math.floor(Math.random() * 1e9), g: {}, t: 1,
	};
	offset = 0;
	paidFor = '';
	beginRound();
	if (hostTimer) window.clearInterval(hostTimer);
	hostTimer = window.setInterval(hostTick, 50);
}

export function hostStop(): void {
	if (hostTimer) window.clearInterval(hostTimer);
	hostTimer = null;
	hostBots = [];
	if (state?.host === meId) send({type: 'end'});
	state = null;
	emit();
}

export function hostSkip(): void {
	if (!state || state.host !== meId) return;
	if (state.phase === 'play') endRound();
	else if (state.phase === 'intro') {
		state.phaseEnds = Date.now();
	}
}

let hostScene: GameScene | null = null;

/** El host necesita la escena del juego para la lógica (pisos, pelota…): la registra el runtime. */
export function setHostScene(scene: GameScene | null): void {
	hostScene = scene;
}

function beginRound(): void {
	if (!state) return;
	const game = GAMES[state.games[state.round]];
	state.phase = 'intro';
	state.alive = [...state.players];
	state.order = [];
	state.roundPts = {};
	state.seed = Math.floor(Math.random() * 1e9);
	state.g = game.hostSetup ? game.hostSetup(state.players, state.seed) : {};
	state.phaseAt = Date.now();
	state.phaseEnds = Date.now() + INTRO_MS;
	const count = state.players.length;
	hostBots.forEach((b) => {
		const index = state!.players.indexOf(b.id);
		const [x, z] = game.spawn(index, count, state!.g);
		Object.assign(b, {x, z, y: 0, vx: 0, vz: 0, vy: 0, alive: true, anim: 'idle', brain: {}});
	});
	publish(true);
}

function endRound(): void {
	if (!state) return;
	const game = GAMES[state.games[state.round]];
	const ranking = game.rank(state);
	const pts = [10, 7, 5, 3];
	const lastRanking = ranking.map((group, i) => group.map((id) => ({id, pts: pts[i] ?? 1}))).flat();
	for (const {id, pts: p} of lastRanking) state.scores[id] = (state.scores[id] ?? 0) + p;
	state.lastRanking = lastRanking;
	state.phase = 'results';
	state.phaseAt = Date.now();
	state.phaseEnds = Date.now() + RESULTS_MS;
	publish(true);
}

function hostTick(): void {
	if (!state || state.host !== meId) return;
	const now = Date.now();
	const game = GAMES[state.games[state.round]];
	if (state.phase === 'intro' && now >= state.phaseEnds) {
		state.phase = 'play';
		state.phaseAt = now;
		state.phaseEnds = now + game.duration * 1000;
		publish(true);
	} else if (state.phase === 'play') {
		const t = (now - state.phaseAt) / 1000;
		const ctx = hostCtx();
		// Bots.
		for (const b of hostBots) {
			if (!b.alive || !state.alive.includes(b.id)) continue;
			game.bot?.(b, ctx, 0.05, t);
			botPhysics(b, ctx, t);
		}
		game.hostTick?.(ctx, 0.05, t);
		const enough = game.kind === 'elim' && state.alive.length <= (state.players.length > 1 ? 1 : 0);
		if (now >= state.phaseEnds || enough || ctx.finished) endRound();
	} else if (state.phase === 'results' && now >= state.phaseEnds) {
		if (state.round + 1 < state.games.length) {
			state.round += 1;
			beginRound();
		} else {
			state.phase = 'final';
			state.phaseAt = now;
			state.phaseEnds = now + 15000;
			publish(true);
		}
	} else if (state.phase === 'final' && now >= state.phaseEnds) {
		hostStop();
		return;
	}
	// Los bots se mandan seguido; el estado, cuando cambia (como mucho 6 veces por segundo).
	if (now - botSendAt > 120 && hostBots.length) {
		botSendAt = now;
		const b: BotWire[] = hostBots.map((x) => [x.id, round2(x.x), round2(x.y), round2(x.z), round2(x.ry), x.anim]);
		for (const [id, x, y, z, ry, anim] of b) botWire[id] = {x, y, z, ry, anim};
		send({type: 'bots', b});
	}
	if (dirty && now - stateSendAt > 160) flush();
	if (!dirty && now - stateSendAt > 2500) {
		dirty = true;
		flush();
	}
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

function botPhysics(b: HostBot, ctx: HostCtx, t: number): void {
	b.x += b.vx * 0.05;
	b.z += b.vz * 0.05;
	b.vx *= 0.85;
	b.vz *= 0.85;
	const game = GAMES[state!.games[state!.round]];
	const scene = hostScene;
	const outY = scene?.outY ?? -3.5;
	if (scene?.ground) {
		// Varios pisos: cae hasta el de abajo.
		const floorY = scene.ground(b.x, b.z, b.y, t);
		if (floorY === null || b.y > floorY + 0.02) {
			b.vy -= 22 * 0.05;
			b.y += b.vy * 0.05;
			if (floorY !== null && b.y <= floorY) {
				b.y = floorY;
				b.vy = 0;
			}
		} else b.y = floorY;
	} else {
		const supported = scene?.support ? scene.support(b.x, b.z, t) : true;
		if (!supported || b.y < -0.05) {
			b.vy -= 22 * 0.05;
			b.y += b.vy * 0.05;
			b.anim = 'walk';
		} else if (scene?.clamp) {
			const p = scene.clamp(new THREE.Vector3(b.x, 0, b.z));
			b.x = p.x;
			b.z = p.z;
		}
	}
	if (b.y < outY && b.alive) {
		if (game.respawns) {
			Object.assign(b, {x: (Math.random() - 0.5) * 3, z: b.brain.cp ?? -8, y: 0, vy: 0, vx: 0, vz: 0});
		} else {
			b.alive = false;
			ctx.out(b.id);
		}
	}
}

export interface HostCtx {
	state: PartyState;
	bots: HostBot[];
	positions(): Record<string, {x: number; y: number; z: number}>;
	out(id: string): void;
	finish(id: string): void;
	points(id: string, pts: number): void;
	setG(patch: Record<string, unknown>): void;
	finished: boolean;
	moveBot(b: HostBot, tx: number, tz: number, speed: number, dt: number): void;
}

let positionsGetter: () => Record<string, {x: number; y: number; z: number}> = () => ({});

export function setPositionsGetter(fn: () => Record<string, {x: number; y: number; z: number}>): void {
	positionsGetter = fn;
}

function hostCtx(): HostCtx {
	const ctx: HostCtx = {
		// Siempre el estado ACTUAL (cada cambio crea un objeto nuevo: con una copia guardada, dos bots
		// que pisaban casilleros en el mismo instante se pisaban los cambios y "no se caían").
		get state() {
			return state!;
		},
		bots: hostBots,
		positions: () => {
			const p = {...positionsGetter()};
			for (const b of hostBots) p[b.id] = {x: b.x, y: b.y, z: b.z};
			return p;
		},
		out(id) {
			if (!state || !state.alive.includes(id)) return;
			state.alive = state.alive.filter((x) => x !== id);
			state.order = [...state.order, id];
			const bot = hostBots.find((b) => b.id === id);
			if (bot) bot.alive = false;
			publish();
		},
		finish(id) {
			if (!state || state.order.includes(id)) return;
			state.order = [...state.order, id];
			publish();
			if (state.order.length >= state.players.length) ctx.finished = true;
		},
		points(id, pts) {
			if (!state) return;
			state.roundPts = {...state.roundPts, [id]: (state.roundPts[id] ?? 0) + pts};
			publish();
		},
		setG(patch) {
			if (!state) return;
			state.g = {...state.g, ...patch};
			publish();
		},
		finished: false,
		moveBot(b, tx, tz, speed, dt) {
			const dx = tx - b.x;
			const dz = tz - b.z;
			const d = Math.hypot(dx, dz);
			if (d < 0.08) {
				b.anim = 'idle';
				return;
			}
			const step = Math.min(d, speed * dt);
			b.x += (dx / d) * step;
			b.z += (dz / d) * step;
			b.ry = Math.atan2(dx, dz);
			b.anim = speed > 3 ? 'run' : 'walk';
		},
	};
	return ctx;
}

// Los mensajes de los jugadores al host.
onPartyInput((from, a) => {
	if (!state || state.host !== meId) return;
	const ctx = hostCtx();
	if (a.out) ctx.out(from);
	if (a.finish) ctx.finish(from);
	GAMES[state.games[state.round]]?.hostInput?.(from, a, ctx, (Date.now() - state.phaseAt) / 1000);
});
// Empujones a bots (los resuelve el host).
onPartyPush((target, dx, dz, power) => {
	if (!state || state.host !== meId) return;
	const b = hostBots.find((x) => x.id === target);
	if (!b) return;
	const len = Math.hypot(dx, dz) || 1;
	b.vx += (dx / len) * power;
	b.vz += (dz / len) * power;
});

/** Empuja a un bot desde la lógica del host (por ejemplo, barras que giran). */
export function pushBot(b: HostBot, dx: number, dz: number, power: number): void {
	const len = Math.hypot(dx, dz) || 1;
	b.vx += (dx / len) * power;
	b.vz += (dz / len) * power;
}

// ---------------------------------------------------------------- todos ---

export function sendInput(a: Record<string, unknown>): void {
	if (!state) return;
	if (state.host === meId) {
		for (const l of inputListeners) l(meId, a);
	} else send({type: 'input', a}, state.host);
}

/** Empujar a alguien (jugador o bot). */
export function sendPush(target: string, dx: number, dz: number, power: number): void {
	send({type: 'push', target, dx, dz, power});
	for (const l of pushListeners) l(target, dx, dz, power);
}

let paidFor = '';

/** Premio: según el puesto final y la cantidad de juegos jugados. */
export function payout(s: PartyState, id: string): {rank: number; coins: number} {
	const ranking = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0));
	const rank = ranking.indexOf(id) + 1;
	const perGame = rank === 1 ? 50 : rank === 2 ? 30 : rank === 3 ? 20 : 10;
	return {rank, coins: perGame * s.games.length};
}

export function claimPayout(s: PartyState): number {
	if (paidFor === s.id || !s.players.includes(meId)) return 0;
	paidFor = s.id;
	const {coins} = payout(s, meId);
	addCoins(coins);
	return coins;
}

// ------------------------------------------------------------- runtime ---

/**
 * El runtime de MI lado: arma la escena del juego actual, maneja mi personaje (caerse, quedar
 * afuera, empujones), dibuja los bots y le pasa al motor el "modo" del juego.
 */
export class PartyRuntime {
	private scene: GameScene | null = null;
	private sceneKey = '';
	private botLooks = new Map<string, Look>();
	private outSent = false;
	private decor: THREE.Group | null = null;
	/** Ya quedé afuera (lo sé yo antes de que lo confirme el host). */
	private outLocal = false;
	private wasAlive = false;
	private lastTime = 0;
	private modeKey = '';
	private disposeFns: Array<() => void> = [];

	constructor(private engine: WorldEngine, private root: THREE.Group) {
		this.disposeFns.push(onPartyPush((target, dx, dz, power) => {
			if (target === meId) engine.push(dx, dz, power);
		}));
		setPositionsGetter(() => engine.allPositions());
		// Si la sala de la Arena termina de cargar con un juego ya armado (entraste en medio de una
		// partida, o se reinició el mundo), la carga traía de vuelta el piso viejo y te dejaba en el
		// lobby: se vuelve a esconder y volvés a tu lugar en la cancha.
		const onReady = (room: string) => {
			if (room !== 'arena' || !this.scene || !state) return;
			this.hideField(true);
			const game = GAMES[state.games[state.round]];
			const index = state.players.indexOf(meId);
			if (game && index >= 0 && state.alive.includes(meId) && !this.outLocal) {
				const [x, z] = game.spawn(index, state.players.length, state.g);
				this.engine.teleport(x, z, 0);
			}
		};
		engine.roomReady.add(onReady);
		this.disposeFns.push(() => engine.roomReady.delete(onReady));
	}

	/** Se llama cuando cambia el estado de la partida o cada cuadro (ver WorldView). */
	sync(s: PartyState | null, inArena: boolean): void {
		// En el podio final ya no hay juego: se limpia todo y volvés al lobby (antes quedabas congelado
		// arriba del escenario del último juego).
		const active = Boolean(s && inArena && s.phase !== 'final');
		const game = s ? GAMES[s.games[s.round]] : null;
		const key = active && s && game ? `${s.id}|${s.round}` : '';
		if (key !== this.sceneKey) {
			this.scene?.dispose();
			this.scene = null;
			this.decor?.removeFromParent();
			this.decor = null;
			setHostScene(null);
			this.sceneKey = key;
			this.outSent = false;
			this.outLocal = false;
			this.wasAlive = false;
			if (active && s && game) {
				this.scene = game.build(this.ctx());
				this.root.add(this.scene.group);
				this.decor = buildDecor(game.color);
				this.root.add(this.decor);
				setHostScene(this.scene);
				// Me paro en mi lugar de salida.
				const index = s.players.indexOf(meId);
				if (index >= 0) {
					const [x, z] = game.spawn(index, s.players.length, s.g);
					this.engine.teleport(x, z, 0);
				}
				this.hideField(true);
			} else {
				this.hideField(false);
				this.engine.clearBots();
				this.engine.setMode(null);
				this.modeKey = '';
				if (inArena) this.backToLobby();
			}
		}
		if (!active || !s || !this.scene) return;
		// El modo se arma una sola vez por juego: volver a ponerlo en cada actualización del estado
		// reseteaba la caída (quedabas flotando) y repetía el sonido de caerse (el "sonido trabado").
		if (this.modeKey === key) return;
		this.modeKey = key;
		const scene = this.scene;
		const self = this;
		const live = () => state ?? s;
		// Se pregunta cada vez (no una sola al armar): apenas quedás afuera, el lobby es piso firme y no
		// seguís "cayéndote" (eso repetía el sonido de caída re fuerte, como trabado).
		const playing = () => !self.outLocal && live().players.includes(meId) && live().alive.includes(meId);
		const mode: WorldMode = {
			clamp: (p) => (playing() && scene.clamp ? scene.clamp(p) : self.lobbyClamp(p)),
			support: scene.support ? (x, z) => (playing() ? scene.support!(x, z, self.time(live())) : true) : undefined,
			ground: scene.ground ? (x, z, y) => (playing() ? scene.ground!(x, z, y, self.time(live())) : 0) : undefined,
			frozen: () => playing() && live().phase !== 'play',
			action: () => (playing() && live().phase === 'play' ? scene.action?.(self.ctx()) ?? false : false),
			update: () => self.frame(live()),
			speed: scene.speed ?? 1,
			wideCamera: true,
		};
		this.engine.setMode(mode);
	}

	private lobbyClamp(p: THREE.Vector3): THREE.Vector3 {
		p.x = THREE.MathUtils.clamp(p.x, -10.5, 10.5);
		p.z = THREE.MathUtils.clamp(p.z, -16, -10.4);
		return p;
	}

	private backToLobby(): void {
		const me = this.engine.myState();
		if (Math.hypot(me.x, me.z) < 10) this.engine.teleport(LOBBY[0] + (Math.random() - 0.5) * 4, LOBBY[1], 0);
	}

	private hideField(hidden: boolean): void {
		this.root.parent?.traverse((o) => {
			// Durante un juego no se ve el piso de la Arena ni los tubos de alrededor (molestaban).
			if (/^(FieldBase|ArenaRim|Bridge)/.test(o.name)) o.visible = !hidden;
		});
	}

	time(s: PartyState): number {
		return s.phase === 'play' ? Math.max(0, (hostNow() - s.phaseAt) / 1000) : 0;
	}

	private ctx(): PartyCtx {
		const s = state!;
		return {
			state: s,
			meId,
			engine: this.engine,
			t: this.time(s),
			send: (a) => {
				if (a.out) this.outLocal = true;
				sendInput(a);
			},
			push: sendPush,
			positions: () => {
				const p = {...this.engine.allPositions()};
				return p;
			},
		};
	}

	/** Mensaje grande del juego para mí (por ejemplo, el buscador que tiene que contar). */
	overlay(): string | null {
		if (!this.scene || !state) return null;
		return this.scene.overlay?.(this.ctx()) ?? null;
	}

	/** Cada cuadro: animaciones del juego, mi caída, los bots. */
	private frame(s: PartyState): void {
		if (!this.scene) return;
		const t = this.time(s);
		const dt = Math.min(0.1, Math.max(0, t - this.lastTime));
		this.lastTime = t;
		const ctx = this.ctx();
		this.scene.update(ctx, dt, t);
		if (this.decor) animateDecor(this.decor, performance.now() / 1000);
		// Bots: los mueve el host; acá se dibujan.
		const wire = botPositions();
		for (const id of s.players) {
			if (!id.startsWith('abot:')) continue;
			const b = wire[id];
			if (!b) continue;
			let look = this.botLooks.get(id);
			if (!look) {
				look = randomLook(mulberry(hash(id)));
				this.botLooks.set(id, look);
			}
			const gone = !s.alive.includes(id) && b.y < -3;
			if (gone) {
				this.engine.removeBot(id);
				continue;
			}
			this.engine.setBot(id, s.names[id] ?? 'Bot', look, b.x, b.y, b.z, b.ry, b.anim as 'idle');
		}
		// Me sacó el host (me explotó la bomba, por ejemplo): vuelo un toque y vuelvo al lobby a mirar.
		const aliveNow = s.alive.includes(meId);
		if (this.wasAlive && !aliveNow && !this.outLocal && s.phase === 'play') {
			this.outLocal = true;
			window.setTimeout(() => this.engine.teleport(LOBBY[0] + (Math.random() - 0.5) * 6, LOBBY[1], 0), 1100);
		}
		this.wasAlive = aliveNow;
		// Me caí al pozo: quedo afuera (aviso una sola vez) y vuelvo al lobby a mirar.
		const me = this.engine.myState();
		if (s.players.includes(meId) && s.alive.includes(meId) && me.y < (this.scene.outY ?? -3.5) && !this.outSent) {
			this.outSent = true;
			if (this.scene.respawn) {
				const [x, z] = this.scene.respawn(ctx);
				this.engine.teleport(x, z, 0);
				this.outSent = false;
			} else {
				this.outLocal = true;
				sendInput({out: true});
				this.engine.teleport(LOBBY[0] + (Math.random() - 0.5) * 6, LOBBY[1], 0);
			}
		}
	}

	dispose(): void {
		this.scene?.dispose();
		this.scene = null;
		this.decor?.removeFromParent();
		this.decor = null;
		setHostScene(null);
		this.engine.clearBots();
		this.engine.setMode(null);
		for (const fn of this.disposeFns) fn();
	}
}

/** Decoración del show mientras hay un juego: globos flotando con hilo y reflectores que barren. */
function buildDecor(accent: string): THREE.Group {
	const group = new THREE.Group();
	const colors = [0xff4fa8, 0xffd23f, 0x3fa4ff, 0xa066ff, 0xff8a2a, new THREE.Color(accent).getHex()];
	// Sólo atrás y a los costados (del lado de la cámara taparían el juego).
	for (let i = 0; i < 18; i++) {
		const a = THREE.MathUtils.degToRad(-15 + (i / 17) * 210);
		const r = 11.5 + (i % 3) * 0.9;
		const balloon = new THREE.Group();
		const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 16), new THREE.MeshStandardMaterial({color: colors[i % colors.length], roughness: 0.22}));
		ball.scale.y = 1.18;
		const knot = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 8), ball.material);
		knot.position.y = -0.68;
		knot.rotation.x = Math.PI;
		const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.2, 4), new THREE.MeshBasicMaterial({color: 0xffffff}));
		string.position.y = -1.8;
		balloon.add(ball, knot, string);
		balloon.position.set(Math.cos(a) * r, 3 + (i % 4) * 0.7, Math.sin(a) * r);
		balloon.userData.phase = i * 1.7;
		balloon.userData.baseY = balloon.position.y;
		group.add(balloon);
	}
	for (let i = 0; i < 4; i++) {
		const beam = new THREE.Mesh(
			new THREE.ConeGeometry(2.4, 16, 24, 1, true),
			new THREE.MeshBasicMaterial({color: colors[i], transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false}),
		);
		beam.position.set(i % 2 ? 12 : -12, 8, i < 2 ? 12 : 5);
		beam.userData.beam = i;
		group.add(beam);
	}
	return group;
}

function animateDecor(group: THREE.Group, t: number): void {
	for (const child of group.children) {
		if (child.userData.beam !== undefined) {
			const i = child.userData.beam as number;
			child.rotation.z = Math.sin(t * 0.6 + i * 1.3) * 0.5 + (child.position.x > 0 ? 0.6 : -0.6);
			child.rotation.x = Math.cos(t * 0.5 + i) * 0.3;
		} else {
			child.position.y = (child.userData.baseY as number) + Math.sin(t * 1.4 + (child.userData.phase as number)) * 0.25;
			child.rotation.z = Math.sin(t * 0.9 + (child.userData.phase as number)) * 0.08;
		}
	}
}

function hash(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return h >>> 0;
}

export function mulberry(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type {HostBot};
