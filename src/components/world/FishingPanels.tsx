import {useEffect, useRef, useState} from 'react';
import {Anchor, BookOpen, Check, Coins, Fish, Gem, ShoppingBag, Sparkles, Star, X} from 'lucide-react';
import {useProfile} from '@/world/core';
import {
	BAITS, buyBait, buyRod, FISH, type FishKind, fishById, RARITY_COLOR, type RodKind, RODS, sellFish, setActiveBait,
} from '@/world/fish';

export interface CatchResult {
	caught: boolean;
	perfect: boolean;
	treasure: boolean;
}

/**
 * El minijuego de pesca (estilo Stardew Valley): el pez sube y baja nervioso por la barra y hay que
 * mantener la zona verde encima apretando (clic, espacio o E). Si lo sigue, se llena el medidor; si
 * se escapa, se vacía. A veces aparece un COFRE: si la zona lo cubre un rato, es tuyo.
 * Una pesca PERFECTA (sin que el medidor baje nunca) da un pez más grande.
 */
export function FishingGame({fish, rod, onDone}: {fish: FishKind; rod: RodKind; onDone: (result: CatchResult) => void}): JSX.Element {
	const barRef = useRef<HTMLDivElement>(null);
	const fishRef = useRef<HTMLDivElement>(null);
	const meterRef = useRef<HTMLDivElement>(null);
	const chestRef = useRef<HTMLDivElement>(null);
	const chestFillRef = useRef<HTMLDivElement>(null);
	const perfectRef = useRef<HTMLSpanElement>(null);
	const holding = useRef(false);
	const doneRef = useRef(onDone);
	doneRef.current = onDone;

	useEffect(() => {
		const zone = Math.min(0.42, 0.3 - fish.difficulty * 0.1 + rod.zone);
		let barY = 0;
		let barV = 0;
		let fishY = 0.4;
		let fishTarget = 0.5;
		let fishV = 0;
		let progress = 0.3;
		let nextMove = 0;
		let perfect = true;
		// Cofre: aparece a veces, en un lugar al azar, y hay que cubrirlo un ratito.
		const chest = Math.random() < 0.28 ? {at: 1.2 + Math.random() * 2, y: 0.1 + Math.random() * 0.8, fill: 0, shown: false, got: false} : null;
		let elapsed = 0;
		let last = performance.now();
		let frame = 0;
		let finished = false;
		const step = (now: number) => {
			const dt = Math.min(0.05, (now - last) / 1000);
			last = now;
			elapsed += dt;
			nextMove -= dt;
			if (nextMove <= 0) {
				const jump = 0.15 + fish.difficulty * 0.7;
				fishTarget = Math.min(1, Math.max(0, fishY + (Math.random() * 2 - 1) * jump));
				nextMove = 0.35 + Math.random() * (1.4 - fish.difficulty);
			}
			fishV += (fishTarget - fishY) * (4 + fish.difficulty * 10) * dt;
			fishV *= Math.pow(0.12, dt);
			fishY = Math.min(1, Math.max(0, fishY + fishV * dt * 3));
			barV += (holding.current ? 2.6 : -2.2) * dt;
			barY += barV * dt;
			if (barY < 0) {
				barY = 0;
				barV = barV < -0.5 ? -barV * 0.3 : 0;
			}
			if (barY > 1 - zone) {
				barY = 1 - zone;
				barV = 0;
			}
			const covers = (y: number) => y >= barY - 0.02 && y <= barY + zone + 0.02;
			const inside = covers(fishY);
			const before = progress;
			progress += inside ? 0.32 * rod.gain * dt : -(0.18 + fish.difficulty * 0.14) * rod.drain * dt;
			progress = Math.min(1, Math.max(0, progress));
			if (progress < before) perfect = false;
			if (chest && !chest.got) {
				if (!chest.shown && elapsed >= chest.at) chest.shown = true;
				if (chest.shown) {
					chest.fill = Math.min(1, Math.max(0, chest.fill + (covers(chest.y) ? 0.65 : -0.25) * dt));
					if (chest.fill >= 1) chest.got = true;
				}
			}
			if (barRef.current) {
				barRef.current.style.bottom = `${barY * 100}%`;
				barRef.current.style.height = `${zone * 100}%`;
				barRef.current.classList.toggle('is-on', inside);
			}
			if (fishRef.current) fishRef.current.style.bottom = `calc(${fishY * 100}% - 14px)`;
			if (meterRef.current) {
				meterRef.current.style.height = `${progress * 100}%`;
				meterRef.current.style.background = progress > 0.66 ? '#3fb68b' : progress > 0.33 ? '#f5b326' : '#ff7350';
			}
			if (chestRef.current && chest) {
				chestRef.current.style.display = chest.shown ? 'grid' : 'none';
				chestRef.current.style.bottom = `calc(${chest.y * 100}% - 13px)`;
				chestRef.current.classList.toggle('is-got', chest.got);
				if (chestFillRef.current) chestFillRef.current.style.transform = `scaleX(${chest.fill})`;
			}
			if (perfectRef.current) perfectRef.current.style.opacity = perfect ? '1' : '0';
			if (!finished && (progress >= 1 || progress <= 0)) {
				finished = true;
				setTimeout(() => doneRef.current({caught: progress >= 1, perfect: perfect && progress >= 1, treasure: Boolean(chest?.got)}), 250);
				return;
			}
			frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		const down = (e: KeyboardEvent) => {
			if (e.code === 'Space' || e.key.toLowerCase() === 'e') {
				e.preventDefault();
				e.stopPropagation();
				holding.current = true;
			}
		};
		const up = (e: KeyboardEvent) => {
			if (e.code === 'Space' || e.key.toLowerCase() === 'e') holding.current = false;
		};
		const mouseUp = () => (holding.current = false);
		window.addEventListener('keydown', down, true);
		window.addEventListener('keyup', up, true);
		window.addEventListener('pointerup', mouseUp);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('keydown', down, true);
			window.removeEventListener('keyup', up, true);
			window.removeEventListener('pointerup', mouseUp);
		};
	}, [fish, rod]);

	return (
		<div className="t-fishing" onPointerDown={(e) => { e.preventDefault(); holding.current = true; }}>
			<div className="t-fishing-card">
				<header><Fish size={18} strokeWidth={2.8} /> ¡Pica algo!<span className="t-perfect" ref={perfectRef}><Star size={12} strokeWidth={3} /> perfecto</span></header>
				<div className="t-fishing-game">
					<div className="t-fishing-rod" style={{background: rod.color}} title={rod.name} />
					<div className="t-fishing-water">
						<div className="t-fishing-zone" ref={barRef} />
						<div className="t-fishing-chest" ref={chestRef}><Gem size={18} strokeWidth={2.6} /><i><b ref={chestFillRef} /></i></div>
						<div className="t-fishing-fish" ref={fishRef}><Fish size={26} strokeWidth={2.6} /></div>
					</div>
					<div className="t-fishing-meter"><div ref={meterRef} /></div>
				</div>
				<p>Mantené apretado <kbd>clic</kbd> o <kbd>Espacio</kbd> para que el pez quede en la zona verde. Si aparece un cofre, ¡cubrilo también!</p>
			</div>
		</div>
	);
}

