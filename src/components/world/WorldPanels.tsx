import {useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {Avatar} from '@/world/avatars';
import {
	buy, type Catalog, type CatalogItem, type ColorKey, type Look, owns, type PlacedFurniture, type PlayerState,
	SLOT_EMOJI, SLOT_LABEL, type Slot, updateProfile, useProfile,
} from '@/world/core';
import {BOT, cuatroDrop, GAME_EMOJI, GAME_NAMES, games, useGames} from '@/world/games';
import type {GameKind, GameSession} from '@/world/core';

// ------------------------------------------------------------ vista previa --

/** El personaje girando, para el editor (se arrastra para darlo vuelta). */
export function AvatarPreview({catalog, look}: {catalog: Catalog; look: Look}): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	const avatarRef = useRef<Avatar | null>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		el.append(renderer.domElement);
		const scene = new THREE.Scene();
		scene.add(new THREE.HemisphereLight(0xe8e0ff, 0x3a2552, 1.6));
		const key = new THREE.DirectionalLight(0xfff0dd, 1.6);
		key.position.set(-2, 3, 3);
		scene.add(key);
		const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
		camera.position.set(0, 0.95, 3.1);
		camera.lookAt(0, 0.68, 0);
		const avatar = new Avatar(catalog, look);
		avatarRef.current = avatar;
		scene.add(avatar.root);
		let spin = 0.5;
		let drag: number | null = null;
		const onDown = (e: PointerEvent) => (drag = e.clientX);
		const onMove = (e: PointerEvent) => {
			if (drag === null) return;
			avatar.root.rotation.y += (e.clientX - drag) * 0.012;
			drag = e.clientX;
			spin = 0;
		};
		const onUp = () => (drag = null);
		renderer.domElement.addEventListener('pointerdown', onDown);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		const clock = new THREE.Clock();
		let raf = 0;
		const resize = () => {
			const size = el.clientWidth || 260;
			renderer.setSize(size, el.clientHeight || size, false);
			camera.aspect = size / (el.clientHeight || size);
			camera.updateProjectionMatrix();
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(el);
		const loop = () => {
			raf = requestAnimationFrame(loop);
			const dt = Math.min(0.05, clock.getDelta());
			avatar.root.rotation.y += spin * dt;
			avatar.update(dt);
			renderer.render(scene, camera);
		};
		loop();
		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			avatar.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		};
		// El look se aplica en el otro efecto (no hace falta rearmar todo).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [catalog]);
	useEffect(() => {
		void avatarRef.current?.setLook(look);
	}, [look]);
	return <div className="w-preview" ref={ref} title="Arrastralo para darlo vuelta" />;
}

// ----------------------------------------------------------------- editor --

const EDITOR_TABS: Array<{id: string; label: string; slots: Slot[]}> = [
	{id: 'body', label: 'Cuerpo', slots: []},
	{id: 'hair', label: 'Pelo', slots: ['hair']},
	{id: 'face', label: 'Cara', slots: ['eyes', 'brows', 'mouth', 'cheeks']},
	{id: 'clothes', label: 'Ropa', slots: ['top', 'bottom', 'shoes']},
	{id: 'extras', label: 'Accesorios', slots: ['hat', 'costume']},
];
const OPTIONAL: Slot[] = ['hair', 'cheeks', 'hat', 'costume'];
const COLOR_FOR: Partial<Record<string, Array<{key: ColorKey; label: string; palette: 'hair' | 'skin' | 'clothes'}>>> = {
	body: [{key: 'skin', label: 'Piel', palette: 'skin'}],
	hair: [{key: 'hair', label: 'Color de pelo', palette: 'hair'}],
	clothes: [
		{key: 'top', label: 'Color de arriba', palette: 'clothes'},
		{key: 'bottom', label: 'Color de abajo', palette: 'clothes'},
		{key: 'shoes', label: 'Calzado', palette: 'clothes'},
		{key: 'sole', label: 'Suela', palette: 'clothes'},
	],
};

function Swatches({colors, value, onPick}: {colors: string[]; value: string; onPick: (c: string) => void}): JSX.Element {
	return (
		<div className="w-swatches">
			{colors.map((color) => (
				<button
					key={color}
					type="button"
					className={`w-swatch${color.toLowerCase() === value.toLowerCase() ? ' is-active' : ''}`}
					style={{background: color}}
					aria-label={color}
					onClick={() => onPick(color)}
				/>
			))}
			<label className="w-swatch is-custom" title="Otro color">
				<input type="color" value={value} onChange={(e) => onPick(e.target.value)} />
			</label>
		</div>
	);
}

