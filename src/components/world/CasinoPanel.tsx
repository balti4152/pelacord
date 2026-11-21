import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {ArrowLeft, Cherry, CircleDot, Coins, Dices, RotateCw, Spade, Undo2, X} from 'lucide-react';
import {CasinoWheel, type WheelTurn} from '@/components/world/CasinoWheel';
import {
	BETS, CASINO_GAMES, SLOT_REELS, SPIN_MS, SYMBOLS, dealBlackjack, face, playBlackjack, score, slotStop, slotSymbolUrl, spinRoulette, spinSlots, wheelColor,
	type CasinoGame, type RouletteBet, type RouletteChip, type Spin,
} from '@/world/casino';
import type {Blackjack} from '@/world/blackjackSave';
import {getProfile, useProfile} from '@/world/core';
import {worldSounds} from '@/world/worldSounds';
import '@/styles/casino.css';

const GAMES = {blackjack: {title: 'Blackjack', icon: Spade}, roulette: {title: 'Ruleta', icon: CircleDot}, slots: {title: 'Tragamonedas', icon: Dices}};
const RESULTS = {natural: '¡Blackjack!', win: 'Ganaste la mano', loss: 'La casa gana', push: 'Empate'};
const CHIP_COLORS = ['#aa5263', '#448476', '#587aab', '#9b6695'];
const START_REELS = [[4, 0, 3], [3, 1, 5], [0, 2, 4], [5, 3, 1], [1, 4, 2]];
const ROWS = [3, 2, 1] as const;
const OUTSIDE = [['low', '1–18'], ['even', 'Par'], ['red', 'Rojo'], ['black', 'Negro'], ['odd', 'Impar'], ['high', '19–36']] as const;
const DOZENS = [['dozen-1', '1.ª docena'], ['dozen-2', '2.ª docena'], ['dozen-3', '3.ª docena']] as const;
const numberFormat = new Intl.NumberFormat('es-AR');
const fmt = (value: number): string => numberFormat.format(value);

function CasinoChip({value, color, small = false}: {value: number; color: string; small?: boolean}): JSX.Element {
	return <span className={'pc-chip' + (small ? ' pc-chip-small' : '')} style={{'--chip': color} as CSSProperties}>{fmt(value)}</span>;
}

function SlotStage({spin, running, reveal, notice}: {spin: Extract<Spin, {kind: 'slots'}> | null; running: boolean; reveal: number; notice: string}): JSX.Element {
	const winning = !running && Boolean(spin?.payout);
	return (
		<div className="pc-slots">
			<div className="pc-slots-game">
				<div className="pc-slots-title"><Cherry size={27} aria-hidden="true" /><h2>Giro Cereza</h2></div>
				<div className={'pc-slot-frame' + (winning ? ' is-winning' : '')}>
					{(spin?.reels ?? START_REELS).map((symbols, column) => {
						const roll = running && reveal <= column;
						return <div className="pc-slot-reel" key={column} aria-label={'Carrete ' + (column + 1)}>
							{roll ? <div className="pc-slot-strip" aria-hidden="true">
								{Array.from({length: 12}, (_, i) => <img key={i} src={slotSymbolUrl((i + column * 2) % SYMBOLS.length)} alt="" draggable={false} />)}
							</div> : symbols.map((symbol, index) => <div
								className={'pc-slot-cell' + (index === 1 ? ' is-payline' : '') + (winning && index === 1 && spin?.matches.includes(column) ? ' is-match' : '')}
								key={index}>
								<img src={slotSymbolUrl(symbol)} alt={SYMBOLS[symbol].label} draggable={false} />
							</div>)}
						</div>;
					})}
					{winning && <div className="pc-slot-confetti" aria-hidden="true">{Array.from({length: 14}, (_, index) =>
						<i key={index} style={{'--turn': index * 25.71 + 'deg', '--reach': 90 + index % 4 * 23 + 'px'} as CSSProperties} />)}</div>}
				</div>
				<p className="pc-slots-caption" role="status">{running ? 'Girando…' : notice || 'Los premios se cuentan en la fila central.'}</p>
			</div>
			<aside className="pc-slots-side">
				<img className="pc-mascot" src="casino/mascot.png" alt="" draggable={false} />
				<details className="pc-paytable">
					<summary>Ver premios</summary>
					<div className="pc-paytable-grid">
						{SYMBOLS.map((symbol, index) => <span key={symbol.art}><img src={slotSymbolUrl(index)} alt={symbol.label} />{symbol.payout}×</span>)}
						<p>Tres iguales desde la izquierda. Cuatro multiplican el premio por 1,5 y cinco lo duplican. Entre los tres primeros, dos cerezas pagan 2× y otra pareja devuelve la apuesta.</p>
					</div>
				</details>
			</aside>
		</div>
	);
}

