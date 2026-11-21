/**
 * Juegos de mesa del mundo: Ta-Te-Ti, 4 en línea y Memotest.
 *
 * Contra un amigo: el que invita es el "dueño" de la partida (valida las jugadas y difunde el
 * tablero), igual que el host de la Jam. Contra la compu: todo pasa en este equipo.
 * Ganar da monedas para la tienda.
 */
import {useEffect, useSyncExternalStore} from 'react';
import {addCoins, type GameKind, type GameMessage, type GameSession, onGame, sendWorld} from '@/world/core';

export const BOT = 'bot';
export const GAME_NAMES: Record<GameKind, string> = {tateti: 'Ta-Te-Ti', cuatro: '4 en línea', memo: 'Memotest'};
export const GAME_EMOJI: Record<GameKind, string> = {tateti: '❌', cuatro: '🔴', memo: '🃏'};
const REWARD_WIN = 60;
const REWARD_DRAW = 20;
const MEMO_FACES = ['🍕', '🌭', '🐸', '🎩', '🔥', '🌙', '🎸', '🍩'];

// ------------------------------------------------------------- reglas -------

const TATETI_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function tatetiWinner(board: (string | null)[]): string | null {
	for (const [a, b, c] of TATETI_LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
	return null;
}

const COLS = 7;
const ROWS = 6;

/** 4 en línea: la ficha cae a la fila libre más baja de la columna. Devuelve la celda o -1. */
export function cuatroDrop(board: (string | null)[], col: number): number {
	for (let row = ROWS - 1; row >= 0; row--) {
		const index = row * COLS + col;
		if (!board[index]) return index;
	}
	return -1;
}

function cuatroWinner(board: (string | null)[]): string | null {
	const at = (r: number, c: number) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? board[r * COLS + c] : null);
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			const who = at(r, c);
			if (!who) continue;
			for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
				if (at(r + dr, c + dc) === who && at(r + 2 * dr, c + 2 * dc) === who && at(r + 3 * dr, c + 3 * dc) === who) return who;
			}
		}
	}
	return null;
}