export function EditorPanel({catalog, onClose, firstTime}: {catalog: Catalog; onClose: () => void; firstTime: boolean}): JSX.Element {
	const profile = useProfile();
	const [draft, setDraft] = useState<Look>(profile.look);
	const [tab, setTab] = useState('body');
	const [error, setError] = useState('');
	const palettes = catalog.avatar.palettes;
	const current = EDITOR_TABS.find((t) => t.id === tab) ?? EDITOR_TABS[0];

	function pick(slot: Slot, item: CatalogItem | null): void {
		setError('');
		if (item && !owns(item, profile)) {
			const problem = buy(item);
			if (problem) {
				setError(problem);
				return;
			}
		}
		setDraft((d) => ({...d, [slot]: item ? item.id : null}));
	}

	return (
		<div className="w-panel w-editor">
			<header className="w-panel-head">
				<h2>{firstTime ? 'Creá tu personaje' : 'Mi personaje'}</h2>
				<span className="w-coins">🪙 {profile.coins}</span>
				{firstTime ? null : <button type="button" className="w-x" onClick={onClose} aria-label="Cerrar">✕</button>}
			</header>
			<div className="w-editor-body">
				<AvatarPreview catalog={catalog} look={draft} />
				<div className="w-editor-side">
					<nav className="w-tabs">
						{EDITOR_TABS.map((t) => (
							<button key={t.id} type="button" className={t.id === tab ? 'is-active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
						))}
					</nav>
					<div className="w-editor-options">
						{tab === 'body' ? (
							<div className="w-row">
								{(['M', 'F'] as const).map((body) => (
									<button key={body} type="button" className={`w-chip big${draft.body === body ? ' is-active' : ''}`} onClick={() => setDraft((d) => ({...d, body}))}>
										{body === 'M' ? '🧑 Chico' : '👩 Chica'}
									</button>
								))}
							</div>
						) : null}
						{current.slots.map((slot) => {
							const items = catalog.items.filter((i) => i.slot === slot);
							return (
								<section key={slot}>
									<h3>{SLOT_LABEL[slot]}</h3>
									<div className="w-grid">
										{OPTIONAL.includes(slot) ? (
											<button type="button" className={`w-item${!(draft as unknown as Record<string, string | null>)[slot] ? ' is-active' : ''}`} onClick={() => pick(slot, null)}>
												<span className="w-item-emoji">🚫</span>
												<span>Nada</span>
											</button>
										) : null}
										{items.map((item) => {
											const have = owns(item, profile);
											const active = (draft as unknown as Record<string, string | null>)[slot] === item.id;
											return (
												<button key={item.id} type="button" className={`w-item${active ? ' is-active' : ''}${have ? '' : ' is-locked'}`} onClick={() => pick(slot, item)} title={have ? item.name : `Comprar por ${item.price} monedas`}>
													<span className="w-item-emoji">{SLOT_EMOJI[slot]}</span>
													<span>{item.name}</span>
													{have ? null : <span className="w-price">🪙 {item.price}</span>}
												</button>
											);
										})}
									</div>
								</section>
							);
						})}
						{(COLOR_FOR[tab] ?? []).map(({key, label, palette}) => (
							<section key={key}>
								<h3>{label}</h3>
								<Swatches colors={palettes[palette]} value={draft.colors[key]} onPick={(color) => setDraft((d) => ({...d, colors: {...d.colors, [key]: color}}))} />
							</section>
						))}
					</div>
					{error ? <p className="w-error">{error}</p> : null}
					<footer className="w-panel-foot">
						<span className="w-hint">Lo que tiene 🪙 se compra al elegirlo.</span>
						<button
							type="button"
							className="w-primary"
							onClick={() => {
								updateProfile({look: draft, created: true});
								onClose();
							}}>
							{firstTime ? '¡Listo, a jugar!' : 'Guardar'}
						</button>
					</footer>
				</div>
			</div>
		</div>
	);
}

// ----------------------------------------------------------------- tienda --

export function ShopPanel({catalog, kind, onClose, onEdit}: {catalog: Catalog; kind: 'clothes' | 'furniture'; onClose: () => void; onEdit: () => void}): JSX.Element {
	const profile = useProfile();
	const sections = kind === 'furniture'
		? [...new Set(catalog.items.filter((i) => i.slot === 'furniture').map((i) => i.category ?? 'deco'))]
		: ['hair', 'eyes', 'brows', 'mouth', 'cheeks', 'top', 'bottom', 'shoes', 'hat', 'costume'];
	const [section, setSection] = useState(sections[0]);
	const [message, setMessage] = useState('');
	const [colorFor, setColorFor] = useState<Record<string, string>>({});
	const items = catalog.items.filter((i) => (kind === 'furniture' ? i.slot === 'furniture' && (i.category ?? 'deco') === section : i.slot === section));

	return (
		<div className="w-panel w-shop">
			<header className="w-panel-head">
				<h2>{kind === 'furniture' ? '🛋️ Muebles' : '👕 Ropa y estilo'}</h2>
				<span className="w-coins">🪙 {profile.coins}</span>
				<button type="button" className="w-x" onClick={onClose} aria-label="Cerrar">✕</button>
			</header>
			<nav className="w-tabs">
				{sections.map((s) => (
					<button key={s} type="button" className={s === section ? 'is-active' : ''} onClick={() => setSection(s)}>
						{SLOT_EMOJI[s] ?? '•'} {SLOT_LABEL[s] ?? s[0].toUpperCase() + s.slice(1)}
					</button>
				))}
			</nav>
			<div className="w-shop-grid">
				{items.map((item) => {
					const have = item.slot !== 'furniture' && owns(item, profile);
					const count = item.slot === 'furniture' ? profile.furniture.filter((f) => f.id === item.id).length : 0;
					const color = colorFor[item.id] ?? item.defaultColor ?? '#8a5cff';
					return (
						<div key={item.id} className={`w-card${have ? ' is-owned' : ''}`}>
							<span className="w-card-emoji" style={item.slot === 'furniture' && item.recolor?.length ? {background: color} : undefined}>{SLOT_EMOJI[item.slot === 'furniture' ? (item.category ?? 'deco') : item.slot]}</span>
							<strong>{item.name}</strong>
							<span className="w-card-price">{item.price === 0 ? 'Gratis' : `🪙 ${item.price}`}</span>
							{item.slot === 'furniture' && item.recolor?.length ? (
								<Swatches colors={catalog.avatar.palettes.clothes.slice(0, 8)} value={color} onPick={(c) => setColorFor((m) => ({...m, [item.id]: c}))} />
							) : null}
							{have ? (
								<button type="button" className="w-secondary" onClick={onEdit}>Ponértelo</button>
							) : (
								<button
									type="button"
									className="w-primary"
									disabled={profile.coins < item.price}
									onClick={() => {
										const problem = buy(item, color);
										setMessage(problem ?? (item.slot === 'furniture' ? `¡${item.name} comprado! Ponelo en tu casa con "Decorar".` : `¡${item.name} es tuyo!`));
									}}>
									{profile.coins < item.price ? 'No alcanza' : 'Comprar'}
								</button>
							)}
							{count ? <span className="w-card-count">Tenés {count}</span> : null}
						</div>
					);
				})}
			</div>
			{message ? <p className="w-toast-inline">{message}</p> : null}
		</div>
	);
}

// -------------------------------------------------------------- decorar ----

export function DecoratePanel({catalog, placing, onPlace, onRotate, onClose}: {
	catalog: Catalog;
	placing: PlacedFurniture | null;
	onPlace: (item: PlacedFurniture | null) => void;
	onRotate: () => void;
	onClose: () => void;
}): JSX.Element {
	const profile = useProfile();
	const name = (id: string) => catalog.items.find((i) => i.id === id)?.name ?? id;
	return (
		<div className="w-panel w-decorate">
			<header className="w-panel-head">
				<h2>🏠 Decorar mi casa</h2>
				<button type="button" className="w-x" onClick={onClose} aria-label="Terminar">✕</button>
			</header>
			{placing ? (
				<div className="w-placing">
					<p>Hacé clic en el piso para poner <strong>{name(placing.id)}</strong>.</p>
					<div className="w-row">
						<button type="button" className="w-secondary" onClick={onRotate}>↻ Girar (R)</button>
						<button type="button" className="w-secondary" onClick={() => onPlace(null)}>Cancelar</button>
					</div>
				</div>
			) : null}
			{profile.furniture.length === 0 ? <p className="w-hint">Todavía no compraste muebles. Andá a la 🛍️ Tienda.</p> : null}
			<ul className="w-inventory">
				{profile.furniture.map((item) => (
					<li key={item.uid}>
						<span className="w-dot" style={{background: item.color ?? '#999'}} />
						<span className="w-inv-name">{name(item.id)}</span>
						{item.x === null ? (
							<button type="button" className="w-primary small" onClick={() => onPlace(item)}>Poner</button>
						) : (
							<>
								<button type="button" className="w-secondary small" onClick={() => onPlace(item)}>Mover</button>
								<button
									type="button"
									className="w-secondary small"
									onClick={() => updateProfile((p) => ({furniture: p.furniture.map((f) => (f.uid === item.uid ? {...f, x: null, z: null} : f))}))}>
									Guardar
								</button>
							</>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

// --------------------------------------------------------------- juegos ----

function Board({session, meId, names}: {session: GameSession; meId: string; names: Record<string, string>}): JSX.Element {
	const mark = (who: string | null, index?: number) => {
		if (!who) return '';
		if (session.kind === 'tateti') return who === session.host ? '❌' : '⭕';
		if (session.kind === 'cuatro') return who === session.host ? '🔴' : '🟡';
		return index !== undefined ? session.cards?.[index] ?? '' : '';
	};
	const myTurn = session.turn === meId && !session.winner && !session.draw;
	const other = session.host === meId ? session.guest : session.host;
	const otherName = other === BOT ? 'la compu' : names[other] ?? 'tu amigo';
	const status = session.winner
		? session.winner === meId ? '🏆 ¡Ganaste! +60 monedas' : `${otherName} ganó`
		: session.draw ? '🤝 Empate (+20 monedas)' : myTurn ? 'Te toca' : `Le toca a ${otherName}`;

	return (
		<div className={`w-board is-${session.kind}`}>
			<div className="w-board-head">
				<strong>{GAME_EMOJI[session.kind]} {GAME_NAMES[session.kind]}</strong>
				<span>vs {otherName}</span>
				{session.kind === 'memo' ? <span className="w-score">{session.score?.[meId] ?? 0} – {session.score?.[other] ?? 0}</span> : null}
			</div>
			<div className="w-board-cells">
				{session.board.map((_, index) => {
					if (session.kind === 'memo') {
						const up = session.matched?.[index] !== undefined || session.revealed?.includes(index);
						return (
							<button key={index} type="button" className={`w-cell${up ? ' is-up' : ''}${session.matched?.[index] ? ' is-matched' : ''}`} disabled={!myTurn || up} onClick={() => games.move(session.id, index)}>
								{up ? mark('x', index) : '❔'}
							</button>
						);
					}
					const value = session.board[index];
					const playable = myTurn && (session.kind === 'cuatro' ? cuatroDrop(session.board, index % 7) >= 0 : !value);
					return (
						<button key={index} type="button" className="w-cell" disabled={!playable} onClick={() => games.move(session.id, index)}>
							{mark(value)}
						</button>
					);
				})}
			</div>
			<p className={`w-board-status${myTurn ? ' is-turn' : ''}`}>{status}</p>
		</div>
	);
}

export function GamesPanel({meId, myName, players, names, onClose}: {
	meId: string;
	myName: string;
	players: PlayerState[];
	names: Record<string, string>;
	onClose: () => void;
}): JSX.Element {
	const {sessions, invites} = useGames(meId);
	const [kind, setKind] = useState<GameKind>('tateti');
	const list = useMemo(() => Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt), [sessions]);
	return (
		<div className="w-panel w-games">
			<header className="w-panel-head">
				<h2>🎲 Juegos de mesa</h2>
				<button type="button" className="w-x" onClick={onClose} aria-label="Cerrar">✕</button>
			</header>
			{invites.map((invite) => (
				<div key={invite.session.id} className="w-invite">
					<span><strong>{invite.fromName}</strong> te invita a {GAME_NAMES[invite.session.kind]}</span>
					<button type="button" className="w-primary small" onClick={() => games.accept(invite.session.id)}>Jugar</button>
					<button type="button" className="w-secondary small" onClick={() => games.decline(invite.session.id)}>No</button>
				</div>
			))}
			<div className="w-row">
				{(Object.keys(GAME_NAMES) as GameKind[]).map((g) => (
					<button key={g} type="button" className={`w-chip${kind === g ? ' is-active' : ''}`} onClick={() => setKind(g)}>{GAME_EMOJI[g]} {GAME_NAMES[g]}</button>
				))}
			</div>
			<div className="w-opponents">
				<button type="button" className="w-secondary" onClick={() => games.invite(kind, BOT, myName)}>🤖 Contra la compu</button>
				{players.map((p) => (
					<button key={p.id} type="button" className="w-secondary" onClick={() => games.invite(kind, p.id, myName)}>🎮 {names[p.id] ?? p.name}</button>
				))}
				{players.length === 0 ? <span className="w-hint">Cuando tus amigos entren al mundo, los vas a poder invitar.</span> : null}
			</div>
			<div className="w-boards">
				{list.map((session) => (
					<div key={session.id} className="w-board-wrap">
						<Board session={session} meId={meId} names={names} />
						<div className="w-row">
							{session.winner || session.draw ? <button type="button" className="w-secondary small" onClick={() => games.rematch(session.id, myName)}>Revancha</button> : null}
							<button type="button" className="w-secondary small" onClick={() => games.quit(session.id)}>Salir</button>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
