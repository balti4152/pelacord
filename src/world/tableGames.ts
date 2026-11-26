/**
 * Juegos de la mesa redonda (Casa de juegos): Mano Loca (cartas), Ta-Te-Ti, 4 en línea, Memotest,
 * STOP (Tutti Frutti) y Carrera de Wikipedia.
 * Hasta 6 jugadores (los que estén sentados) y se puede completar con la compu.
 *
 * Quien arranca la partida es el "dueño": valida las jugadas y difunde el estado por la malla
 * (igual que el host de la Jam). Los demás le mandan sus jugadas.
 */
import {useSyncExternalStore} from 'react';
import {addCoins, onGame, sendWorld} from '@/world/core';

export type TableGameKind = 'cards' | 'tateti' | 'cuatro' | 'memo' | 'stop' | 'wiki';
/** `bots: false` = juegos de escribir o navegar: sólo personas. */
export const TABLE_GAMES: Array<{id: TableGameKind; name: string; min: number; max: number; desc: string; bots: boolean}> = [
	{id: 'cards', name: 'Mano Loca', min: 2, max: 6, desc: 'Igualá color o número y quedate sin cartas', bots: true},
	{id: 'stop', name: 'STOP!', min: 1, max: 6, desc: 'Una letra, cinco categorías: el primero que termina grita ¡Basta!', bots: false},
	{id: 'wiki', name: 'Carrera Wiki', min: 1, max: 6, desc: 'Llegá a la página secreta de Wikipedia tocando sólo enlaces', bots: false},
	{id: 'memo', name: 'Memotest', min: 2, max: 6, desc: 'Dá vuelta dos cartas y encontrá los pares', bots: true},
	{id: 'cuatro', name: '4 en línea', min: 2, max: 2, desc: 'Cuatro fichas seguidas en cualquier dirección', bots: true},
	{id: 'tateti', name: 'Ta-Te-Ti', min: 2, max: 2, desc: 'El clásico tres en línea', bots: true},
];

// ------------------------------------------------------------------ STOP ---

/** Categorías comunes del STOP / Tutti Frutti (se eligen 5 al azar por ronda). */
export const STOP_CATEGORIES = [
	'Nombre', 'Apellido', 'Animal', 'Color', 'Fruta o verdura', 'País', 'Ciudad', 'Cosa', 'Comida', 'Marca',
	'Profesión', 'Película o serie', 'Cantante o banda', 'Deporte', 'Objeto de la casa', 'Parte del cuerpo',
	'Instrumento', 'Famoso', 'Bebida', 'Ropa', 'Flor o planta', 'Videojuego', 'Superhéroe', 'Postre',
	'Equipo de fútbol', 'Verbo', 'Programa de TV', 'Transporte', 'Golosina', 'Nombre de mascota',
	'Herramienta', 'Palabra en inglés', 'Personaje de dibujito', 'Lugar de vacaciones', 'Algo que da miedo',
];
const STOP_LETTERS = 'ABCDEFGHIJLMNOPRSTUV';
export type StopPhase = 'roll' | 'write' | 'stopping' | 'review' | 'results' | 'final';
/** Minúsculas, sin tildes ni espacios de más: así "MATE", "mate" y "Maté" son la misma respuesta. */
export const normalizeAnswer = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Puntos de cada respuesta: 10 si es válida y única, 5 si se repite con otro, 0 si no vale. */
export function stopPoints(s: TableSession): Record<string, number[]> {
	const out: Record<string, number[]> = {};
	const letter = normalizeAnswer(s.letter ?? '');
	const valid = (player: string, cat: number): boolean => {
		const answer = normalizeAnswer(s.answers?.[player]?.[cat] ?? '');
		if (!answer || !answer.startsWith(letter)) return false;
		const votes = Object.values(s.votes?.[`${player}|${cat}`] ?? {});
		const no = votes.filter((v) => !v).length;
		return no <= votes.length - no;
	};
	for (const player of s.players) {
		out[player] = (s.categories ?? []).map((_, cat) => {
			if (!valid(player, cat)) return 0;
			const mine = normalizeAnswer(s.answers![player][cat]);
			const repeated = s.players.some((other) => other !== player && valid(other, cat) && normalizeAnswer(s.answers![other][cat]) === mine);
			return repeated ? 5 : 10;
		});
	}
	return out;
}

