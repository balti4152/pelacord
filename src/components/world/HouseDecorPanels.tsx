/**
 * Paneles de la casa: "Paredes y piso" (empapelados, pintura y pisos con color a elección) y "Neón"
 * (dibujar tiras de neón sobre una pared; cuanto más larga, más cara).
 */
import {useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {Check, Coins, Paintbrush, Trash2, Undo2, X, Zap} from 'lucide-react';
import {getProfile, type PlacedFurniture, updateProfile, useProfile} from '@/world/core';
import type {WorldEngine} from '@/world/engine';
import {buildNeon, HOUSE_STYLES, NEON_COLORS, neonLength, neonPrice, stylePreview, wallCamera, wallHit, type StyleKind, type WallId} from '@/world/houseDecor';
import {worldSounds} from '@/world/worldSounds';

const SWATCHES = ['#5c428f', '#8a5cff', '#e8a0b4', '#ff7350', '#f5b326', '#ffe9a8', '#b8e0c8', '#38d39f', '#4fb3a9', '#7fb3d5', '#2f6fd8', '#2b2d5c', '#9c6236', '#b07a4a', '#eeeae4', '#2a2a2a'];
const fmt = (n: number) => n.toLocaleString('es-AR');

// ------------------------------------------------------- paredes y piso ---

export function WallsPanel({onClose}: {onClose: () => void}): JSX.Element {
	const profile = useProfile();
	const [kind, setKind] = useState<StyleKind>('wall');
	const current = profile.furniture.find((f) => f.id.startsWith(`style:${kind}:`));
	const currentId = current?.id.split(':')[2] ?? null;
	const [picked, setPicked] = useState<string>(currentId ?? HOUSE_STYLES.find((s) => s.kind === kind)!.id);
	const def = HOUSE_STYLES.find((s) => s.id === picked) ?? HOUSE_STYLES[0];
	const [color, setColor] = useState<string>(current?.color ?? def.color);
	const [message, setMessage] = useState('');
	useEffect(() => {
		const cur = getProfile().furniture.find((f) => f.id.startsWith(`style:${kind}:`));
		const id = cur?.id.split(':')[2] ?? HOUSE_STYLES.find((s) => s.kind === kind)!.id;
		setPicked(id);
		setColor(cur?.color ?? HOUSE_STYLES.find((s) => s.id === id)!.color);
		setMessage('');
	}, [kind]);
	const styles = HOUSE_STYLES.filter((s) => s.kind === kind);
	// Recolorear el estilo que ya tenés es gratis; cambiar de estilo se paga.
	const cost = currentId === picked ? 0 : def.price;
	const previews = useMemo(() => Object.fromEntries(styles.map((s) => [s.id, stylePreview(s.id, s.id === picked ? color : s.color)])), [kind, picked, color]); // eslint-disable-line react-hooks/exhaustive-deps

	const apply = (): void => {
		if (getProfile().coins < cost) {
			worldSounds.play('error');
			setMessage('No te alcanzan las monedas.');
			return;
		}
		updateProfile((p) => ({
			coins: p.coins - cost,
			furniture: [...p.furniture.filter((f) => !f.id.startsWith(`style:${kind}:`)), {uid: `style:${kind}`, id: `style:${kind}:${picked}`, color, x: 0, z: 0, rot: 0}],
		}));
		worldSounds.play(cost ? 'purchase' : 'place');
		setMessage(cost ? `¡Listo! Pagaste ${fmt(cost)} monedas.` : '¡Color cambiado!');
	};

	return (
		<section className="t-panel t-walls" onKeyDown={(e) => e.stopPropagation()}>
			<header className="t-panel-head">
				<span className="t-panel-icon"><Paintbrush size={20} strokeWidth={2.6} /></span>
				<h2>Paredes y piso</h2>
				<span className="t-walls-coins"><Coins size={14} strokeWidth={2.8} /> {fmt(profile.coins)}</span>
				<button type="button" className="t-close" onClick={onClose} aria-label="Cerrar"><X size={18} strokeWidth={3} /></button>
			</header>
			<nav className="t-tabs">
				<button type="button" className={kind === 'wall' ? 'is-active' : ''} onClick={() => setKind('wall')}>Paredes</button>
				<button type="button" className={kind === 'floor' ? 'is-active' : ''} onClick={() => setKind('floor')}>Piso</button>
			</nav>
			<div className="t-walls-grid">
				{styles.map((s) => (
					<button key={s.id} type="button" className={`t-walls-card${picked === s.id ? ' is-picked' : ''}`} onClick={() => { setPicked(s.id); if (s.id !== picked) setColor(currentId === s.id && current?.color ? current.color : s.color); }}>
						<img src={previews[s.id]} alt="" />
						<strong>{s.name}</strong>
						<small>{currentId === s.id ? 'Puesto' : <><Coins size={11} strokeWidth={3} /> {s.price}</>}</small>
					</button>
				))}
			</div>
			<div className="t-swatches">
				{SWATCHES.map((c) => <button key={c} type="button" className={`t-swatch${color === c ? ' is-on' : ''}`} style={{background: c}} aria-label={c} onClick={() => setColor(c)} />)}
				<label className="t-swatch is-custom" title="Otro color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
			</div>
			<footer className="t-walls-foot">
				{message ? <span className="t-hint">{message}</span> : <span className="t-hint">{cost ? `Cambiar a ${def.name}: ${fmt(cost)} monedas` : 'Cambiar el color es gratis.'}</span>}
				<button type="button" className="t-btn is-primary" disabled={profile.coins < cost} onClick={apply}><Check size={14} strokeWidth={3} /> {cost ? `Poner (${fmt(cost)})` : 'Poner'}</button>
			</footer>
		</section>
	);
}

// ----------------------------------------------------------------- neón ---

const WALLS: Array<{id: WallId; label: string}> = [
	{id: 'back', label: 'Pared del fondo'},
	{id: 'left', label: 'Pared derecha'},
	{id: 'right', label: 'Pared izquierda'},
];

export function NeonPanel({engine, meId, onClose}: {engine: WorldEngine; meId: string; onClose: () => void}): JSX.Element {
	const profile = useProfile();
	const [wall, setWall] = useState<WallId>('back');
	const [color, setColor] = useState(NEON_COLORS[0]);
	const [pts, setPts] = useState<number[]>([]);
	const ptsRef = useRef<number[]>([]);
	ptsRef.current = pts;
	const price = neonPrice(pts);
	const strips = profile.furniture.filter((f) => f.id === 'neon');
	const [showList, setShowList] = useState(false);
	// Cámara libre pero siempre de frente a la pared: ruedita = acercar/alejar, botón derecho = mover.
	const view = useRef({dist: 7, u: 0, v: 0});
	const applyView = (): void => {
		engine.cameraOverride = wallCamera(wall, view.current.dist, view.current.u, view.current.v);
	};

	useEffect(() => {
		view.current = {dist: 9, u: 0, v: 0};
		// Mi personaje no tapa la pared mientras dibujo.
		const me = engine.actorRoot(meId);
		if (me) me.visible = false;
		applyView();
		setPts([]);
		const {canvas} = engine.viewContext();
		const onWheel = (event: WheelEvent): void => {
			event.preventDefault();
			view.current.dist = Math.min(17, Math.max(1.6, view.current.dist * (event.deltaY > 0 ? 1.12 : 0.89)));
			applyView();
		};
		const onMenu = (event: Event): void => event.preventDefault();
		canvas.addEventListener('wheel', onWheel, {passive: false});
		canvas.addEventListener('contextmenu', onMenu);
		return () => {
			canvas.removeEventListener('wheel', onWheel);
			canvas.removeEventListener('contextmenu', onMenu);
			engine.cameraOverride = null;
			if (me) me.visible = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [engine, wall]);

	// El mouse dibuja sobre la pared: arrastrando hace un trazo libre; clics sueltos, tramos rectos.
	useEffect(() => {
		const {camera, canvas} = engine.viewContext();
		const raycaster = new THREE.Raycaster();
		let drawing = false;
		let downAt: {x: number; y: number} | null = null;
		let pan: {x: number; y: number; u: number; v: number} | null = null;
		const hit = (event: PointerEvent): THREE.Vector3 | null => {
			const rect = canvas.getBoundingClientRect();
			raycaster.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
			return wallHit(raycaster.ray, wall);
		};
		const push = (p: THREE.Vector3, minGap: number): void => {
			const cur = ptsRef.current;
			const n = cur.length;
			if (n >= 3 && Math.hypot(p.x - cur[n - 3], p.y - cur[n - 2], p.z - cur[n - 1]) < minGap) return;
			if (n >= 3 * 400) return;
			// Se guarda ya en la referencia: los movimientos rápidos llegan antes del próximo render.
			const next = [...cur, +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
			ptsRef.current = next;
			setPts(next);
		};
		engine.pointerHook = (kind, event) => {
			// Botón derecho (o del medio): mover la cámara por la pared.
			if (kind === 'down' && (event.button === 2 || event.button === 1)) {
				pan = {x: event.clientX, y: event.clientY, u: view.current.u, v: view.current.v};
				return true;
			}
			if (pan) {
				if (kind === 'move') {
					const k = view.current.dist / 700;
					view.current.u = Math.min(5, Math.max(-5, pan.u - (event.clientX - pan.x) * k * (wall === 'back' ? -1 : 1)));
					view.current.v = Math.min(1.3, Math.max(-1.2, pan.v + (event.clientY - pan.y) * k));
					applyView();
				}
				if (kind === 'up') pan = null;
				return true;
			}
			if (event.button !== 0 && kind !== 'move') return true;
			if (kind === 'down') {
				const p = hit(event);
				downAt = {x: event.clientX, y: event.clientY};
				if (p) {
					drawing = true;
					push(p, 0.01);
				}
			} else if (kind === 'move' && drawing && downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) {
				const p = hit(event);
				if (p) push(p, 0.05);
			} else if (kind === 'up') {
				drawing = false;
				downAt = null;
			}
			return true;
		};
		return () => {
			engine.pointerHook = null;
		};
	}, [engine, wall]);

	// La tira que estás dibujando, en vivo.
	useEffect(() => {
		const {root} = engine.viewContext();
		if (pts.length < 6) return;
		const preview = buildNeon({color, pts}, true);
		root.add(preview);
		return () => {
			preview.removeFromParent();
			preview.traverse((o) => {
				const m = o as THREE.Mesh;
				if (m.isMesh) m.geometry.dispose();
			});
		};
	}, [engine, pts, color]);

	// WASD mueve la cámara: A/D a los costados, W/S más cerca o más lejos (el personaje no camina).
	useEffect(() => {
		engine.setControlsBlocked(true);
		const keys = new Set<string>();
		const down = (event: KeyboardEvent): void => {
			const k = event.key.toLowerCase();
			if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
				keys.add(k);
				event.preventDefault();
			}
		};
		const up = (event: KeyboardEvent): void => {
			keys.delete(event.key.toLowerCase());
		};
		let frame = 0;
		let last = performance.now();
		const tick = (now: number): void => {
			frame = requestAnimationFrame(tick);
			const dt = Math.min(0.05, (now - last) / 1000);
			last = now;
			if (!keys.size) return;
			const right = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
			const forward = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
			const v = view.current;
			v.u = Math.min(5, Math.max(-5, v.u + right * (wall === 'back' ? -1 : 1) * 3 * dt));
			v.dist = Math.min(17, Math.max(1.6, v.dist - forward * 4 * dt));
			applyView();
		};
		frame = requestAnimationFrame(tick);
		window.addEventListener('keydown', down);
		window.addEventListener('keyup', up);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('keydown', down);
			window.removeEventListener('keyup', up);
			engine.setControlsBlocked(false);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [engine, wall]);

	// Ctrl+Z deshace el último punto.
	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault();
				setPts((cur) => cur.slice(0, -3));
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	const finish = (): void => {
		if (pts.length < 6) return;
		if (getProfile().coins < price) {
			worldSounds.play('error');
			return;
		}
		const strip: PlacedFurniture = {uid: `neon:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, id: 'neon', color, x: 0, z: 0, rot: 0, pts};
		updateProfile((p) => ({coins: p.coins - price, furniture: [...p.furniture, strip]}));
		worldSounds.play('purchase');
		setPts([]);
	};

	return (
		<section className="t-neon-bar" onKeyDown={(e) => e.stopPropagation()}>
			<div className="t-neon-row">
				<span className="t-neon-title"><Zap size={16} strokeWidth={2.8} /> Neón</span>
				{WALLS.map((w) => <button key={w.id} type="button" className={`t-btn is-small ${wall === w.id ? 'is-primary' : 'is-soft'}`} onClick={() => setWall(w.id)}>{w.label}</button>)}
				<span className="t-walls-coins"><Coins size={13} strokeWidth={2.8} /> {fmt(profile.coins)}</span>
				<button type="button" className="t-btn is-soft is-small" disabled={!pts.length} onClick={() => setPts(pts.slice(0, -3))} title="Deshacer (Ctrl+Z)"><Undo2 size={12} strokeWidth={3} /> Deshacer</button>
				<button type="button" className="t-btn is-soft is-small" onClick={onClose} title="Salir del neón"><X size={12} strokeWidth={3} /> Salir</button>
			</div>
			<div className="t-neon-row">
				<div className="t-swatches is-inline">
					{NEON_COLORS.map((c) => <button key={c} type="button" className={`t-swatch is-neon${color === c ? ' is-on' : ''}`} style={{background: c, boxShadow: `0 0 10px ${c}`}} aria-label={c} onClick={() => setColor(c)} />)}
					<label className="t-swatch is-custom" title="Otro color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
				</div>
				<span className="t-neon-cost">
					<span>{pts.length >= 6 ? `${neonLength(pts).toFixed(1)} m` : 'Dibujá en la pared'}</span>
					<strong className={price > profile.coins ? 'is-short' : ''}><Coins size={13} strokeWidth={2.8} /> {fmt(price)}</strong>
				</span>
				<button type="button" className="t-btn is-soft is-small" disabled={!pts.length} onClick={() => setPts([])}>Borrar</button>
				<button type="button" className="t-btn is-primary is-small" disabled={pts.length < 6 || price > profile.coins} onClick={finish}><Check size={13} strokeWidth={3} /> {price > profile.coins ? 'No alcanza' : 'Poner'}</button>
				{strips.length ? <button type="button" className="t-btn is-soft is-small" onClick={() => setShowList((v) => !v)}>Mis neones ({strips.length})</button> : null}
			</div>
			<p className="t-neon-help">Arrastrá para dibujar · clic y clic para una línea recta · WASD o ruedita para mover la cámara · botón derecho para correrte por la pared</p>
			{showList && strips.length ? (
				<ul className="t-list t-neon-list">
					{strips.map((s, i) => (
						<li key={s.uid}>
							<span className="t-dot" style={{background: s.color ?? '#fff', boxShadow: `0 0 8px ${s.color}`}} />
							<span className="t-list-name">Tira {i + 1} · {neonLength(s.pts ?? []).toFixed(1)} m</span>
							<button type="button" className="t-btn is-soft is-small" title="Sacar" onClick={() => updateProfile((p) => ({furniture: p.furniture.filter((f) => f.uid !== s.uid)}))}><Trash2 size={13} strokeWidth={3} /></button>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
