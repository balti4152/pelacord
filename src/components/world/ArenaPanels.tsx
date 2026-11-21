import {useEffect, useState} from 'react';
import {
	Bot, Check, Coins, Crown, Dices, Flag, Gamepad2, Minus, Play, Plus, Shuffle, SkipForward, Square, Timer, Trophy, Users, X,
} from 'lucide-react';
import {GAME_ORDER, GAMES, type GameId} from '@/world/partyGames';
import {hostNow, type PartyState, payout} from '@/world/party';
import {worldSounds} from '@/world/worldSounds';

/** Arma la lista de juegos de la partida: N juegos con los elegidos (mezclados si se pide). */
export function buildPlaylist(selected: GameId[], count: number, shuffle: boolean): GameId[] {
	const pool = shuffle ? [...selected].sort(() => Math.random() - 0.5) : [...selected];
	const list: GameId[] = [];
	while (list.length < count && pool.length) {
		const next = pool[list.length % pool.length];
		// Que no se repita el mismo dos veces seguidas si hay de dónde elegir.
		if (pool.length > 1 && list[list.length - 1] === next) {
			list.push(pool[(list.length + 1) % pool.length]);
		} else list.push(next);
	}
	return list;
}

/** El panel del admin de la Arena: elegir juegos, cantidad, bots, y arrancar o cortar. */
export function ArenaAdminPanel({party, meId, people, onStart, onSkip, onStop, onClose}: {
	party: PartyState | null;
	meId: string;
	people: Array<{id: string; name: string}>;
	onStart: (games: GameId[], bots: number) => void;
	onSkip: () => void;
	onStop: () => void;
	onClose: () => void;
}): JSX.Element {
	const [selected, setSelected] = useState<GameId[]>(GAME_ORDER);
	const [count, setCount] = useState(5);
	const [shuffle, setShuffle] = useState(true);
	const [withBots, setWithBots] = useState(true);
	const [bots, setBots] = useState(4);
	const toggle = (id: GameId) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
	const total = people.length + (withBots ? bots : 0);
	const canStart = selected.length > 0 && total >= 2;
	return (
		<section className="ar-panel" onKeyDown={(e) => e.stopPropagation()}>
			<header className="ar-head">
				<span className="ar-logo"><Gamepad2 size={26} strokeWidth={2.6} /></span>
				<div>
					<h2>Panel de la Arena</h2>
					<p>Armá la partida: juegos, cantidad y si juegan bots.</p>
				</div>
				<button type="button" className="ar-x" onClick={onClose} aria-label="Cerrar"><X size={20} strokeWidth={3} /></button>
			</header>
			{party ? (
				<div className="ar-running">
					<p><strong>Hay una partida en curso</strong> · juego {party.round + 1} de {party.games.length}: {GAMES[party.games[party.round]].name}</p>
					{party.host === meId ? (
						<div className="ar-row">
							<button type="button" className="ar-btn is-yellow" onClick={onSkip}><SkipForward size={18} strokeWidth={3} /> Saltar este juego</button>
							<button type="button" className="ar-btn is-red" onClick={onStop}><Square size={16} strokeWidth={3} /> Terminar la partida</button>
						</div>
					) : <p className="ar-hint">La maneja {party.names[party.host] ?? 'otro jugador'}.</p>}
				</div>
			) : (
				<>
					<div className="ar-section-title">
						<span><Dices size={16} strokeWidth={3} /> Juegos ({selected.length})</span>
						<div className="ar-row is-tight">
							<button type="button" className="ar-chip" onClick={() => setSelected(GAME_ORDER)}>Todos</button>
							<button type="button" className="ar-chip" onClick={() => setSelected([])}>Ninguno</button>
						</div>
					</div>
					<div className="ar-games">
						{GAME_ORDER.map((id, i) => {
							const g = GAMES[id];
							const on = selected.includes(id);
							return (
								<button key={id} type="button" className={`ar-game${on ? ' is-on' : ''}`} style={{'--c': g.color} as React.CSSProperties} onClick={() => toggle(id)}>
									<span className="ar-game-num">{i + 1}</span>
									<strong>{g.name}</strong>
									<small>{g.desc}</small>
									<span className="ar-game-check">{on ? <Check size={14} strokeWidth={4} /> : null}</span>
								</button>
							);
						})}
					</div>
					<div className="ar-options">
						<div className="ar-option">
							<span><Flag size={16} strokeWidth={3} /> Cantidad de juegos</span>
							<div className="ar-stepper">
								<button type="button" onClick={() => setCount((c) => Math.max(1, c - 1))}><Minus size={16} strokeWidth={3.4} /></button>
								<strong>{count}</strong>
								<button type="button" onClick={() => setCount((c) => Math.min(15, c + 1))}><Plus size={16} strokeWidth={3.4} /></button>
							</div>
						</div>
						<div className="ar-option">
							<span><Shuffle size={16} strokeWidth={3} /> Orden</span>
							<div className="ar-toggle">
								<button type="button" className={shuffle ? 'is-on' : ''} onClick={() => { if (!shuffle) worldSounds.play('dice'); setShuffle(true); }}>Al azar</button>
								<button type="button" className={!shuffle ? 'is-on' : ''} onClick={() => { if (shuffle) worldSounds.play('select'); setShuffle(false); }}>En orden</button>
							</div>
						</div>
						<div className="ar-option">
							<span><Bot size={16} strokeWidth={3} /> Jugadores</span>
							<div className="ar-toggle">
								<button type="button" className={withBots ? 'is-on' : ''} onClick={() => setWithBots(true)}>Con bots</button>
								<button type="button" className={!withBots ? 'is-on' : ''} onClick={() => setWithBots(false)}>Sólo jugadores</button>
							</div>
						</div>
						{withBots ? (
							<div className="ar-option">
								<span><Bot size={16} strokeWidth={3} /> Cantidad de bots</span>
								<div className="ar-stepper">
									<button type="button" onClick={() => setBots((b) => Math.max(1, b - 1))}><Minus size={16} strokeWidth={3.4} /></button>
									<strong>{bots}</strong>
									<button type="button" onClick={() => setBots((b) => Math.min(9, b + 1))}><Plus size={16} strokeWidth={3.4} /></button>
								</div>
							</div>
						) : null}
					</div>
					<div className="ar-people">
						<span><Users size={15} strokeWidth={3} /> Juegan ({total}):</span>
						{people.map((p) => <em key={p.id}>{p.id === meId ? 'Vos' : p.name}</em>)}
						{withBots ? <em className="is-bot">+ {bots} bots</em> : null}
					</div>
					<div className="ar-prize">
						<Coins size={18} strokeWidth={3} /> Premio: 1º {50 * count} · 2º {30 * count} · 3º {20 * count} · resto {10 * count} pelamonedas
					</div>
					<button type="button" className="ar-btn is-green is-big" disabled={!canStart} onClick={() => onStart(buildPlaylist(selected, count, shuffle), withBots ? bots : 0)}>
						<Play size={22} strokeWidth={3} /> {canStart ? '¡Empezar la partida!' : total < 2 ? 'Hacen falta 2 jugadores (sumá bots)' : 'Elegí al menos un juego'}
					</button>
				</>
			)}
		</section>
	);
}