function RouletteStage({turn, chips, onBet, running, history, notice}: {
	turn: WheelTurn | null; chips: RouletteChip[]; onBet: (bet: RouletteBet) => void; running: boolean; history: number[]; notice: string;
}): JSX.Element {
	const result = running || !turn ? null : turn.number;
	const totals = new Map<RouletteBet, number>();
	for (const {bet, stake} of chips) totals.set(bet, (totals.get(bet) ?? 0) + stake);

	function button(bet: RouletteBet, label: string, className = '', style?: CSSProperties, accessibleLabel = label): JSX.Element {
		const paid = totals.get(bet);
		const selected = typeof bet === 'number' && result === bet;
		return <button type="button" key={bet} style={style} className={'pc-square ' + className + (selected ? ' is-result' : '')}
			disabled={running} aria-label={accessibleLabel + (paid ? ', ' + fmt(paid) + ' apostadas' : '')}
			onClick={() => onBet(bet)}>
			{label}{paid ? <CasinoChip value={paid} color="#9c5b4f" small /> : null}
		</button>;
	}

	return <div className="pc-roulette">
		<div className="pc-roulette-top">
			<div className="pc-roulette-title"><h2>Ruleta</h2><span>Un solo cero</span></div>
			<CasinoWheel turn={turn} />
			<div className="pc-results">
				<p role="status">{result !== null && <span className={'pc-result-badge is-' + wheelColor(result)}>{result}</span>}
					{running ? 'La bola está girando…' : notice || 'Elegí una ficha y ponela en el paño.'}</p>
				{history.length ? <div className="pc-recent" aria-label="Últimos números">
					{history.map((n, i) => <span className={'pc-result-badge is-' + wheelColor(n)} key={i}>{n}</span>)}
				</div> : null}
			</div>
		</div>
		<div className="pc-betting-felt">
			<div className="pc-betting-grid" aria-label="Paño de ruleta">
				{button(0, '0', 'is-green pc-zero')}
				{ROWS.flatMap((row, rowIndex) => Array.from({length: 12}, (_, col) => {
					const n = 3 * col + row;
					return button(n, String(n), 'is-' + wheelColor(n), {gridColumn: col + 2, gridRow: rowIndex + 1}, n + (wheelColor(n) === 'red' ? ', rojo' : ', negro'));
				}))}
				{ROWS.map((row, i) => button('column-' + row as RouletteBet, '2 a 1', 'pc-column', {gridColumn: 14, gridRow: i + 1}, 'Columna que empieza en ' + row + ', 2 a 1'))}
				{DOZENS.map(([key, label], i) => button(key, label, 'pc-dozen', {gridColumn: (2 + i * 4) + ' / span 4', gridRow: 4}))}
				{OUTSIDE.map(([key, label], i) => button(key, label, key === 'red' || key === 'black' ? 'is-' + key : '', {gridColumn: (2 + i * 2) + ' / span 2', gridRow: 5}))}
			</div>
		</div>
	</div>;
}

function PlayingCard({value}: {value?: number}): JSX.Element {
	const card = value === undefined ? null : face(value);
	return <div className={'pc-playing-card ' + (!card ? 'is-back' : card.red ? 'is-red' : '')}
		aria-label={card ? card.rank + ' ' + card.suit : 'Carta boca abajo'}>
		{card ? <><small>{card.rank}<i>{card.suit}</i></small><b>{card.suit}</b><small>{card.rank}<i>{card.suit}</i></small></> : <Cherry size={28} />}
	</div>;
}

