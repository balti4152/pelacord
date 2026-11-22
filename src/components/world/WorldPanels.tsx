import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import * as THREE from 'three';
import {
	Armchair, Backpack, Bed, BellRing, Check, Coins, Crown, createLucideIcon, Dices, Footprints, Glasses, Lamp, Lock, Plus, Popcorn, Shirt,
	Smile, Sparkles, Trash2, User, Users, X, Eye, Brush, RotateCw, Move, Package, Bot, Minus, Send, Play, Layers, Grid3x3, CircleDot, Brain, Trophy,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {Avatar} from '@/world/avatars';
import {ProductPreview} from '@/components/world/ProductPreview';
import {buy, type Catalog, type CatalogItem, type ColorKey, type Look, owns, type PlacedFurniture, SLOT_LABEL, type Slot, updateProfile, useProfile} from '@/world/core';
import {CARD_COLOR_HEX, type CardColor, TABLE_GAMES, type TableGameKind, type TableSession} from '@/world/tableGames';
import {worldSounds} from '@/world/worldSounds';

const HairIcon = createLucideIcon('WorldHair', [
	['path', {d: 'M4 14V9a8 8 0 0 1 16 0v5M4 13c4-1 7-3 8-6 2 3 4 5 8 6M7 16a5 5 0 0 0 10 0', key: 'hair'}],
]);
const BrowsIcon = createLucideIcon('WorldBrows', [
	['path', {d: 'M2 11c2.5-2.5 5.5-2.5 8-1m4 0c2.5-1.5 5.5-1.5 8 1M6 15h.01M18 15h.01', key: 'brows'}],
]);
const MouthIcon = createLucideIcon('WorldMouth', [
	['path', {d: 'M3 10c3-1 5-3 7-3 1 0 2 1 2 1s1-1 2-1c2 0 4 2 7 3-1 4-5 7-9 7s-8-3-9-7Zm0 0c3 1 6 2 9 2s6-1 9-2', key: 'mouth'}],
]);
const CheeksIcon = createLucideIcon('WorldCheeks', [
	['path', {d: 'M8 8h.01M16 8h.01M9 15c1.5 2 4.5 2 6 0M3 12l2-1m0 3 2-1m10 0 2 1m0-3 2 1', key: 'cheeks'}],
]);
const BottomIcon = createLucideIcon('WorldBottom', [
	['path', {d: 'M5 3h14l2 18h-6l-3-10-3 10H3L5 3Zm0 4h14', key: 'bottom'}],
]);

export const SLOT_ICON: Record<string, LucideIcon> = {
	hair: HairIcon, eyes: Eye, brows: BrowsIcon, mouth: MouthIcon, cheeks: CheeksIcon, top: Shirt, bottom: BottomIcon, shoes: Footprints,
	hat: Crown, facewear: Glasses, back: Backpack, costume: Popcorn, furniture: Armchair,
	asientos: Armchair, dormitorio: Bed, mesas: Package, luces: Lamp, deco: Sparkles,
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

function CategoryTabs({children, label}: {children: ReactNode; label: string}): JSX.Element {
	const ref = useRef<HTMLElement>(null);

	useEffect(() => {
		const row = ref.current;
		if (!row) return;
		const wheel = (event: WheelEvent) => {
			if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
			const limit = row.scrollWidth - row.clientWidth;
			if (limit <= 0) return;
			const {deltaMode, deltaY} = event;
			const unit = deltaMode === 1 ? 18 : deltaMode === 2 ? row.clientWidth : 1;
			const next = Math.max(0, Math.min(limit, row.scrollLeft + deltaY * unit));
			if (next === row.scrollLeft) return;
			event.preventDefault();
			row.scrollLeft = next;
		};
		row.addEventListener('wheel', wheel, {passive: false});
		return () => row.removeEventListener('wheel', wheel);
	}, []);

	return <nav ref={ref} className="t-tabs t-category-tabs" aria-label={label}>{children}</nav>;
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
	{id: 'hair', label: 'Pelo', icon: HairIcon, slots: ['hair']},
	{id: 'face', label: 'Cara', icon: Smile, slots: ['eyes', 'brows', 'mouth', 'cheeks']},
	{id: 'clothes', label: 'Ropa', icon: Shirt, slots: ['top', 'bottom', 'shoes']},
	{id: 'extras', label: 'Accesorios', icon: Crown, slots: ['hat', 'facewear', 'back', 'costume']},
];
const OPTIONAL: Slot[] = ['hair', 'cheeks', 'hat', 'facewear', 'back', 'costume'];
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
	const {colors: _colors, body: _body, ...slots} = look;
	const ids = new Set(Object.values(slots));
	return catalog.items.filter((item) => ids.has(item.id) && item.price > 0 && !owned.includes(item.id));
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
		worldSounds.play(locked.length ? 'purchase' : 'confirm');
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
					<CategoryTabs label="Categorías de personalización">
						{EDITOR_TABS.map((t) => (
							<button key={t.id} type="button" className={t.id === tab ? 'is-active' : ''} onClick={() => setTab(t.id)}>
								<t.icon size={16} strokeWidth={2.6} /> {t.label}
							</button>
						))}
					</CategoryTabs>
					<div key={current.id} className="t-scroll">
						{current.slots.map((slot) => {
							const items = catalog.items.filter((i) => i.slot === slot);
							const Icon = SLOT_ICON[slot] ?? Sparkles;
							return (
								<section key={slot} className="t-section">
									<h3>{SLOT_LABEL[slot]}</h3>
									<div className="t-grid">
										{OPTIONAL.includes(slot) ? (
											<button type="button" className={`t-item${!(draft as unknown as Record<string, string | null>)[slot] ? ' is-active' : ''}`} onClick={() => setDraft((d) => ({...d, [slot]: null}))}>
												<span className="t-item-icon t-item-art is-none"><X size={20} strokeWidth={3} /></span>
												<span>Nada</span>
											</button>
										) : null}
										{items.map((item) => {
											const have = owns(item, profile);
											const active = (draft as unknown as Record<string, string | null>)[slot] === item.id;
											return (
												<button key={item.id} type="button" className={`t-item${active ? ' is-active' : ''}${have ? '' : ' is-locked'}`} onClick={() => setDraft((d) => ({...d, [slot]: item.id}))}>
													<ProductPreview className="t-item-art" item={item} avatarUrl={catalog.avatar.glb} look={draft}
														fallback={<Icon size={20} strokeWidth={2.4} />} />
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
		: ['top', 'bottom', 'shoes', 'hat', 'facewear', 'back', 'hair', 'eyes', 'brows', 'mouth', 'cheeks', 'costume'];
	const [section, setSection] = useState(sections[0]);
	const [message, setMessage] = useState('');
	const [colorFor, setColorFor] = useState<Record<string, string>>({});
	const items = catalog.items.filter((i) => (kind === 'furniture' ? i.slot === 'furniture' && (i.category ?? 'deco') === section : i.slot === section));
	return (
		<Panel title={kind === 'furniture' ? 'Muebles' : 'Ropa y estilo'} icon={kind === 'furniture' ? Armchair : Shirt} onClose={onClose} className="t-shop" coins={profile.coins}>
			{onSupplies ? <button type="button" className="t-btn is-soft t-pet-shop-link" onClick={onSupplies}><Sparkles size={16} /> Esferas de captura</button> : null}
			<CategoryTabs label="Categorías de la tienda">
				{sections.map((s) => {
					const Icon = SLOT_ICON[s] ?? Sparkles;
					return (
						<button key={s} type="button" className={s === section ? 'is-active' : ''} onClick={() => setSection(s)}>
							<Icon size={15} strokeWidth={2.6} /> {SLOT_LABEL[s] ?? s[0].toUpperCase() + s.slice(1)}
						</button>
					);
				})}
			</CategoryTabs>
			<div key={section} className="t-cards">
				{items.map((item) => {
					const have = item.slot !== 'furniture' && owns(item, profile);
					const count = item.slot === 'furniture' ? profile.furniture.filter((f) => f.id === item.id).length : 0;
					const color = colorFor[item.id] ?? item.defaultColor ?? '#8a5cff';
					const Icon = SLOT_ICON[item.slot === 'furniture' ? (item.category ?? 'deco') : item.slot] ?? Sparkles;
					return (
						<article key={item.id} className={`t-card${have ? ' is-owned' : ''}`}>
							<ProductPreview className="t-card-art" item={item} avatarUrl={catalog.avatar.glb}
								look={profile.look} color={item.slot === 'furniture' ? color : undefined}
								fallback={<Icon size={30} strokeWidth={2.2} />} />
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
											worldSounds.play(problem ? 'error' : 'purchase');
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

const FIXTURES: Array<{id: string; name: string}> = [
	{id: 'fixture:tv', name: 'La tele'},
	{id: 'fixture:window', name: 'La ventana'},
	{id: 'fixture:door', name: 'La puerta al patio'},
];
const FURNITURE_SWATCHES = ['#8a5cff', '#f5b326', '#ff7350', '#6bc7ff', '#38d39f', '#ff4fa8', '#e0365a', '#5c428f', '#9c6236', '#f4ead8', '#3a2a33', '#ffffff'];

export function DecoratePanel({catalog, placing, onPlace, onRotate, onClose}: {
	catalog: Catalog;
	placing: PlacedFurniture | null;
	onPlace: (item: PlacedFurniture | null) => void;
	onRotate: () => void;
	onClose: () => void;
}): JSX.Element {
	const profile = useProfile();
	const [painting, setPainting] = useState<string | null>(null);
	const name = (id: string) => FIXTURES.find((f) => f.id === id)?.name ?? catalog.items.find((i) => i.id === id)?.name ?? id;
	const canPaint = (id: string) => Boolean(catalog.items.find((i) => i.id === id)?.recolor?.length);
	const furniture = profile.furniture.filter((f) => !f.id.startsWith('fixture:'));
	const setItem = (uid: string, change: Partial<PlacedFurniture>) => updateProfile((p) => ({furniture: p.furniture.map((f) => (f.uid === uid ? {...f, ...change} : f))}));
	const fixture = placing?.id.startsWith('fixture:');
	return (
		<Panel title="Decorar mi casa" icon={Brush} onClose={onClose} className="t-decorate">
			{placing ? (
				<div className="t-callout">
					<p><Move size={15} strokeWidth={2.8} /> {fixture
						? <>Mové el mouse cerca de una pared y hacé clic para dejar <strong>{name(placing.id)}</strong> ahí.</>
						: <>Mové el mouse y hacé clic donde quieras poner <strong>{name(placing.id)}</strong>.</>}</p>
					<div className="t-row">
						{fixture ? null : <button type="button" className="t-btn is-soft" onClick={onRotate}><RotateCw size={14} strokeWidth={2.8} /> Girar (R)</button>}
						<button type="button" className="t-btn is-soft" onClick={() => onPlace(null)}>Cancelar</button>
					</div>
				</div>
			) : (
				<p className="t-hint">Tocá un mueble (o la tele, la ventana o la puerta) para moverlo, o elegí uno guardado para ponerlo.</p>
			)}
			{furniture.length === 0 ? <p className="t-empty">Todavía no compraste muebles: andá a la Tienda de la ciudad.</p> : null}
			<ul className="t-list">
				{furniture.map((item) => (
					<li key={item.uid} className={`${placing?.uid === item.uid ? 'is-active' : ''}${painting === item.uid ? ' is-painting' : ''}`}>
						<div className="t-deco-row">
							{canPaint(item.id) ? (
								<button type="button" className="t-dot is-button" style={{background: item.color ?? '#a99bbd'}} title="Cambiar el color" onClick={() => setPainting((v) => (v === item.uid ? null : item.uid))} />
							) : <span className="t-dot" style={{background: item.color ?? '#a99bbd'}} />}
							<span className="t-list-name">{name(item.id)}</span>
							{item.x === null ? (
								<button type="button" className="t-btn is-primary is-small" onClick={() => onPlace(item)}><Plus size={13} strokeWidth={3} /> Poner</button>
							) : (
								<>
									<button type="button" className="t-btn is-soft is-small" title="Girar" onClick={() => { worldSounds.play('highlight'); setItem(item.uid, {rot: ((item.rot ?? 0) + Math.PI / 4) % (Math.PI * 2)}); }}><RotateCw size={13} strokeWidth={3} /></button>
									<button type="button" className="t-btn is-soft is-small" title="Mover" onClick={() => onPlace(item)}><Move size={13} strokeWidth={3} /></button>
									<button type="button" className="t-btn is-soft is-small" title="Guardar en el inventario" onClick={() => setItem(item.uid, {x: null, z: null})}>
										<Package size={13} strokeWidth={3} />
									</button>
								</>
							)}
						</div>
						{painting === item.uid ? (
							<div className="t-swatches">
								{FURNITURE_SWATCHES.map((c) => (
									<button key={c} type="button" className={`t-swatch${item.color === c ? ' is-on' : ''}`} style={{background: c}} aria-label={c} onClick={() => setItem(item.uid, {color: c})} />
								))}
								<label className="t-swatch is-custom" title="Otro color">
									<input type="color" value={item.color ?? '#a99bbd'} onChange={(e) => setItem(item.uid, {color: e.target.value})} />
								</label>
							</div>
						) : null}
					</li>
				))}
			</ul>
			<h3 className="t-subtitle">De la casa</h3>
			<ul className="t-list">
				{FIXTURES.map((f) => {
					const saved = profile.furniture.find((i) => i.uid === f.id);
					return (
						<li key={f.id} className={placing?.uid === f.id ? 'is-active' : ''}>
							<div className="t-deco-row">
								<span className="t-list-name">{f.name}</span>
								<button type="button" className="t-btn is-soft is-small" title="Mover por las paredes" onClick={() => onPlace(saved ?? {uid: f.id, id: f.id, x: null, z: null, rot: 0})}><Move size={13} strokeWidth={3} /></button>
								{saved ? <button type="button" className="t-btn is-soft is-small" title="Volver a su lugar" onClick={() => updateProfile((p) => ({furniture: p.furniture.filter((i) => i.uid !== f.id)}))}>Original</button> : null}
							</div>
						</li>
					);
				})}
			</ul>
		</Panel>
	);
}

// ---------------------------------------------------------------- amigos ---

export function FriendsPanel({friends, onBell, onInvite, onClose}: {
	friends: Array<{id: string; name: string; where: string | null; home: boolean}>;
	onBell: (id: string) => void;
	onInvite: (id: string) => void;
	onClose: () => void;
}): JSX.Element {
	const [rung, setRung] = useState<string[]>([]);
	const [sent, setSent] = useState<string[]>([]);
	return (
		<Panel title="Amigos" icon={Users} onClose={onClose} className="t-invite t-friends">
			<p className="t-hint">Tocale el timbre a un amigo para que te deje entrar a su casa, o invitalo a la tuya.</p>
			{friends.length === 0 ? <p className="t-empty">No hay nadie conectado ahora.</p> : null}
			<ul className="t-list">
				{friends.map((f) => (
					<li key={f.id}>
						<span className="t-dot is-online" />
						<span className="t-list-name"><strong>{f.name}</strong>{f.where ? <small>{f.where}</small> : null}</span>
						<button type="button" className="t-btn is-primary is-small" disabled={rung.includes(f.id)} title="Tocar el timbre de su casa" onClick={() => { onBell(f.id); setRung((r) => [...r, f.id]); window.setTimeout(() => setRung((r) => r.filter((x) => x !== f.id)), 8000); }}>
							<BellRing size={13} strokeWidth={3} /> {rung.includes(f.id) ? 'Sonando…' : 'Timbre'}
						</button>
						<button type="button" className="t-btn is-soft is-small" disabled={sent.includes(f.id)} title="Invitarlo a mi casa" onClick={() => { onInvite(f.id); setSent((s) => [...s, f.id]); }}>
							{sent.includes(f.id) ? <Check size={13} strokeWidth={3} /> : <Send size={13} strokeWidth={3} />}
						</button>
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
