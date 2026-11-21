export type Blackjack = {deck: number[]; hand: number[]; dealer: number[]; stake: number; result?: 'natural' | 'win' | 'loss' | 'push'; payout?: number};

export function readBlackjack(value?: Blackjack | null): Blackjack | null {
	if (!value || !Number.isSafeInteger(value.stake) || value.stake < 10 || value.stake > 200) return null;
	const groups = [value.hand, value.dealer, value.deck];
	if (groups.some((cards) => !Array.isArray(cards)) || value.hand.length < 2 || value.dealer.length < 2) return null;
	const cards = groups.flat();
	if (cards.length !== 52 || new Set(cards).size !== 52 || cards.some((card) => !Number.isInteger(card) || card < 0 || card >= 52)) return null;
	if (value.result && !['natural', 'win', 'loss', 'push'].includes(value.result)) return null;
	if (!value.result && value.dealer.length !== 2) return null;
	return value;
}

