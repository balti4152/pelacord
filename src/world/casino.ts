import {getProfile, updateProfile, type WorldProfile} from '@/world/core';
import type {Blackjack} from '@/world/blackjackSave';

export const CASINO_GAMES = ['blackjack', 'roulette', 'slots'] as const;
export type CasinoGame = typeof CASINO_GAMES[number];
export const BETS = [10, 25, 50, 100] as const;
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26] as const;
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const wheelColor = (n: number): 'green' | 'red' | 'black' => n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
export type RouletteBet = number | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high' | `dozen-${1 | 2 | 3}` | `column-${1 | 2 | 3}`;
export type RouletteChip = {bet: RouletteBet; stake: number};
export const SYMBOLS = [
	{art: 'cherry', label: 'Cerezas', color: '#ff769e', payout: 5},
	{art: 'lemon', label: 'Limón', color: '#ffdb69', payout: 6},
	{art: 'bell', label: 'Campana', color: '#ffad73', payout: 8},
	{art: 'star', label: 'Estrella', color: '#ffe896', payout: 10},
	{art: 'diamond', label: 'Diamante', color: '#82eaff', payout: 14},
	{art: 'seven', label: 'Siete', color: '#eb83ff', payout: 22},
] as const;
export const SLOT_REELS = 5;
export const slotSymbolUrl = (symbol: number): string => 'casino/' + SYMBOLS[symbol].art + '.png';
export type Spin =
	| {kind: 'roulette'; number: number; payout: number}
	| {kind: 'slots'; reels: number[][]; matches: number[]; payout: number};

export const SPIN_MS = {roulette: 3200, slots: 2200};
export const slotStop = (index: number): number => SPIN_MS.slots * (0.56 + index * 0.11);
export const roulettePocket = (number: number): number => Math.PI - Math.PI * 2 * WHEEL.findIndex((n) => n === number) / WHEEL.length;
export const ROULETTE_RADIUS = 0.654;

export function rouletteFrame(number: number, start: number, progress: number, reduced: boolean): {rotor: number; angle: number; radius: number; hop: number} {
	const tau = Math.PI * 2;
	const ease = 1 - Math.pow(1 - progress, 3);
	const rotor = -tau * (reduced ? 1 : 2) * ease;
	const difference = ((roulettePocket(number) - start) % tau + tau) % tau;
	return {
		rotor,
		angle: start + (difference + tau * (reduced ? 2 : 6)) * ease + rotor,
		radius: ROULETTE_RADIUS + (reduced ? 0 : 0.075 * Math.sin(Math.PI * progress)),
		hop: reduced ? 0 : Math.sin(progress * 9 * Math.PI) ** 2 * (1 - progress) * 0.027,
	};
}

function transact(action: (p: WorldProfile) => Partial<WorldProfile> | undefined): boolean {
	const patch = action(getProfile());
	if (!patch) return false;
	updateProfile(patch);
	return true;
}

const draw = (max: number): number => Math.floor(Math.random() * max);

function rouletteMultiplier(bet: RouletteBet, number: number): number {
	if (typeof bet === 'number') return bet === number ? 36 : 0;
	if (number === 0) return 0;
	switch (bet) {
		case 'red': case 'black': return wheelColor(number) === bet ? 2 : 0;
		case 'even': case 'odd': return number % 2 === (bet === 'even' ? 0 : 1) ? 2 : 0;
		case 'low': case 'high': return (number <= 18) === (bet === 'low') ? 2 : 0;
		case 'dozen-1': case 'dozen-2': case 'dozen-3': return Math.ceil(number / 12) === Number(bet.at(-1)) ? 3 : 0;
		case 'column-1': case 'column-2': case 'column-3': return (number - 1) % 3 + 1 === Number(bet.at(-1)) ? 3 : 0;
	}
}

export function spinRoulette(chips: RouletteChip[]): Spin | null {
	if (!chips.length || chips.some(({stake}) => !BETS.some((n) => n === stake))) return null;
	const stake = chips.reduce((total, chip) => total + chip.stake, 0);
	const number = draw(37);
	const payout = chips.reduce((total, chip) => total + chip.stake * rouletteMultiplier(chip.bet, number), 0);
	return transact((p) => p.coins >= stake ? {coins: p.coins - stake + payout} : undefined) ? {kind: 'roulette', number, payout} : null;
}