function stopRound(s: TableSession): void {
	// La letra cambia cada ronda (sin repetir); las categorías son las mismas toda la partida.
	const used = new Set(s.usedLetters ?? []);
	const pool = STOP_LETTERS.split('').filter((l) => !used.has(l));
	s.letter = (pool.length ? pool : STOP_LETTERS.split(''))[Math.floor(Math.random() * (pool.length || STOP_LETTERS.length))];
	s.usedLetters = [...(s.usedLetters ?? []), s.letter];
	if (!s.categories?.length) s.categories = shuffle(STOP_CATEGORIES).slice(0, 5);
	s.phase = 'roll';
	s.answers = Object.fromEntries(s.players.map((p) => [p, ['', '', '', '', '']]));
	s.votes = {};
	s.ready = [];
	s.stopBy = null;
	s.roundPoints = {};
	s.round = (s.round ?? 0) + 1;
	s.note = `Ronda ${s.round}`;
}

// ---------------------------------------------------------- Carrera Wiki ---

/** Páginas de llegada: temas conocidos (títulos exactos de es.wikipedia). */
export const WIKI_TARGETS = [
	'Lionel Messi', 'Pizza', 'Luna', 'Guitarra', 'Dinosauria', 'Japón', 'Fútbol', 'Volcán', 'Chocolate', 'Batman',
	'Minecraft', 'Antiguo Egipto', 'Albert Einstein', 'Tango', 'Café', 'Internet', 'Elephantidae', 'Mar', 'Buenos Aires',
	'Pokémon', 'Leonardo da Vinci', 'Sistema solar', 'Harry Potter', 'Mate (infusión)', 'Torre Eiffel', 'Abeja',
	'Música rock', 'Juegos Olímpicos', 'Tiburón', 'Montaña', 'Queso', 'Dragón', 'Robot', 'Selva amazónica', 'Pingüino',
];
export const WIKI_STARTS = [
	'Tostadora', 'Caracol', 'Paraguas', 'Bicicleta', 'Cebolla', 'Escalera', 'Faro', 'Calcetín', 'Sartén', 'Globo aerostático',
	'Lápiz', 'Reloj de arena', 'Tornillo', 'Cactaceae', 'Hamaca', 'Brújula', 'Silla', 'Linterna', 'Vela (iluminación)', 'Sandía',
];
export const wikiKey = (title: string): string => normalizeAnswer(title.replace(/_/g, ' '));

export type CardColor = 'r' | 'y' | 'g' | 'b' | 'w';
export type CardValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'skip' | 'rev' | '+2' | 'wild' | '+4';
export interface Card {
	id: string;
	color: CardColor;
	value: CardValue;
}

export interface TableSession {
	id: string;
	game: TableGameKind;
	host: string;
	/** En orden de asiento. Los bots son "bot:N". */
	players: string[];
	turn: number;
	winner: string | null;
	draw: boolean;
	updatedAt: number;
	note: string;
	// cartas
	hands?: Record<string, Card[]>;
	deck?: Card[];
	discard?: Card[];
	color?: CardColor;
	direction?: 1 | -1;
	// tableros
	board?: (string | null)[];
	cards?: string[];
	revealed?: number[];
	matched?: Record<number, string>;
	score?: Record<string, number>;
	/** Memotest: las dos cartas quedan a la vista hasta este momento (después se dan vuelta solas). */
	flipping?: boolean;
	// STOP
	letter?: string;
	categories?: string[];
	phase?: StopPhase;
	answers?: Record<string, string[]>;
	stopBy?: string | null;
	/** `jugador|categoría` → quién votó → si vale. */
	votes?: Record<string, Record<string, boolean>>;
	ready?: string[];
	roundPoints?: Record<string, number[]>;
	totals?: Record<string, number>;
	round?: number;
	/** Cuántas rondas tiene la partida. */
	rounds?: number;
	usedLetters?: string[];
	// Carrera Wiki
	wikiStart?: string;
	wikiTarget?: string;
	wikiAt?: Record<string, {title: string; clicks: number}>;
}