function useTick(ms = 200): number {
	const [, set] = useState(0);
	useEffect(() => {
		const timer = window.setInterval(() => set((x) => x + 1), ms);
		return () => window.clearInterval(timer);
	}, [ms]);
	return 0;
}

/** Lo que se ve durante la partida: ronda, reloj, presentación del juego, cuenta regresiva, resultados. */
export function PartyHud({party, meId, overlay, onClose}: {party: PartyState; meId: string; overlay: string | null; onClose: () => void}): JSX.Element {
	useTick();
	const game = GAMES[party.games[party.round]];
	const left = Math.max(0, Math.ceil((party.phaseEnds - hostNow()) / 1000));
	const since = (hostNow() - party.phaseAt) / 1000;
	const playing = party.players.includes(meId);
	const out = playing && !party.alive.includes(meId) && party.phase === 'play' && game.kind === 'elim';
	const g = party.g;
	let extra: string | null = null;
	if (party.games[party.round] === 'soccer') {
		const goals = (g.goals as {a: number; b: number}) ?? {a: 0, b: 0};
		extra = `Rosa ${goals.a} – ${goals.b} Azul`;
	} else if (party.games[party.round] === 'paint') {
		const cells = (g.cells as string) ?? '';
		const a = cells.split('').filter((c) => c === 'a').length;
		const b = cells.split('').filter((c) => c === 'b').length;
		const total = Math.max(1, a + b);
		extra = `Rosa ${Math.round((a / total) * 100)}% – ${Math.round((b / total) * 100)}% Azul`;
	} else if (party.games[party.round] === 'bomb') {
		extra = g.holder === meId ? '¡TENÉS LA BOMBA! Pasala' : `La bomba la tiene ${g.holder === meId ? 'vos' : party.names[g.holder as string] ?? '?'}`;
	} else if (game.kind === 'race') {
		extra = `${party.order.length} llegaron`;
	} else if (game.kind === 'elim') {
		extra = `${party.alive.length} en pie`;
	}
	const teams = g.teams as Record<string, string> | undefined;
	const myTeam = teams?.[meId];
	return (
		<>
			<div className="ph-top">
				<span className="ph-round">{party.round + 1}/{party.games.length}</span>
				<span className="ph-name" style={{'--c': game.color} as React.CSSProperties}>{game.name}</span>
				{party.phase === 'play' ? <span className="ph-timer"><Timer size={16} strokeWidth={3} /> {left}</span> : null}
				{extra ? <span className="ph-extra">{extra}</span> : null}
				{myTeam ? <span className={`ph-team is-${myTeam}`}>{myTeam === 'a' ? 'Equipo Rosa' : 'Equipo Azul'}</span> : null}
			</div>

			{party.phase === 'intro' ? (
				<div className="ph-intro">
					<div className="ph-card" style={{'--c': game.color} as React.CSSProperties}>
						<span className="ph-card-round">Juego {party.round + 1}</span>
						<h1>{game.name}</h1>
						<p>{game.desc}</p>
						<p className="ph-how">{game.how}</p>
						{left <= 3 ? <span className="ph-count" key={left}>{left || '¡YA!'}</span> : null}
						{!playing ? <p className="ph-watch">Estás mirando: entrá a la próxima partida desde el panel.</p> : null}
					</div>
				</div>
			) : null}
			{party.phase === 'play' && since < 1.2 ? <div className="ph-go">¡YA!</div> : null}
			{out ? <div className="ph-out">Quedaste afuera… ¡mirá cómo sigue!</div> : null}
			{overlay ? <div className="ph-overlay"><span>{overlay}</span></div> : null}

			{party.phase === 'results' ? (
				<div className="ph-intro">
					<div className="ph-card is-results" style={{'--c': game.color} as React.CSSProperties}>
						<span className="ph-card-round">Resultados · {game.name}</span>
						<ol className="ph-ranking">
							{party.lastRanking.slice(0, 8).map((r, i) => (
								<li key={r.id} className={r.id === meId ? 'is-me' : ''}>
									<span className="ph-pos">{i + 1}</span>
									<span className="ph-who">{r.id === meId ? 'Vos' : party.names[r.id] ?? '?'}</span>
									<span className="ph-pts">+{r.pts}</span>
									<span className="ph-total">{party.scores[r.id] ?? 0}</span>
								</li>
							))}
						</ol>
						<p className="ph-how">{party.round + 1 < party.games.length ? `Próximo: ${GAMES[party.games[party.round + 1]].name}` : '¡Se viene el podio!'}</p>
					</div>
				</div>
			) : null}

			{party.phase === 'final' ? <FinalPodium party={party} meId={meId} onClose={onClose} /> : null}
		</>
	);
}