export function spinSlots(stake: number): Spin | null {
	if (!BETS.some((n) => n === stake)) return null;
	const reels = Array.from({length: SLOT_REELS}, () => Array.from({length: 3}, () => draw(SYMBOLS.length)));
	const middle = reels.map((reel) => reel[1]);
	const first = middle[0];
	const mismatch = middle.findIndex((symbol) => symbol !== first);
	const streak = mismatch < 0 ? SLOT_REELS : mismatch;
	const opening = middle.slice(0, 3);
	const cherries = opening.flatMap((symbol, i) => symbol === 0 ? [i] : []);
	const pair = opening.flatMap((symbol, i) => opening.indexOf(symbol) !== opening.lastIndexOf(symbol) ? [i] : []);
	const multiplier = streak >= 3 ? Math.floor(SYMBOLS[first].payout * (1 + (streak - 3) * 0.5)) : cherries.length >= 2 ? 2 : pair.length ? 1 : 0;
	const matches = streak >= 3 ? middle.slice(0, streak).map((_, i) => i) : cherries.length >= 2 ? cherries : pair;
	const payout = multiplier * stake;
	return transact((p) => p.coins >= stake ? {coins: p.coins - stake + payout} : undefined) ? {kind: 'slots', reels, matches, payout} : null;
}

const SUITS = ['♠', '♥', '♣', '♦'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

export function face(card: number): {rank: string; suit: string; red: boolean} {
	const suit = Math.floor(card / 13);
	return {rank: RANKS[card % 13], suit: SUITS[suit], red: suit % 2 === 1};
}

export function score(cards: number[]): number {
	let aces = 0;
	let sum = 0;
	for (const card of cards) {
		const rank = card % 13 + 1;
		if (rank === 1) aces++;
		sum += Math.min(10, rank);
	}
	return aces && sum <= 11 ? sum + 10 : sum;
}

function finish(round: Blackjack): Blackjack {
	const player = score(round.hand);
	if (player > 21) return {...round, result: 'loss', payout: 0};
	const natural = round.hand.length === 2 && player === 21;
	const dealerNatural = round.dealer.length === 2 && score(round.dealer) === 21;
	if (natural || dealerNatural) {
		if (natural && dealerNatural) return {...round, result: 'push', payout: round.stake};
		if (natural) return {...round, result: 'natural', payout: Math.floor(round.stake * 2.5)};
		return {...round, result: 'loss', payout: 0};
	}
	while (score(round.dealer) < 17 && round.deck.length) round.dealer.push(round.deck.pop()!);
	const dealer = score(round.dealer);
	if (dealer > 21 || player > dealer) return {...round, result: 'win', payout: round.stake * 2};
	return dealer === player ? {...round, result: 'push', payout: round.stake} : {...round, result: 'loss', payout: 0};
}

export function dealBlackjack(stake: number): boolean {
	if (!BETS.some((n) => n === stake)) return false;
	return transact((p) => {
		if (p.coins < stake || (p.blackjack && !p.blackjack.result)) return;
		const deck = Array.from({length: 52}, (_, i) => i);
		for (let i = deck.length - 1; i > 0; i--) {
			const j = draw(i + 1);
			[deck[i], deck[j]] = [deck[j], deck[i]];
		}
		const hand = [deck.pop()!, deck.pop()!];
		const dealer = [deck.pop()!, deck.pop()!];
		const round: Blackjack = {deck, hand, dealer, stake};
		const blackjack = score(hand) === 21 || score(dealer) === 21 ? finish(round) : round;
		return {blackjack, coins: p.coins - stake + (blackjack.payout ?? 0)};
	});
}

export function playBlackjack(action: 'hit' | 'stand' | 'double'): boolean {
	return transact((p) => {
		const original = p.blackjack;
		if (!original || original.result) return;
		const blackjack = {...original, deck: [...original.deck], hand: [...original.hand], dealer: [...original.dealer]};
		let debit = 0;
		if (action === 'double') {
			if (blackjack.hand.length !== 2 || p.coins < blackjack.stake) return;
			debit = blackjack.stake;
			blackjack.stake *= 2;
		}
		if (action !== 'stand') blackjack.hand.push(blackjack.deck.pop()!);
		const resolved = action !== 'hit' || score(blackjack.hand) >= 21 ? finish(blackjack) : blackjack;
		return {blackjack: resolved, coins: p.coins - debit + (resolved.payout ?? 0)};
	});
}