export type TableMove =
	| {kind: 'play'; card: string; color?: CardColor}
	| {kind: 'draw'}
	| {kind: 'cell'; cell: number}
	| {kind: 'answers'; answers: string[]}
	| {kind: 'basta'; answers: string[]}
	| {kind: 'vote'; target: string; cat: number; ok: boolean}
	| {kind: 'ready'}
	| {kind: 'finish'}
	| {kind: 'next'}
	| {kind: 'wiki'; title: string}
	/** Interno (lo manda el dueño de la partida): pasar de fase cuando se cumple un tiempo. */
	| {kind: 'tick'};

export type TableMessage =
	| {type: 'table'; session: TableSession}
	| {type: 'table-move'; id: string; move: TableMove}
	| {type: 'table-end'; id: string};

const COLORS: CardColor[] = ['r', 'y', 'g', 'b'];
export const CARD_COLOR_HEX: Record<CardColor, string> = {r: '#ff4d5e', y: '#ffc93c', g: '#3ccf7a', b: '#4f8dff', w: '#2a1747'};
export const CARD_COLOR_NAME: Record<CardColor, string> = {r: 'rojo', y: 'amarillo', g: 'verde', b: 'azul', w: 'comodín'};
export const MEMO_SYMBOLS = ['star', 'heart', 'moon', 'bolt', 'circle', 'triangle', 'square', 'diamond'];
const COLS = 7;
const ROWS = 6;

export const isBot = (id: string) => id.startsWith('bot:');