function BlackjackStage({round, name}: {round: Blackjack | null; name: string}): JSX.Element {
	return <div className="pc-blackjack">
		<div className="pc-blackjack-table">
			<div className="pc-blackjack-deck" aria-hidden="true"><Cherry size={23} /></div>
			<div className="pc-hand-area">
				<span>Crupier {round ? <strong>{score(round.result ? round.dealer : round.dealer.slice(0, 1))}</strong> : null}</span>
				<div className="pc-hand">
					{round ? round.dealer.map((card, i) => <PlayingCard key={card} value={i === 1 && !round.result ? undefined : card} />) : <PlayingCard />}
				</div>
			</div>
			<div className="pc-table-mark">
				<Spade size={23} aria-hidden="true" /><h2>Blackjack</h2><span>Blackjack paga 3 a 2</span>
			</div>
			<div className="pc-hand-area">
				<div className="pc-hand">
					{round ? round.hand.map((card) => <PlayingCard key={card} value={card} />) : <span className="pc-empty-cards" aria-hidden="true" />}
				</div>
				<span>{name || 'Tu mano'} {round ? <strong>{score(round.hand)}</strong> : null}</span>
			</div>
		</div>
		<p className="pc-blackjack-status" role="status">{round?.result ? RESULTS[round.result] + (round.payout ? ' · ' + fmt(round.payout) + ' cobradas' : '') : round ? 'Apuesta en juego · ' + fmt(round.stake) : 'Acercate a 21 sin pasarte.'}</p>
	</div>;
}