function shuffle<T>(list: T[]): T[] {
	const copy = [...list];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

export function newSession(kind: GameKind, host: string, guest: string): GameSession {
	const size = kind === 'tateti' ? 9 : kind === 'cuatro' ? COLS * ROWS : 16;
	return {
		id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		kind, host, guest, board: new Array(size).fill(null), turn: host, winner: null, draw: false, updatedAt: Date.now(),
		...(kind === 'memo' ? {cards: shuffle([...MEMO_FACES, ...MEMO_FACES]), revealed: [], matched: {}, score: {[host]: 0, [guest]: 0}} : {}),
	};
}

/** Aplica una jugada (la valida). Devuelve la sesión nueva o null si no vale. */
export function applyMove(session: GameSession, player: string, cell: number): GameSession | null {
	if (session.winner || session.draw || session.turn !== player) return null;
	const other = player === session.host ? session.guest : session.host;
	const board = [...session.board];
	if (session.kind === 'tateti') {
		if (board[cell]) return null;
		board[cell] = player;
		const winner = tatetiWinner(board);
		return {...session, board, winner, draw: !winner && board.every(Boolean), turn: other, updatedAt: Date.now()};
	}
	if (session.kind === 'cuatro') {
		const index = cuatroDrop(board, cell % COLS);
		if (index < 0) return null;
		board[index] = player;
		const winner = cuatroWinner(board);
		return {...session, board, winner, draw: !winner && board.every(Boolean), turn: other, updatedAt: Date.now()};
	}
	// Memotest: se dan vuelta dos cartas; si son iguales, suma y sigue jugando.
	const cards = session.cards ?? [];
	const matched = {...(session.matched ?? {})};
	let revealed = [...(session.revealed ?? [])];
	if (matched[cell] !== undefined || revealed.includes(cell)) return null;
	if (revealed.length === 2) revealed = [];
	revealed.push(cell);
	let turn = player;
	const score = {...(session.score ?? {})};
	if (revealed.length === 2) {
		const [a, b] = revealed;
		if (cards[a] === cards[b]) {
			matched[a] = player;
			matched[b] = player;
			score[player] = (score[player] ?? 0) + 1;
			revealed = [];
		} else {
			turn = other;
		}
	}
	const done = Object.keys(matched).length === cards.length;
	const hostScore = score[session.host] ?? 0;
	const guestScore = score[session.guest] ?? 0;
	return {
		...session, revealed, matched, score, turn, updatedAt: Date.now(),
		winner: done && hostScore !== guestScore ? (hostScore > guestScore ? session.host : session.guest) : null,
		draw: done && hostScore === guestScore,
	};
}

/** Jugada de la compu: gana si puede, tapa si tiene que, si no, al azar (con algo de criterio). */
function botMove(session: GameSession): number {
	const free = session.board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
	if (session.kind === 'memo') {
		const cards = session.cards ?? [];
		const hidden = cards.map((_, i) => i).filter((i) => session.matched?.[i] === undefined && !(session.revealed?.length === 1 && session.revealed[0] === i));
		const first = session.revealed?.length === 1 ? session.revealed[0] : null;
		if (first !== null) {
			const pair = hidden.find((i) => cards[i] === cards[first] && Math.random() < 0.55);
			if (pair !== undefined) return pair;
		}
		return hidden[Math.floor(Math.random() * hidden.length)];
	}
	const tryCells = session.kind === 'cuatro' ? [...new Set(free.map((i) => i % COLS))] : free;
	for (const who of [BOT, session.host]) {
		for (const cell of tryCells) {
			const test = applyMove({...session, turn: who}, who, cell);
			if (test?.winner === who) return cell;
		}
	}
	if (session.kind === 'tateti' && !session.board[4]) return 4;
	if (session.kind === 'cuatro' && cuatroDrop(session.board, 3) >= 0 && Math.random() < 0.5) return 3;
	return tryCells[Math.floor(Math.random() * tryCells.length)];
}

// --------------------------------------------------------- estado local -----

interface GamesState {
	sessions: Record<string, GameSession>;
	invites: Array<{session: GameSession; fromName: string}>;
}

let state: GamesState = {sessions: {}, invites: []};
const listeners = new Set<() => void>();
let myId = '';
let started = false;
const rewarded = new Set<string>();

function set(next: Partial<GamesState>): void {
	state = {...state, ...next};
	for (const listener of listeners) listener();
}

function reward(session: GameSession): void {
	if (rewarded.has(session.id) || (!session.winner && !session.draw)) return;
	rewarded.add(session.id);
	if (session.winner === myId) addCoins(REWARD_WIN);
	else if (session.draw) addCoins(REWARD_DRAW);
}

function store(session: GameSession): void {
	set({sessions: {...state.sessions, [session.id]: session}});
	reward(session);
	// Contra la compu: juega sola después de un ratito.
	if (session.guest === BOT && session.turn === BOT && !session.winner && !session.draw) {
		setTimeout(() => {
			const current = state.sessions[session.id];
			if (!current || current.turn !== BOT) return;
			const next = applyMove(current, BOT, botMove(current));
			if (next) store(next);
		}, session.kind === 'memo' ? 700 : 450);
	}
}

function otherOf(session: GameSession): string {
	return session.host === myId ? session.guest : session.host;
}

function start(meId: string): void {
	myId = meId;
	if (started) return;
	started = true;
	onGame((message, from) => {
		if (message.type === 'invite' && message.session.guest === myId && message.session.host === from) {
			if (state.invites.some((i) => i.session.id === message.session.id)) return;
			set({invites: [...state.invites, {session: message.session, fromName: message.fromName}]});
		} else if (message.type === 'accept') {
			const session = state.sessions[message.id];
			if (session && session.host === myId && session.guest === from) {
				sendWorld({kind: 'game', g: {type: 'state', session}}, from);
			}
		} else if (message.type === 'decline' || message.type === 'quit') {
			const session = state.sessions[message.id];
			if (!session || (session.host !== from && session.guest !== from)) return;
			const next = {...state.sessions};
			delete next[message.id];
			set({sessions: next, invites: state.invites.filter((i) => i.session.id !== message.id)});
		} else if (message.type === 'move') {
			const session = state.sessions[message.id];
			if (!session || session.host !== myId || session.guest !== from) return;
			const next = applyMove(session, from, message.cell);
			if (!next) return;
			store(next);
			sendWorld({kind: 'game', g: {type: 'state', session: next}}, from);
		} else if (message.type === 'state') {
			const session = message.session;
			if (session.guest !== myId || session.host !== from) return;
			const current = state.sessions[session.id];
			if (current && current.updatedAt > session.updatedAt) return;
			store(session);
		}
	});
}

// ------------------------------------------------------------ acciones ------

export const games = {
	invite(kind: GameKind, guest: string, myName: string): GameSession {
		const session = newSession(kind, myId, guest);
		store(session);
		if (guest !== BOT) sendWorld({kind: 'game', g: {type: 'invite', session, fromName: myName}}, guest);
		return session;
	},
	accept(id: string): void {
		const invite = state.invites.find((i) => i.session.id === id);
		if (!invite) return;
		set({invites: state.invites.filter((i) => i.session.id !== id)});
		store(invite.session);
		sendWorld({kind: 'game', g: {type: 'accept', id}}, invite.session.host);
	},
	decline(id: string): void {
		const invite = state.invites.find((i) => i.session.id === id);
		set({invites: state.invites.filter((i) => i.session.id !== id)});
		if (invite) sendWorld({kind: 'game', g: {type: 'decline', id}}, invite.session.host);
	},
	move(id: string, cell: number): void {
		const session = state.sessions[id];
		if (!session || session.turn !== myId) return;
		if (session.host === myId) {
			const next = applyMove(session, myId, cell);
			if (!next) return;
			store(next);
			if (session.guest !== BOT) sendWorld({kind: 'game', g: {type: 'state', session: next}}, session.guest);
		} else {
			// El invitado manda la jugada al dueño; mientras tanto la muestra (si vale) para que se sienta rápido.
			const preview = applyMove(session, myId, cell);
			if (preview) set({sessions: {...state.sessions, [id]: preview}});
			sendWorld({kind: 'game', g: {type: 'move', id, cell}}, session.host);
		}
	},
	rematch(id: string, myName: string): GameSession | null {
		const session = state.sessions[id];
		if (!session) return null;
		games.quit(id, false);
		return games.invite(session.kind, otherOf(session), myName);
	},
	quit(id: string, notify = true): void {
		const session = state.sessions[id];
		if (!session) return;
		const next = {...state.sessions};
		delete next[id];
		set({sessions: next});
		if (notify && otherOf(session) !== BOT) sendWorld({kind: 'game', g: {type: 'quit', id}}, otherOf(session));
	},
};

export function useGames(meId: string): GamesState {
	useEffect(() => start(meId), [meId]);
	return useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => state,
	);
}

export type {GameMessage};