function shuffle<T>(list: T[]): T[] {
	const copy = [...list];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

function newDeck(): Card[] {
	const cards: Card[] = [];
	let n = 0;
	for (const color of COLORS) {
		cards.push({id: `c${n++}`, color, value: '0'});
		for (const value of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', '+2'] as CardValue[]) {
			cards.push({id: `c${n++}`, color, value}, {id: `c${n++}`, color, value});
		}
	}
	for (let i = 0; i < 4; i++) cards.push({id: `c${n++}`, color: 'w', value: 'wild'}, {id: `c${n++}`, color: 'w', value: '+4'});
	return shuffle(cards);
}

export function canPlay(session: TableSession, card: Card): boolean {
	const top = session.discard?.[session.discard.length - 1];
	if (!top) return true;
	return card.color === 'w' || card.color === session.color || card.value === top.value;
}

export function createSession(game: TableGameKind, host: string, players: string[], rounds = 3): TableSession {
	const base: TableSession = {id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, game, host, players, turn: 0, winner: null, draw: false, updatedAt: Date.now(), note: '¡Arranca!'};
	if (game === 'cards') {
		const deck = newDeck();
		const hands: Record<string, Card[]> = {};
		for (const p of players) hands[p] = deck.splice(0, 7);
		let first = deck.shift() as Card;
		while (first.color === 'w') {
			deck.push(first);
			first = deck.shift() as Card;
		}
		return {...base, hands, deck, discard: [first], color: first.color, direction: 1};
	}
	if (game === 'tateti') return {...base, board: new Array(9).fill(null)};
	if (game === 'cuatro') return {...base, board: new Array(COLS * ROWS).fill(null)};
	if (game === 'stop') {
		const s: TableSession = {...base, totals: Object.fromEntries(players.map((p) => [p, 0])), round: 0, rounds: Math.max(1, Math.min(10, rounds))};
		stopRound(s);
		return s;
	}
	if (game === 'wiki') {
		const start = WIKI_STARTS[Math.floor(Math.random() * WIKI_STARTS.length)];
		const target = WIKI_TARGETS[Math.floor(Math.random() * WIKI_TARGETS.length)];
		return {...base, wikiStart: start, wikiTarget: target, wikiAt: Object.fromEntries(players.map((p) => [p, {title: start, clicks: 0}])), note: `De «${start}» a «${target}»`};
	}
	const cards = shuffle([...MEMO_SYMBOLS, ...MEMO_SYMBOLS]);
	return {...base, board: new Array(16).fill(null), cards, revealed: [], matched: {}, score: Object.fromEntries(players.map((p) => [p, 0]))};
}

/** STOP y la Carrera Wiki: juegan todos a la vez (no hay turnos). */
function applySimultaneous(prev: TableSession, player: string, move: TableMove, names: (id: string) => string): TableSession | null {
	const s: TableSession = JSON.parse(JSON.stringify(prev));
	s.updatedAt = Date.now();
	const who = names(player);
	if (s.game === 'wiki') {
		if (s.winner || move.kind !== 'wiki' || !s.players.includes(player)) return null;
		const at = s.wikiAt![player] ?? {title: s.wikiStart!, clicks: 0};
		s.wikiAt![player] = {title: move.title.slice(0, 200), clicks: at.clicks + 1};
		if (wikiKey(move.title) === wikiKey(s.wikiTarget!)) {
			s.winner = player;
			s.note = `¡${who} llegó a «${s.wikiTarget}» en ${at.clicks + 1} clics!`;
		}
		return s;
	}
	// STOP
	const clean = (list: string[]) => (s.categories ?? []).map((_, i) => String(list?.[i] ?? '').slice(0, 40));
	switch (move.kind) {
		case 'tick':
			if (s.phase === 'roll') {
				s.phase = 'write';
				s.note = `¡A escribir con la ${s.letter}!`;
			} else if (s.phase === 'stopping') {
				s.phase = 'review';
				s.note = 'Revisión: votá si las respuestas valen';
			} else return null;
			return s;
		case 'answers':
			if ((s.phase !== 'write' && s.phase !== 'stopping') || !s.players.includes(player)) return null;
			s.answers![player] = clean(move.answers);
			return s;
		case 'basta': {
			if (s.phase !== 'write' || !s.players.includes(player)) return null;
			const answers = clean(move.answers);
			if (answers.some((a) => !a.trim())) return null;
			s.answers![player] = answers;
			s.phase = 'stopping';
			s.stopBy = player;
			s.note = `¡${who} dijo BASTA!`;
			return s;
		}
		case 'vote':
			if (s.phase !== 'review' || move.target === player || !s.players.includes(player)) return null;
			s.votes![`${move.target}|${move.cat}`] = {...(s.votes![`${move.target}|${move.cat}`] ?? {}), [player]: Boolean(move.ok)};
			return s;
		case 'ready':
		case 'finish':
			if (s.phase !== 'review') return null;
			if (move.kind === 'finish' && player !== s.host) return null;
			if (!s.ready!.includes(player)) s.ready!.push(player);
			if (move.kind === 'finish' || s.players.every((p) => s.ready!.includes(p))) {
				s.roundPoints = stopPoints(s);
				for (const p of s.players) s.totals![p] = (s.totals![p] ?? 0) + s.roundPoints[p].reduce((a, b) => a + b, 0);
				s.phase = 'results';
				const best = Math.max(...s.players.map((p) => s.roundPoints![p].reduce((a, b) => a + b, 0)));
				const leaders = s.players.filter((p) => s.roundPoints![p].reduce((a, b) => a + b, 0) === best);
				s.note = leaders.length === 1 ? `¡${names(leaders[0])} ganó la ronda con ${best} puntos!` : `Empate con ${best} puntos`;
			}
			return s;
		case 'next':
			if (s.phase !== 'results' || player !== s.host) return null;
			// Última ronda: el ganador es el que sumó más en total.
			if ((s.round ?? 1) >= (s.rounds ?? 3)) {
				s.phase = 'final';
				const best = Math.max(...s.players.map((p) => s.totals![p] ?? 0));
				const leaders = s.players.filter((p) => (s.totals![p] ?? 0) === best);
				if (leaders.length === 1) s.winner = leaders[0];
				else s.draw = true;
				s.note = leaders.length === 1 ? `¡${names(leaders[0])} ganó la partida con ${best} puntos!` : `¡Empate con ${best} puntos!`;
				return s;
			}
			stopRound(s);
			return s;
		default:
			return null;
	}
}

function nextIndex(session: TableSession, steps = 1): number {
	const n = session.players.length;
	return (((session.turn + (session.direction ?? 1) * steps) % n) + n) % n;
}

function drawCards(session: TableSession, player: string, count: number): void {
	for (let i = 0; i < count; i++) {
		if (!session.deck!.length) {
			const top = session.discard!.pop() as Card;
			session.deck = shuffle(session.discard!.map((c) => (c.value === 'wild' || c.value === '+4' ? {...c, color: 'w' as CardColor} : c)));
			session.discard = [top];
		}
		const card = session.deck!.shift();
		if (card) session.hands![player].push(card);
	}
}

const TATETI_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export function cuatroDrop(board: (string | null)[], col: number): number {
	for (let row = ROWS - 1; row >= 0; row--) if (!board[row * COLS + col]) return row * COLS + col;
	return -1;
}

function cuatroWinner(board: (string | null)[]): string | null {
	const at = (r: number, c: number) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? board[r * COLS + c] : null);
	for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
		const who = at(r, c);
		if (!who) continue;
		for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
			if (at(r + dr, c + dc) === who && at(r + 2 * dr, c + 2 * dc) === who && at(r + 3 * dr, c + 3 * dc) === who) return who;
		}
	}
	return null;
}