/** El puesto de Tano: vender lo pescado, comprar cañas y carnadas, y el álbum de peces. */
export function FishMarketPanel({onClose, onSold}: {onClose: () => void; onSold: (coins: number) => void}): JSX.Element {
	const profile = useProfile();
	const [tab, setTab] = useState<'sell' | 'shop' | 'book'>('sell');
	const [last, setLast] = useState(0);
	const [error, setError] = useState('');
	const entries = Object.entries(profile.fish).filter(([, n]) => n > 0);
	const total = entries.reduce((sum, [id, n]) => sum + (fishById(id)?.price ?? 0) * n, 0);
	const sell = (id: string | 'all') => {
		const earned = sellFish(id);
		setLast(earned);
		if (earned) onSold(earned);
	};
	const attempt = (fn: () => string | null) => {
		const result = fn();
		setError(result ?? '');
	};
	const album = FISH.filter((f) => !f.junk);
	const known = album.filter((f) => (profile.fishBest[f.id] ?? 0) > 0).length;
	return (
		<section className="t-panel t-fishmarket" onKeyDown={(e) => e.stopPropagation()}>
			<header className="t-panel-head">
				<span className="t-panel-icon"><Anchor size={20} strokeWidth={2.6} /></span>
				<h2>Pescadería de Tano</h2>
				<span className="t-coins"><Coins size={16} strokeWidth={2.6} /> {profile.coins}</span>
				<button type="button" className="t-close" onClick={onClose} aria-label="Cerrar"><X size={18} strokeWidth={3} /></button>
			</header>
			<nav className="t-tabs">
				<button type="button" className={tab === 'sell' ? 'is-active' : ''} onClick={() => setTab('sell')}><Coins size={15} strokeWidth={2.6} /> Vender</button>
				<button type="button" className={tab === 'shop' ? 'is-active' : ''} onClick={() => setTab('shop')}><ShoppingBag size={15} strokeWidth={2.6} /> Cañas y carnadas</button>
				<button type="button" className={tab === 'book' ? 'is-active' : ''} onClick={() => setTab('book')}><BookOpen size={15} strokeWidth={2.6} /> Álbum {known}/{album.length}</button>
			</nav>
			<div className="t-tv-body">
				{tab === 'sell' ? (
					<>
						<p className="t-hint">"¡Traeme lo que saques del agua y te lo pago al toque!"</p>
						{entries.length ? (
							<ul className="t-list t-fish-list">
								{entries.map(([id, count]) => {
									const kind = fishById(id);
									if (!kind) return null;
									return (
										<li key={id}>
											<span className="t-fish-icon" style={{background: kind.color}}><Fish size={18} strokeWidth={2.6} /></span>
											<span className="t-list-name">
												<strong>{kind.name} <em>x{count}</em></strong>
												<small style={{color: RARITY_COLOR[kind.rarity]}}>{kind.rarity} · récord {profile.fishBest[id] ?? 0} cm</small>
											</span>
											<span className="t-price"><Coins size={13} strokeWidth={2.8} /> {kind.price * count}</span>
											<button type="button" className="t-btn is-soft is-small" onClick={() => sell(id)}>Vender</button>
										</li>
									);
								})}
							</ul>
						) : <p className="t-empty">No tenés pescado. Andá al muelle, parate en una punta y apretá E para pescar. En la punta del muelle es más hondo: salen cosas más raras.</p>}
						{entries.length ? <button type="button" className="t-btn is-primary" onClick={() => sell('all')}><Coins size={15} strokeWidth={2.8} /> Vender todo por {total}</button> : null}
						{last ? <p className="t-now"><Coins size={14} strokeWidth={2.8} /> ¡Cobraste {last} pelamonedas!</p> : null}
					</>
				) : null}
				{tab === 'shop' ? (
					<>
						{error ? <p className="t-error">{error}</p> : null}
						<h3 className="t-subtitle">Cañas</h3>
						<div className="t-gear-grid">
							{RODS.map((rod) => {
								const owned = profile.rods.includes(rod.id);
								const using = profile.rod === rod.id;
								return (
									<div key={rod.id} className={`t-gear${using ? ' is-using' : ''}`}>
										<span className="t-gear-rod" style={{'--rod': rod.color} as React.CSSProperties}><i /></span>
										<strong>{rod.name}</strong>
										<small>{rod.desc}</small>
										<span className="t-gear-stats">
											<span title="Zona verde">Zona +{Math.round(rod.zone * 100)}</span>
											<span title="Suerte">Suerte +{Math.round(rod.luck * 100)}</span>
										</span>
										{using ? (
											<span className="t-btn is-soft is-small is-static"><Check size={13} strokeWidth={3} /> En uso</span>
										) : owned ? (
											<button type="button" className="t-btn is-soft is-small" onClick={() => attempt(() => buyRod(rod.id))}>Usar</button>
										) : (
											<button type="button" className="t-btn is-primary is-small" onClick={() => attempt(() => buyRod(rod.id))}><Coins size={13} strokeWidth={3} /> {rod.price}</button>
										)}
									</div>
								);
							})}
						</div>
						<h3 className="t-subtitle">Carnadas</h3>
						<ul className="t-list t-fish-list">
							{BAITS.map((bait) => {
								const count = profile.bait[bait.id] ?? 0;
								const active = profile.activeBait === bait.id && count > 0;
								return (
									<li key={bait.id} className={active ? 'is-active' : ''}>
										<span className="t-fish-icon" style={{background: bait.color}}><Sparkles size={16} strokeWidth={2.6} /></span>
										<span className="t-list-name">
											<strong>{bait.name} {count ? <em>· tenés {count}</em> : null}</strong>
											<small>{bait.desc} ({bait.pack} por paquete)</small>
										</span>
										{count > 0 ? (
											<button type="button" className={`t-btn is-small ${active ? 'is-primary' : 'is-soft'}`} onClick={() => setActiveBait(active ? null : bait.id)}>{active ? 'Puesta' : 'Poner'}</button>
										) : null}
										<button type="button" className="t-btn is-primary is-small" onClick={() => attempt(() => buyBait(bait.id))}><Coins size={13} strokeWidth={3} /> {bait.price}</button>
									</li>
								);
							})}
						</ul>
					</>
				) : null}
				{tab === 'book' ? (
					<div className="t-fish-album">
						{album.map((f) => {
							const best = profile.fishBest[f.id] ?? 0;
							return (
								<div key={f.id} className={`t-album-card${best ? '' : ' is-unknown'}`} style={{'--r': RARITY_COLOR[f.rarity]} as React.CSSProperties}>
									<span className="t-fish-icon" style={{background: best ? f.color : '#4a3a5e'}}><Fish size={22} strokeWidth={2.6} /></span>
									<strong>{best ? f.name : '???'}</strong>
									<small>{f.rarity}{f.deep ? ' · hondo' : ''}</small>
									<small>{best ? `${best} cm · ${f.price}` : f.deep ? 'Probá en la punta del muelle' : 'Seguí pescando'}</small>
								</div>
							);
						})}
					</div>
				) : null}
			</div>
		</section>
	);
}
