import {useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {
	Armchair, Bed, Check, Coins, Crown, Dices, Footprints, Glasses, Lamp, Lock, Plus, Popcorn, Shirt,
	Smile, Sparkles, Trash2, User, Users, X, Eye, Brush, RotateCw, Move, Package, Bot, Minus, Send, Play, Layers, Grid3x3, CircleDot, Brain, Trophy,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {Avatar} from '@/world/avatars';
import {buy, type Catalog, type CatalogItem, type ColorKey, type Look, owns, type PlacedFurniture, SLOT_LABEL, type Slot, updateProfile, useProfile} from '@/world/core';
import {CARD_COLOR_HEX, type CardColor, TABLE_GAMES, type TableGameKind, type TableSession} from '@/world/tableGames';

export const SLOT_ICON: Record<string, LucideIcon> = {
	hair: Sparkles, eyes: Eye, brows: Glasses, mouth: Smile, cheeks: Smile, top: Shirt, bottom: Shirt, shoes: Footprints,
	hat: Crown, costume: Popcorn, furniture: Armchair, asientos: Armchair, dormitorio: Bed, mesas: Package, luces: Lamp, deco: Sparkles,
};

// ------------------------------------------------------------ vista previa --

/** El personaje girando (se arrastra para darlo vuelta). */
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
		renderer.shadowMap.enabled = true;
		el.append(renderer.domElement);
		const scene = new THREE.Scene();
		scene.add(new THREE.HemisphereLight(0xfff4e6, 0x6b4a8f, 1.7));
		const key = new THREE.DirectionalLight(0xfff0dd, 1.7);
		key.position.set(-2, 3, 3);
		key.castShadow = true;
		scene.add(key);
		const floor = new THREE.Mesh(new THREE.CircleGeometry(0.6, 40), new THREE.ShadowMaterial({opacity: 0.25}));
		floor.rotation.x = -Math.PI / 2;
		floor.receiveShadow = true;
		scene.add(floor);
		const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
		camera.position.set(0, 1.05, 4.15);
		camera.lookAt(0, 0.88, 0);
		const avatar = new Avatar(catalog, look);
		avatarRef.current = avatar;
		scene.add(avatar.root);
		let spin = 0.45;
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
			const w = el.clientWidth || 260;
			const h = el.clientHeight || w;
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.zoom = Math.min(1, camera.aspect / .55);
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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [catalog]);
	useEffect(() => {
		void avatarRef.current?.setLook(look);
	}, [look]);
	return <div className="t-preview" ref={ref} title="Arrastralo para darlo vuelta" />;
}

export function Panel({title, icon: Icon, onClose, className = '', children, coins}: {title: string; icon: LucideIcon; onClose?: () => void; className?: string; children: React.ReactNode; coins?: number}): JSX.Element {
	return (
		<section className={`t-panel ${className}`} onKeyDown={(e) => e.stopPropagation()}>
			<header className="t-panel-head">
				<span className="t-panel-icon"><Icon size={20} strokeWidth={2.6} /></span>
				<h2>{title}</h2>
				{coins !== undefined ? <span className="t-coins"><Coins size={16} strokeWidth={2.6} /> {coins}</span> : null}
				{onClose ? (
					<button type="button" className="t-close" onClick={onClose} aria-label="Cerrar"><X size={18} strokeWidth={3} /></button>
				) : null}
			</header>
			{children}
		</section>
	);
}

function Swatches({colors, value, onPick}: {colors: string[]; value: string; onPick: (c: string) => void}): JSX.Element {
	return (
		<div className="t-swatches">
			{colors.map((color) => (
				<button key={color} type="button" className={`t-swatch${color.toLowerCase() === value.toLowerCase() ? ' is-active' : ''}`} style={{background: color}} aria-label={color} onClick={() => onPick(color)} />
			))}
			<label className="t-swatch is-custom" title="Otro color">
				<input type="color" value={value} onChange={(e) => onPick(e.target.value)} />
			</label>
		</div>
	);
}

// ----------------------------------------------------------------- editor --