/** Aplica una jugada (validada). Devuelve la sesión nueva o null si no vale. */
export function applyTableMove(prev: TableSession, player: string, move: TableMove, names: (id: string) => string = (id) => id): TableSession | null {
	if (prev.game === 'stop' || prev.game === 'wiki') return applySimultaneous(prev, player, move, names);
	// Memotest: las dos cartas que no coincidieron se dan vuelta solas y pasa el turno.
	if (move.kind === 'tick') {
		if (prev.game !== 'memo' || !prev.flipping) return null;
		const s: TableSession = JSON.parse(JSON.stringify(prev));
		s.updatedAt = Date.now();
		s.revealed = [];
		s.flipping = false;
		s.turn = nextIndex(s);
		return s;
	}
	if (prev.winner || prev.draw || prev.flipping || prev.players[prev.turn] !== player) return null;
	const s: TableSession = JSON.parse(JSON.stringify(prev));
	s.updatedAt = Date.now();
	const who = names(player);
	if (s.game === 'cards') {
		const hand = s.hands![player];
		if (move.kind === 'draw') {
			drawCards(s, player, 1);
			s.turn = nextIndex(s);
			s.note = `${who} levantó una carta`;
			return s;
		}
		if (move.kind !== 'play') return null;
		const index = hand.findIndex((c) => c.id === move.card);
		if (index < 0 || !canPlay(s, hand[index])) return null;
		const [card] = hand.splice(index, 1);
		s.discard!.push(card);
		s.color = card.color === 'w' ? (move.color ?? 'r') : card.color;
		if (!hand.length) {
			s.winner = player;
			s.note = `¡${who} se quedó sin cartas!`;
			return s;
		}
		const n = s.players.length;
		if (card.value === 'rev') {
			s.direction = (s.direction === 1 ? -1 : 1);
			s.turn = n === 2 ? s.turn : nextIndex(s);
			s.note = `${who} invirtió la ronda`;
		} else if (card.value === 'skip') {
			s.turn = nextIndex(s, 2);
			s.note = `${who} saltó al siguiente`;
		} else if (card.value === '+2' || card.value === '+4') {
			const victim = s.players[nextIndex(s)];
			drawCards(s, victim, card.value === '+2' ? 2 : 4);
			s.turn = nextIndex(s, 2);
			s.note = `${names(victim)} levanta ${card.value === '+2' ? 2 : 4}`;
		} else {
			s.turn = nextIndex(s);
			s.note = card.color === 'w' ? `${who} eligió ${CARD_COLOR_NAME[s.color]}` : `${who} jugó`;
		}
		return s;
	}
	if (move.kind !== 'cell') return null;
	const board = s.board!;
	if (s.game === 'tateti') {
		if (board[move.cell]) return null;
		board[move.cell] = player;
		for (const [a, b, c] of TATETI_LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) s.winner = board[a];
		s.draw = !s.winner && board.every(Boolean);
		s.turn = nextIndex(s);
		return s;
	}
	if (s.game === 'cuatro') {
		const index = cuatroDrop(board, move.cell % COLS);
		if (index < 0) return null;
		board[index] = player;
		s.winner = cuatroWinner(board);
		s.draw = !s.winner && board.every(Boolean);
		s.turn = nextIndex(s);
		return s;
	}
	// Memotest
	const cell = move.cell;
	if (s.matched![cell] !== undefined || s.revealed!.includes(cell)) return null;
	s.revealed!.push(cell);
	if (s.revealed!.length === 2) {
		const [a, b] = s.revealed!;
		if (s.cards![a] === s.cards![b]) {
			s.matched![a] = player;
			s.matched![b] = player;
			s.score![player] = (s.score![player] ?? 0) + 1;
			s.revealed = [];
			s.note = `¡${who} encontró un par!`;
		} else {
			// Quedan a la vista un segundo (para que todos las vean) y después se dan vuelta solas.
			s.flipping = true;
			s.note = `${who} no acertó`;
		}
	}
	if (Object.keys(s.matched!).length === s.cards!.length) {
		const best = Math.max(...Object.values(s.score!));
		const leaders = s.players.filter((p) => s.score![p] === best);
		if (leaders.length === 1) s.winner = leaders[0];
		else s.draw = true;
	}
	return s;
}

