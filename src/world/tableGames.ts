/**
 * Juegos de la mesa redonda (Casa de juegos): Mano Loca (cartas), Ta-Te-Ti, 4 en línea y Memotest.
 * Hasta 6 jugadores (los que estén sentados) y se puede completar con la compu.
 *
 * Quien arranca la partida es el "dueño": valida las jugadas y difunde el estado por la malla
 * (igual que el host de la Jam). Los demás le mandan sus jugadas.
 */
import {useSyncExternalStore} from 'react';
import {addCoins, onGame, sendWorld} from '@/world/core';

export type TableGameKind = 'cards' | 'tateti' | 'cuatro' | 'memo';
export const TABLE_GAMES: Array<{id: TableGameKind; name: string; min: number; max: number; desc: string}> = [
	{id: 'cards', name: 'Mano Loca', min: 2, max: 6, desc: 'Cartas de colores: igualá color o número'},
	{id: 'tateti', name: 'Ta-Te-Ti', min: 2, max: 2, desc: 'Tres en línea'},
	{id: 'cuatro', name: '4 en línea', min: 2, max: 2, desc: 'Cuatro fichas seguidas'},
	{id: 'memo', name: 'Memotest', min: 2, max: 6, desc: 'Encontrá los pares'},
];

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
}

export type TableMove =
	| {kind: 'play'; card: string; color?: CardColor}
	| {kind: 'draw'}
	| {kind: 'cell'; cell: number};

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

export function createSession(game: TableGameKind, host: string, players: string[]): TableSession {
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
	const cards = shuffle([...MEMO_SYMBOLS, ...MEMO_SYMBOLS]);
	return {...base, board: new Array(16).fill(null), cards, revealed: [], matched: {}, score: Object.fromEntries(players.map((p) => [p, 0]))};
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
	if (prev.winner || prev.draw || prev.players[prev.turn] !== player) return null;
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
	if (s.revealed!.length === 2) s.revealed = [];
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
			s.turn = nextIndex(s);
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
	emit();
	if (next && next.host === myId && !next.winner && !next.draw && isBot(next.players[next.turn])) {
		const botId = next.players[next.turn];
		setTimeout(() => {
			if (!session || session.id !== next.id || session.players[session.turn] !== botId) return;
			const moved = applyTableMove(session, botId, botMove(session, botId), nameOf);
			if (moved) publish(moved);
		}, 900);
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
	start(game: TableGameKind, seated: string[], bots: number): void {
		const def = TABLE_GAMES.find((g) => g.id === game)!;
		const players = [...seated];
		for (let i = 0; players.length < Math.min(def.max, Math.max(def.min, seated.length + bots)); i++) players.push(`bot:${i + 1}`);
		publish(createSession(game, myId, players.slice(0, def.max)));
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