const EDITOR_TABS: Array<{id: string; label: string; icon: LucideIcon; slots: Slot[]}> = [
	{id: 'body', label: 'Cuerpo', icon: User, slots: []},
	{id: 'hair', label: 'Pelo', icon: Sparkles, slots: ['hair']},
	{id: 'face', label: 'Cara', icon: Smile, slots: ['eyes', 'brows', 'mouth', 'cheeks']},
	{id: 'clothes', label: 'Ropa', icon: Shirt, slots: ['top', 'bottom', 'shoes']},
	{id: 'extras', label: 'Accesorios', icon: Crown, slots: ['hat', 'costume']},
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

/** Lo que falta comprar del look (para probarse cosas aunque no alcance la plata). */
function lockedItems(catalog: Catalog, look: Look, owned: string[]): CatalogItem[] {
	const ids = [look.hair, look.eyes, look.brows, look.mouth, look.cheeks, look.top, look.bottom, look.shoes, look.hat, look.costume].filter(Boolean) as string[];
	return ids.map((id) => catalog.items.find((i) => i.id === id)).filter((i): i is CatalogItem => Boolean(i && i.price > 0 && !owned.includes(i.id)));
}

export function EditorPanel({catalog, onClose, firstTime, tryOn}: {catalog: Catalog; onClose: () => void; firstTime: boolean; tryOn?: CatalogItem | null}): JSX.Element {
	const profile = useProfile();
	const [draft, setDraft] = useState<Look>(() => (tryOn && tryOn.slot !== 'furniture' ? {...profile.look, [tryOn.slot]: tryOn.id} : profile.look));
	const [tab, setTab] = useState(() => (tryOn ? (EDITOR_TABS.find((t) => t.slots.includes(tryOn.slot as Slot))?.id ?? 'body') : 'body'));
	const palettes = catalog.avatar.palettes;
	const current = EDITOR_TABS.find((t) => t.id === tab) ?? EDITOR_TABS[0];
	const locked = useMemo(() => lockedItems(catalog, draft, profile.owned), [catalog, draft, profile.owned]);
	const cost = locked.reduce((sum, item) => sum + item.price, 0);
	const canAfford = cost <= profile.coins;

	function save(): void {
		for (const item of locked) buy(item);
		updateProfile({look: draft, created: true});
		onClose();
	}

	return (
		<Panel title={firstTime ? 'Creá tu personaje' : 'Mi personaje'} icon={User} onClose={firstTime ? undefined : onClose} className="t-editor" coins={profile.coins}>
			<div className="t-editor-body">
				<div className="t-editor-left">
					<AvatarPreview catalog={catalog} look={draft} />
					<div className="t-body-pick">
						{(['M', 'F'] as const).map((body) => (
							<button key={body} type="button" className={`t-toggle${draft.body === body ? ' is-active' : ''}`} onClick={() => setDraft((d) => ({...d, body}))}>
								{body === 'M' ? 'Chico' : 'Chica'}
							</button>
						))}
					</div>
				</div>
				<div className="t-editor-side">
					<nav className="t-tabs">
						{EDITOR_TABS.map((t) => (
							<button key={t.id} type="button" className={t.id === tab ? 'is-active' : ''} onClick={() => setTab(t.id)}>
								<t.icon size={16} strokeWidth={2.6} /> {t.label}
							</button>
						))}
					</nav>
					<div className="t-scroll">
						{current.slots.map((slot) => {
							const items = catalog.items.filter((i) => i.slot === slot);
							const Icon = SLOT_ICON[slot] ?? Sparkles;
							return (
								<section key={slot} className="t-section">
									<h3>{SLOT_LABEL[slot]}</h3>
									<div className="t-grid">
										{OPTIONAL.includes(slot) ? (
											<button type="button" className={`t-item${!(draft as unknown as Record<string, string | null>)[slot] ? ' is-active' : ''}`} onClick={() => setDraft((d) => ({...d, [slot]: null}))}>
												<span className="t-item-icon is-none"><X size={20} strokeWidth={3} /></span>
												<span>Nada</span>
											</button>
										) : null}
										{items.map((item) => {
											const have = owns(item, profile);
											const active = (draft as unknown as Record<string, string | null>)[slot] === item.id;
											return (
												<button key={item.id} type="button" className={`t-item${active ? ' is-active' : ''}${have ? '' : ' is-locked'}`} onClick={() => setDraft((d) => ({...d, [slot]: item.id}))}>
													<span className="t-item-icon"><Icon size={20} strokeWidth={2.4} /></span>
													<span>{item.name}</span>
													{have ? null : <span className="t-price"><Lock size={11} strokeWidth={3} /> {item.price}</span>}
												</button>
											);
										})}
									</div>
								</section>
							);
						})}
						{(COLOR_FOR[tab] ?? []).map(({key, label, palette}) => (
							<section key={key} className="t-section">
								<h3>{label}</h3>
								<Swatches colors={palettes[palette]} value={draft.colors[key]} onPick={(color) => setDraft((d) => ({...d, colors: {...d.colors, [key]: color}}))} />
							</section>
						))}
					</div>
					<footer className="t-foot">
						{locked.length ? (
							<span className={`t-cost${canAfford ? '' : ' is-short'}`}>
								<Coins size={15} strokeWidth={2.6} /> {cost} para comprar {locked.length === 1 ? locked[0].name : `${locked.length} cosas`}
								{canAfford ? '' : ` · te faltan ${cost - profile.coins}`}
							</span>
						) : (
							<span className="t-hint">Probate lo que quieras: lo que tiene candado se compra al guardar.</span>
						)}
						<button type="button" className="t-btn is-primary" disabled={!canAfford} onClick={save}>
							<Check size={16} strokeWidth={3} /> {locked.length ? 'Comprar y guardar' : firstTime ? '¡A jugar!' : 'Guardar'}
						</button>
					</footer>
				</div>
			</div>
		</Panel>
	);
}

// ----------------------------------------------------------------- tienda --

export function ShopPanel({catalog, kind, onClose, onTry, onSupplies}: {catalog: Catalog; kind: 'clothes' | 'furniture'; onClose: () => void; onTry: (item: CatalogItem) => void; onSupplies?: () => void}): JSX.Element {
	const profile = useProfile();
	const sections = kind === 'furniture'
		? [...new Set(catalog.items.filter((i) => i.slot === 'furniture').map((i) => i.category ?? 'deco'))]
		: ['hair', 'eyes', 'brows', 'mouth', 'cheeks', 'top', 'bottom', 'shoes', 'hat', 'costume'];
	const [section, setSection] = useState(sections[0]);
	const [message, setMessage] = useState('');
	const [colorFor, setColorFor] = useState<Record<string, string>>({});
	const items = catalog.items.filter((i) => (kind === 'furniture' ? i.slot === 'furniture' && (i.category ?? 'deco') === section : i.slot === section));
	return (
		<Panel title={kind === 'furniture' ? 'Muebles' : 'Ropa y estilo'} icon={kind === 'furniture' ? Armchair : Shirt} onClose={onClose} className="t-shop" coins={profile.coins}>
			{onSupplies ? <button type="button" className="t-btn is-soft t-pet-shop-link" onClick={onSupplies}><Sparkles size={16} /> Esferas de captura</button> : null}
			<nav className="t-tabs">
				{sections.map((s) => {
					const Icon = SLOT_ICON[s] ?? Sparkles;
					return (
						<button key={s} type="button" className={s === section ? 'is-active' : ''} onClick={() => setSection(s)}>
							<Icon size={15} strokeWidth={2.6} /> {SLOT_LABEL[s] ?? s[0].toUpperCase() + s.slice(1)}
						</button>
					);
				})}
			</nav>
			<div className="t-cards">
				{items.map((item) => {
					const have = item.slot !== 'furniture' && owns(item, profile);
					const count = item.slot === 'furniture' ? profile.furniture.filter((f) => f.id === item.id).length : 0;
					const color = colorFor[item.id] ?? item.defaultColor ?? '#8a5cff';
					const Icon = SLOT_ICON[item.slot === 'furniture' ? (item.category ?? 'deco') : item.slot] ?? Sparkles;
					return (
						<article key={item.id} className={`t-card${have ? ' is-owned' : ''}`}>
							<span className="t-card-art" style={item.slot === 'furniture' && item.recolor?.length ? {background: color} : undefined}>
								<Icon size={30} strokeWidth={2.2} />
							</span>
							<strong>{item.name}</strong>
							<span className="t-card-price">{item.price === 0 ? 'Gratis' : <><Coins size={13} strokeWidth={2.6} /> {item.price}</>}</span>
							{item.slot === 'furniture' && item.recolor?.length ? (
								<Swatches colors={catalog.avatar.palettes.clothes.slice(0, 8)} value={color} onPick={(c) => setColorFor((m) => ({...m, [item.id]: c}))} />
							) : null}
							<div className="t-card-actions">
								{item.slot !== 'furniture' ? (
									<button type="button" className="t-btn is-soft" onClick={() => onTry(item)}><Eye size={14} strokeWidth={2.8} /> Probar</button>
								) : null}
								{have ? (
									<span className="t-owned"><Check size={14} strokeWidth={3} /> Tuyo</span>
								) : (
									<button
										type="button"
										className="t-btn is-primary"
										disabled={profile.coins < item.price}
										onClick={() => {
											const problem = buy(item, color);
											setMessage(problem ?? (item.slot === 'furniture' ? `¡${item.name} es tuyo! Ponelo en tu casa con Decorar.` : `¡${item.name} es tuyo!`));
										}}>
										{profile.coins < item.price ? 'No alcanza' : 'Comprar'}
									</button>
								)}
							</div>
							{count ? <span className="t-card-badge">x{count}</span> : null}
						</article>
					);
				})}
			</div>
			{message ? <p className="t-toast">{message}</p> : null}
		</Panel>
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
		<Panel title="Decorar mi casa" icon={Brush} onClose={onClose} className="t-decorate">
			{placing ? (
				<div className="t-callout">
					<p><Move size={15} strokeWidth={2.8} /> Mové el mouse y hacé clic donde quieras poner <strong>{name(placing.id)}</strong>.</p>
					<div className="t-row">
						<button type="button" className="t-btn is-soft" onClick={onRotate}><RotateCw size={14} strokeWidth={2.8} /> Girar (R)</button>
						<button type="button" className="t-btn is-soft" onClick={() => onPlace(null)}>Cancelar</button>
					</div>
				</div>
			) : (
				<p className="t-hint">Tocá un mueble de la casa para moverlo, o elegí uno guardado para ponerlo.</p>
			)}
			{profile.furniture.length === 0 ? <p className="t-empty">Todavía no compraste muebles: andá a la Tienda de la ciudad.</p> : null}
			<ul className="t-list">
				{profile.furniture.map((item) => (
					<li key={item.uid} className={placing?.uid === item.uid ? 'is-active' : ''}>
						<span className="t-dot" style={{background: item.color ?? '#a99bbd'}} />
						<span className="t-list-name">{name(item.id)}</span>
						{item.x === null ? (
							<button type="button" className="t-btn is-primary is-small" onClick={() => onPlace(item)}><Plus size={13} strokeWidth={3} /> Poner</button>
						) : (
							<>
								<button type="button" className="t-btn is-soft is-small" onClick={() => onPlace(item)}><Move size={13} strokeWidth={3} /></button>
								<button type="button" className="t-btn is-soft is-small" title="Guardar en el inventario" onClick={() => updateProfile((p) => ({furniture: p.furniture.map((f) => (f.uid === item.uid ? {...f, x: null, z: null} : f))}))}>
									<Package size={13} strokeWidth={3} />
								</button>
							</>
						)}
					</li>
				))}
			</ul>
		</Panel>
	);
}

// --------------------------------------------------------------- invitar ---

export function InvitePanel({friends, onInvite, onClose}: {friends: Array<{id: string; name: string; online: boolean}>; onInvite: (id: string) => void; onClose: () => void}): JSX.Element {
	const [sent, setSent] = useState<string[]>([]);
	return (
		<Panel title="Invitar a mi casa" icon={Users} onClose={onClose} className="t-invite">
			{friends.length === 0 ? <p className="t-empty">No hay nadie conectado ahora.</p> : null}
			<ul className="t-list">
				{friends.map((f) => (
					<li key={f.id}>
						<span className={`t-dot${f.online ? ' is-online' : ''}`} />
						<span className="t-list-name">{f.name}</span>
						<button type="button" className="t-btn is-primary is-small" disabled={sent.includes(f.id)} onClick={() => { onInvite(f.id); setSent((s) => [...s, f.id]); }}>
							{sent.includes(f.id) ? <><Check size={13} strokeWidth={3} /> Enviada</> : <><Send size={13} strokeWidth={3} /> Invitar</>}
						</button>
					</li>
				))}
			</ul>
		</Panel>
	);
}

// ------------------------------------------------------------------ mesa ---

const GAME_ART: Record<TableGameKind, {icon: LucideIcon; from: string; to: string}> = {
	cards: {icon: Layers, from: '#ff6b5b', to: '#ffb547'},
	tateti: {icon: Grid3x3, from: '#4fb3ff', to: '#8a5cff'},
	cuatro: {icon: CircleDot, from: '#ffc93c', to: '#ff6b5b'},
	memo: {icon: Brain, from: '#38d39f', to: '#4fb3ff'},
};
const SEAT_COLORS = ['#ff6b5b', '#4fb3ff', '#ffc93c', '#38d39f', '#8a5cff', '#e0365a'];

export function TablePanel({session, me, seated, names, onStart, onLeave, colorPick, onColor, onEnd}: {
	session: TableSession | null;
	me: string;
	seated: string[];
	names: (id: string) => string;
	onStart: (game: TableGameKind, bots: number) => void;
	onLeave: () => void;
	colorPick: boolean;
	onColor: (color: CardColor) => void;
	onEnd: () => void;
}): JSX.Element {
	const [bots, setBots] = useState(Math.max(0, 2 - seated.length));
	const [pick, setPick] = useState<TableGameKind>('cards');
	if (!session) {
		const game = TABLE_GAMES.find((g) => g.id === pick)!;
		const total = seated.length + bots;
		const ok = total >= game.min;
		return (
			<div className="tg-lobby">
				<header className="tg-lobby-head">
					<span className="tg-badge"><Dices size={22} strokeWidth={2.6} /></span>
					<div>
						<h2>Mesa de juegos</h2>
						<p>Elegí un juego. Los que se sienten en la mesa juegan con vos.</p>
					</div>
					<button type="button" className="t-btn is-soft is-small" onClick={onLeave}>Levantarme <kbd>E</kbd></button>
				</header>
				<div className="tg-games">
					{TABLE_GAMES.map((g) => {
						const art = GAME_ART[g.id];
						const Icon = art.icon;
						return (
							<button key={g.id} type="button" className={`tg-game${pick === g.id ? ' is-picked' : ''}`} onClick={() => setPick(g.id)}>
								<span className="tg-game-art" style={{background: `linear-gradient(135deg, ${art.from}, ${art.to})`}}>
									<Icon size={38} strokeWidth={2.4} />
									<i /><i /><i />
								</span>
								<strong>{g.name}</strong>
								<small>{g.desc}</small>
								<span className="tg-game-count"><Users size={12} strokeWidth={3} /> {g.min === g.max ? g.min : `${g.min}-${g.max}`}</span>
							</button>
						);
					})}
				</div>
				<footer className="tg-lobby-foot">
					<div className="tg-players">
						{seated.map((id, i) => (
							<span key={id} className="tg-chip" style={{'--c': SEAT_COLORS[i % 6]} as React.CSSProperties}>
								<span className="tg-dot">{names(id).slice(0, 1).toUpperCase()}</span>{id === me ? 'Vos' : names(id)}
							</span>
						))}
						{Array.from({length: bots}, (_, i) => (
							<span key={`b${i}`} className="tg-chip is-bot"><span className="tg-dot"><Bot size={12} strokeWidth={3} /></span>Compu {i + 1}</span>
						))}
					</div>
					<div className="tg-bots">
						<span><Bot size={15} strokeWidth={2.8} /> Compus</span>
						<button type="button" className="t-round is-small" onClick={() => setBots((b) => Math.max(0, b - 1))} aria-label="Menos compus"><Minus size={14} strokeWidth={3} /></button>
						<strong>{bots}</strong>
						<button type="button" className="t-round is-small" onClick={() => setBots((b) => Math.min(5, b + 1))} aria-label="Más compus"><Plus size={14} strokeWidth={3} /></button>
					</div>
					<button type="button" className="t-btn is-primary tg-play" disabled={!ok} onClick={() => onStart(pick, bots)}>
						<Play size={16} strokeWidth={3} /> {ok ? `¡A jugar ${game.name}!` : `Faltan ${game.min - total} jugadores`}
					</button>
				</footer>
			</div>
		);
	}
	const turn = session.players[session.turn];
	const game = TABLE_GAMES.find((g) => g.id === session.game);
	const art = GAME_ART[session.game];
	const done = Boolean(session.winner || session.draw);
	const mine = turn === me && !done;
	return (
		<>
			<div className="tg-hud">
				<div className="tg-hud-top">
					<span className="tg-title" style={{background: `linear-gradient(135deg, ${art.from}, ${art.to})`}}><art.icon size={16} strokeWidth={2.8} /> {game?.name}</span>
					<span className={`tg-turn${mine ? ' is-mine' : ''}${done ? ' is-done' : ''}`}>
						{done ? (session.winner ? (session.winner === me ? <><Trophy size={18} strokeWidth={2.8} /> ¡Ganaste!</> : <><Trophy size={18} strokeWidth={2.8} /> Ganó {names(session.winner)}</>) : 'Empate') : mine ? '¡Te toca!' : `Juega ${names(turn)}`}
					</span>
				</div>
				<div className="tg-players is-row">
					{session.players.map((p, i) => {
						const count = session.game === 'cards' ? session.hands?.[p]?.length ?? 0 : session.game === 'memo' ? session.score?.[p] ?? 0 : null;
						return (
							<span key={p} className={`tg-chip${p === turn && !done ? ' is-turn' : ''}${p === session.winner ? ' is-winner' : ''}`} style={{'--c': SEAT_COLORS[i % 6]} as React.CSSProperties}>
								<span className="tg-dot">{p.startsWith('bot:') ? <Bot size={12} strokeWidth={3} /> : names(p).slice(0, 1).toUpperCase()}</span>
								{p === me ? 'Vos' : names(p)}
								{count !== null ? <em>{session.game === 'cards' ? <Layers size={11} strokeWidth={3} /> : <Sparkles size={11} strokeWidth={3} />}{count}</em> : null}
							</span>
						);
					})}
				</div>
				{session.note ? <p className="tg-note">{session.note}</p> : null}
				{session.game === 'cards' && mine ? <p className="tg-tip">Tocá una carta que coincida en color o número, o el mazo para levantar.</p> : null}
			</div>
			<div className="tg-actions">
				{done && session.host === me ? <button type="button" className="t-btn is-primary is-small" onClick={onEnd}><Play size={13} strokeWidth={3} /> Otra partida</button> : null}
				{session.host === me && !done ? <button type="button" className="t-btn is-soft is-small" onClick={onEnd}><Trash2 size={13} strokeWidth={3} /> Terminar</button> : null}
				<button type="button" className="t-btn is-soft is-small" onClick={onLeave}>Levantarme <kbd>E</kbd></button>
			</div>
			{colorPick ? (
				<div className="tg-colors">
					<strong>¿Qué color pedís?</strong>
					<div>
						{(['r', 'y', 'g', 'b'] as CardColor[]).map((c) => (
							<button key={c} type="button" className="tg-color" style={{background: CARD_COLOR_HEX[c]}} onClick={() => onColor(c)} aria-label={c} />
						))}
					</div>
				</div>
			) : null}
		</>
	);
}