function botMove(s: TableSession, bot: string): TableMove {
	if (s.game === 'cards') {
		const hand = s.hands![bot];
		const playable = hand.filter((c) => canPlay(s, c));
		const pick = playable.find((c) => c.color === s.color && c.color !== 'w') ?? playable.find((c) => c.color !== 'w') ?? playable[0];
		if (!pick) return {kind: 'draw'};
		const counts: Record<string, number> = {};
		for (const c of hand) if (c.color !== 'w') counts[c.color] = (counts[c.color] ?? 0) + 1;
		const color = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'r') as CardColor;
		return {kind: 'play', card: pick.id, color};
	}
	const free = (s.board ?? []).map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
	if (s.game === 'memo') {
		const hidden = s.cards!.map((_, i) => i).filter((i) => s.matched![i] === undefined && !(s.revealed!.length === 1 && s.revealed![0] === i));
		const first = s.revealed!.length === 1 ? s.revealed![0] : null;
		if (first !== null && Math.random() < 0.5) {
			const pair = hidden.find((i) => s.cards![i] === s.cards![first]);
			if (pair !== undefined) return {kind: 'cell', cell: pair};
		}
		return {kind: 'cell', cell: hidden[Math.floor(Math.random() * hidden.length)]};
	}
	const options = s.game === 'cuatro' ? [...new Set(free.map((i) => i % COLS))] : free;
	for (const who of [bot, ...s.players.filter((p) => p !== bot)]) {
		for (const cell of options) {
			const test = applyTableMove({...s, turn: s.players.indexOf(who)}, who, {kind: 'cell', cell});
			if (test?.winner === who) return {kind: 'cell', cell};
		}
	}
	return {kind: 'cell', cell: options[Math.floor(Math.random() * options.length)]};
}

// ------------------------------------------------------------- red/estado ---

let session: TableSession | null = null;
let myId = '';
let nameOf: (id: string) => string = (id) => id;
const listeners = new Set<() => void>();
const rewarded = new Set<string>();
let started = false;

function emit(): void {
	for (const listener of listeners) listener();
}

function setSession(next: TableSession | null): void {
	session = next;
	if (next && (next.winner || next.draw) && !rewarded.has(next.id) && next.players.includes(myId)) {
		rewarded.add(next.id);
		if (next.winner === myId) addCoins(next.game === 'cards' ? 80 : 60);
		else if (next.draw) addCoins(20);
	}
	// STOP: el que más puntos hizo en la ronda se lleva monedas.
	if (next && next.game === 'stop' && next.phase === 'results' && next.players.includes(myId) && !rewarded.has(`${next.id}:${next.round}`)) {
		rewarded.add(`${next.id}:${next.round}`);
		const sum = (p: string) => (next.roundPoints?.[p] ?? []).reduce((a, b) => a + b, 0);
		if (sum(myId) > 0 && next.players.every((p) => p === myId || sum(p) < sum(myId))) addCoins(40);
	}
	emit();
	if (next && next.host === myId) scheduleHost(next);
	if (next && next.host === myId && !next.winner && !next.draw && next.game !== 'stop' && next.game !== 'wiki' && !next.flipping && isBot(next.players[next.turn])) {
		const botId = next.players[next.turn];
		setTimeout(() => {
			if (!session || session.id !== next.id || session.players[session.turn] !== botId) return;
			const moved = applyTableMove(session, botId, botMove(session, botId), nameOf);
			if (moved) publish(moved);
		}, 900);
	}
}