export function CasinoPanel({initial, onClose, onSpin, playerName}: {
	initial: CasinoGame; onClose: () => void; onSpin: (spin: Spin) => void; playerName: string;
}): JSX.Element {
	const [game, setGame] = useState(initial);
	const [stake, setStake] = useState<number>(BETS[0]);
	const [chips, setChips] = useState<RouletteChip[]>([]);
	const [turn, setTurn] = useState<WheelTurn | null>(null);
	const [slots, setSlots] = useState<Extract<Spin, {kind: 'slots'}> | null>(null);
	const [running, setRunning] = useState(false);
	const [reveal, setReveal] = useState(SLOT_REELS);
	const [history, setHistory] = useState<number[]>([]);
	const [balance, setBalance] = useState(0);
	const [notice, setNotice] = useState('');
	const timers = useRef(new Set<number>());
	const pending = useRef(false);
	const region = useRef<HTMLElement>(null);
	const close = useRef<HTMLButtonElement>(null);
	const {coins, blackjack} = useProfile();
	const round = game === 'blackjack' ? blackjack ?? null : null;
	const inHand = Boolean(round && !round.result);
	const rouletteStake = chips.reduce((total, chip) => total + chip.stake, 0);
	const wager = game === 'roulette' ? rouletteStake : stake;

	useEffect(() => {
		close.current?.focus({preventScroll: true});
		const queued = timers.current;
		return () => queued.forEach((id) => window.clearTimeout(id));
	}, []);

	function schedule(fn: () => void, ms: number): void {
		const id = window.setTimeout(() => {
			timers.current.delete(id);
			fn();
		}, ms);
		timers.current.add(id);
	}

	function pick(next: CasinoGame): void {
		if (next === game) return;
		setGame(next);
		setNotice('');
		worldSounds.play('select', 0.85);
	}

	function addChip(bet: RouletteBet): void {
		if (pending.current) return;
		setChips((current) => {
			const stacked = current.reduce((sum, chip) => sum + chip.stake, 0);
			return stacked + stake <= getProfile().coins ? [...current, {bet, stake}] : current;
		});
		if (rouletteStake + stake > coins) {
			setNotice('No alcanza el saldo para otra ficha.');
			worldSounds.play('locked');
		} else {
			setNotice('');
			worldSounds.play('chip', 0.76);
		}
	}

	function settleSound(prize: number, paid: number): void {
		if (prize > paid) worldSounds.play('reward', 0.9);
		else if (prize === paid) worldSounds.play('chip', 0.7);
	}

	function start(): void {
		if (pending.current) return;
		setNotice('');
		if (game === 'blackjack') {
			if (!dealBlackjack(stake)) return;
			worldSounds.play('dealCards');
			const next = getProfile().blackjack;
			if (next?.result) schedule(() => settleSound(next.payout ?? 0, next.stake), 320);
			return;
		}
		const before = getProfile().coins;
		const next = game === 'roulette' ? spinRoulette(chips) : spinSlots(stake);
		if (!next) return;
		pending.current = true;
		setRunning(true);
		setBalance(before - wager);
		if (next.kind === 'roulette') setTurn({number: next.number, at: performance.now()});
		else {
			setSlots(next);
			setReveal(0);
			for (let i = 0; i < SLOT_REELS; i++) schedule(() => {
				setReveal(i + 1);
				worldSounds.play('chip', 0.71);
			}, slotStop(i));
		}
		worldSounds.play('roulette', next.kind === 'slots' ? 0.7 : 1);
		onSpin(next);
		schedule(() => {
			pending.current = false;
			setRunning(false);
			setNotice(next.payout === 0 ? 'Sin premio' : next.payout === wager ? 'Recuperaste la apuesta' : 'Cobrás ' + fmt(next.payout) + ' pelamonedas');
			if (next.kind === 'roulette') {
				setHistory((recent) => [next.number, ...recent].slice(0, 5));
				setChips([]);
			}
			settleSound(next.payout, wager);
		}, SPIN_MS[next.kind]);
	}

	function hit(action: 'hit' | 'stand' | 'double'): void {
		if (!playBlackjack(action)) return;
		worldSounds.play(action === 'stand' ? 'flipCard' : 'playCard', 0.82);
		const result = getProfile().blackjack;
		if (result?.result) schedule(() => settleSound(result.payout ?? 0, result.stake), 230);
	}

	return (
		<section ref={region} className={'pc-casino-screen is-' + game} role="dialog" aria-modal="true" aria-label={'Casino La Cereza · ' + GAMES[game].title} onKeyDown={(event) => {
			event.stopPropagation();
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
			}
			if (event.key !== 'Tab') return;
			const targets = [...(region.current?.querySelectorAll<HTMLElement>('button:not([disabled]), summary') ?? [])].filter((target) => target.getClientRects().length);
			const next = event.shiftKey ? targets.at(-1) : targets[0];
			const edge = event.shiftKey ? targets[0] : targets.at(-1);
			if (next && document.activeElement === edge) {
				event.preventDefault();
				next.focus();
			}
		}}>
			<header className="pc-casino-head">
				<button type="button" ref={close} className="pc-casino-back" onClick={onClose}><ArrowLeft size={17} /> <span>Volver al salón</span></button>
				<nav aria-label="Juegos del casino">
					{CASINO_GAMES.map((id) => {
						const {title, icon: Icon} = GAMES[id];
						return <button type="button" key={id} disabled={running} aria-pressed={game === id} onClick={() => pick(id)}><Icon size={16} /> {title}</button>;
					})}
				</nav>
				<div className="pc-casino-balance" title="Saldo de Pelamonedas"><Coins size={17} aria-hidden="true" /><span>{fmt(running ? balance : coins)}</span></div>
			</header>
			<div className="pc-casino-stage">
				{game === 'slots' ? <SlotStage spin={slots} running={running} reveal={reveal} notice={notice} /> :
					game === 'roulette' ? <RouletteStage turn={turn} chips={chips} onBet={addChip} running={running} history={history} notice={notice} /> :
						<BlackjackStage round={round} name={playerName} />}
			</div>
			<footer className="pc-casino-controls">
				{!inHand && (
					<div className="pc-chip-tray" aria-label="Denominación de ficha">
						{BETS.map((value, i) => <button type="button" key={value} aria-label={value + ' pelamonedas'} aria-pressed={stake === value}
							disabled={running} onClick={() => { setStake(value); worldSounds.play('chip', 0.75); }}><CasinoChip value={value} color={CHIP_COLORS[i]} /></button>)}
					</div>
				)}
				<div className="pc-casino-wager">
					<span>{game === 'roulette' && !running ? 'En el paño' : 'Apuesta'}</span> <strong>{fmt(inHand && round ? round.stake : wager)}</strong>
				</div>
				{game === 'roulette' && (
					<div className="pc-roulette-reset">
						<button type="button" title="Quitar última ficha" aria-label="Quitar última ficha" disabled={running || !chips.length} onClick={() => setChips((c) => c.slice(0, -1))}><Undo2 size={18} /></button>
						<button type="button" title="Limpiar paño" aria-label="Limpiar paño" disabled={running || !chips.length} onClick={() => setChips([])}><X size={18} /></button>
					</div>
				)}
				{inHand && round ? <div className="pc-blackjack-actions">
					<button type="button" onClick={() => hit('stand')}>Plantarse</button>
					{round.hand.length === 2 && <button type="button" disabled={coins < round.stake} onClick={() => hit('double')}>Doblar</button>}
					<button type="button" className="pc-casino-primary" onClick={() => hit('hit')}>Pedir carta</button>
				</div> : <button type="button" className="pc-casino-primary" disabled={running || !wager || coins < wager} onClick={start}>
					{game === 'blackjack' ? <Spade size={18} /> : <RotateCw size={18} />}
					{game === 'blackjack' ? 'Repartir' : running ? 'Girando…' : 'Girar'}
				</button>}
			</footer>
		</section>
	);
}