function FinalPodium({party, meId, onClose}: {party: PartyState; meId: string; onClose: () => void}): JSX.Element {
	const ranking = [...party.players].sort((a, b) => (party.scores[b] ?? 0) - (party.scores[a] ?? 0));
	const mine = party.players.includes(meId) ? payout(party, meId) : null;
	const top = [ranking[1], ranking[0], ranking[2]];
	return (
		<div className="ph-intro">
			<div className="ph-card is-final">
				<span className="ph-card-round"><Trophy size={18} strokeWidth={3} /> ¡Terminó la partida!</span>
				<div className="ph-podium">
					{top.map((id, i) => id ? (
						<div key={id} className={`ph-step is-${i === 1 ? 'gold' : i === 0 ? 'silver' : 'bronze'}`}>
							{i === 1 ? <Crown size={30} strokeWidth={2.6} className="ph-crown" /> : null}
							<strong>{id === meId ? 'Vos' : party.names[id]}</strong>
							<span>{party.scores[id] ?? 0} pts</span>
							<div className="ph-block">{i === 1 ? 1 : i === 0 ? 2 : 3}</div>
						</div>
					) : <div key={i} />)}
				</div>
				{mine ? (
					<p className="ph-prize"><Coins size={20} strokeWidth={3} /> Quedaste {mine.rank}º y ganaste <strong>{mine.coins}</strong> pelamonedas</p>
				) : null}
				<button type="button" className="ar-btn is-green" onClick={onClose}>¡Listo!</button>
			</div>
		</div>
	);
}