let hostTimer: ReturnType<typeof setTimeout> | null = null;

/** El dueño de la partida maneja los tiempos: fases del STOP, el Memotest y el robo automático. */
function scheduleHost(next: TableSession): void {
	if (hostTimer) clearTimeout(hostTimer);
	hostTimer = null;
	if (next.winner || next.draw) return;
	const later = (ms: number, player: string, move: TableMove) => {
		hostTimer = setTimeout(() => {
			hostTimer = null;
			if (!session || session.id !== next.id || session.updatedAt !== next.updatedAt) return;
			const moved = applyTableMove(session, player, move, nameOf);
			if (moved) publish(moved);
		}, ms);
	};
	if (next.game === 'stop') {
		if (next.phase === 'roll') later(4600, next.host, {kind: 'tick'});
		else if (next.phase === 'stopping') later(1500, next.host, {kind: 'tick'});
		return;
	}
	if (next.game === 'memo' && next.flipping) {
		later(1100, next.host, {kind: 'tick'});
		return;
	}
	// Mano Loca: si al que le toca no tiene ninguna carta para tirar, a los 3 segundos levanta solo y pasa.
	if (next.game === 'cards') {
		const current = next.players[next.turn];
		if (isBot(current)) return;
		const playable = next.hands?.[current]?.some((card) => canPlay(next, card));
		if (!playable) later(3000, current, {kind: 'draw'});
	}
}

function publish(next: TableSession): void {
	setSession(next);
	sendWorld({kind: 'game', g: {type: 'table', session: next} as never});
}

function ensureStarted(): void {
	if (started) return;
	started = true;
	onGame((raw, from) => {
		const message = raw as unknown as TableMessage;
		if (message.type === 'table') {
			if (message.session.host !== from) return;
			if (session && session.id === message.session.id && session.updatedAt > message.session.updatedAt) return;
			setSession(message.session);
		} else if (message.type === 'table-move') {
			if (!session || session.id !== message.id || session.host !== myId) return;
			const moved = applyTableMove(session, from, message.move, nameOf);
			if (moved) publish(moved);
		} else if (message.type === 'table-end') {
			if (session && session.id === message.id && session.host === from) setSession(null);
		}
	});
}

export const table = {
	init(me: string, names: (id: string) => string): void {
		myId = me;
		nameOf = names;
		ensureStarted();
	},
	/** Arranca una partida con los que están sentados (y bots para completar). */
	start(game: TableGameKind, seated: string[], bots: number, rounds = 3): void {
		const def = TABLE_GAMES.find((g) => g.id === game)!;
		if (!def.bots) bots = 0;
		const players = [...seated];
		for (let i = 0; players.length < Math.min(def.max, Math.max(def.min, seated.length + bots)); i++) players.push(`bot:${i + 1}`);
		publish(createSession(game, myId, players.slice(0, def.max), rounds));
	},
	move(move: TableMove): void {
		if (!session) return;
		if (session.host === myId) {
			const moved = applyTableMove(session, myId, move, nameOf);
			if (moved) publish(moved);
		} else {
			sendWorld({kind: 'game', g: {type: 'table-move', id: session.id, move} as never}, session.host);
		}
	},
	end(): void {
		if (!session) return;
		if (session.host === myId) sendWorld({kind: 'game', g: {type: 'table-end', id: session.id} as never});
		setSession(null);
	},
	get(): TableSession | null {
		return session;
	},
};

export function useTableSession(): TableSession | null {
	return useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => session,
	);
}
