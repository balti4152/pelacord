import {useState} from 'react';
import {Avatar} from '@/components/primitives';
import {ParticlePicker} from '@/components/ParticlePicker';
import {ProfileOverlay} from '@/components/ProfileOverlay';
import {COSMETIC_COLORS, DECORATIONS, DECORATION_CATEGORIES, PROFILE_OVERLAYS} from '@/lib/cosmetics';
import {getDesktopTransport} from '@/lib/desktop';
import {fileToDataUrl} from '@/lib/image';
import {particleUrl} from '@/lib/particleImages';
import type {Member, ParticleDirection} from '@/types';

const DIRECTIONS: Array<{id: ParticleDirection; label: string; icon: string}> = [
	{id: 'down', label: 'Cae', icon: '↓'},
	{id: 'up', label: 'Sube', icon: '↑'},
	{id: 'right', label: 'Derecha', icon: '→'},
	{id: 'left', label: 'Izquierda', icon: '←'},
];

/** Galería de cosméticos: decoración, overlay, color, partícula, tamaño, cantidad y dirección. */
export function CosmeticsTab({
	me,
	onPatch,
	animations,
	onAnimations,
}: {
	me: Member;
	onPatch: (patch: Partial<Member>) => void;
	animations: boolean;
	onAnimations: (value: boolean) => void;
}): JSX.Element {
	const [query, setQuery] = useState('');
	const [category, setCategory] = useState('Todas');
	const [picker, setPicker] = useState<'deco' | 'particle' | null>(null);
	const equipped = me.decoration ?? 'none';
	const equippedOverlay = me.profileEffect ?? 'none';
	const search = query.trim().toLowerCase();
	const list = DECORATIONS.filter((item) => {
		const inCategory = category === 'Todas' || item.category === category;
		return inCategory && `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(search);
	});
	const decoPreview = me.customDeco ?? particleUrl(me.decoImage);
	const particlePreview = me.customParticle ?? particleUrl(me.particleImage);

	/** Sube una imagen propia (96px) y la sirve por P2P si se puede. */
	async function uploadImage(kind: 'deco' | 'particle', file: File): Promise<void> {
		const dataUrl = await fileToDataUrl(file, 96, 0.9);
		const transport = getDesktopTransport();
		if (transport) {
			try {
				const data = await (await fetch(dataUrl)).arrayBuffer();
				const ok = await transport.shareProfileAsset({kind, name: `${kind}.webp`, mime: 'image/webp', data});
				const endpoint = ok ? await transport.getFileEndpoint() : null;
				if (endpoint?.host && endpoint.port) {
					const url = `http://${endpoint.host}:${endpoint.port}/file/${kind}`;
					onPatch(
						kind === 'deco'
							? {customDeco: url, customDecoP2P: true, decoImage: undefined}
							: {customParticle: url, customParticleP2P: true, particleImage: undefined},
					);
					return;
				}
			} catch {
				// cae al data URL
			}
		}
		onPatch(
			kind === 'deco'
				? {customDeco: dataUrl, customDecoP2P: false, decoImage: undefined}
				: {customParticle: dataUrl, customParticleP2P: false, particleImage: undefined},
		);
	}

	function ParticleRow({kind, current}: {kind: 'deco' | 'particle'; current?: string}): JSX.Element {
		return (
			<div className="cosmetic-pick">
				<span className="cosmetic-pick-preview">
					{current ? <img src={current} alt="" /> : <span className="cosmetic-pick-empty">?</span>}
				</span>
				<div className="cosmetic-pick-info">
					<span className="cosmetic-pick-title">{kind === 'deco' ? 'Imagen del marco' : 'Imagen que cae'}</span>
					<span className="cosmetic-pick-sub">{current ? 'Elegida' : 'Ninguna todavía'}</span>
				</div>
				<button type="button" className="button primary" onClick={() => setPicker(kind)}>
					Elegir
				</button>
				{current ? (
					<button
						type="button"
						className="button secondary"
						onClick={() =>
							onPatch(
								kind === 'deco'
									? {customDeco: undefined, decoImage: undefined, customDecoP2P: false}
									: {customParticle: undefined, particleImage: undefined, customParticleP2P: false},
							)
						}>
						Quitar
					</button>
				) : null}
			</div>
		);
	}

	return (
		<>
			<h2 className="modal-title">Cosméticos</h2>

			<div className="cosmetics-preview">
				<div className="cosmetics-preview-avatar">
					<Avatar member={me} size={96} showStatus />
				</div>
				<div className="cosmetics-preview-side">
					<div className="cosmetics-preview-name">{me.name}</div>
					<div className="cosmetics-preview-sizes">
						{[48, 32, 24].map((size) => (
							<Avatar key={size} member={me} size={size} />
						))}
					</div>
					<p className="settings-hint">Así se ve en tu perfil y en tamaño chico (lista y mensajes).</p>
				</div>
			</div>

			<div className="cosmetics-block">
				<div className="cosmetics-block-head">
					<span className="cosmetics-block-title">Decoración del avatar</span>
					<div className="cosmetics-filters">
						{DECORATION_CATEGORIES.map((name) => (
							<button
								type="button"
								key={name}
								className={`cosmetics-filter${category === name ? ' is-active' : ''}`}
								onClick={() => setCategory(name)}>
								{name}
							</button>
						))}
					</div>
					<input
						className="input cosmetics-search"
						placeholder="Buscar…"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>

				<div className="cosmetics-grid">
					{list.map((item) => {
						const isEquipped = equipped === item.id;
						return (
							<button
								type="button"
								key={item.id}
								className={`cosmetic-card${isEquipped ? ' is-equipped' : ''}`}
								onClick={() =>
									onPatch({
										decoration: item.id,
										decorationColor: item.id === 'none' ? undefined : me.decorationColor ?? item.color,
									})
								}>
								<span className="cosmetic-card-preview">
									<Avatar member={{...me, decoration: item.id, decorationColor: me.decorationColor ?? item.color}} size={56} />
								</span>
								<span className="cosmetic-card-name">{item.name}</span>
								<span className={`cosmetic-chip ${isEquipped ? 'is-equipped' : 'is-apply'}`}>
									{isEquipped ? 'Equipada' : 'Aplicar'}
								</span>
							</button>
						);
					})}
					{list.length === 0 ? <p className="settings-hint">Sin resultados.</p> : null}
				</div>

				{equipped === 'custom' ? <ParticleRow kind="deco" current={decoPreview} /> : null}

				{equipped !== 'none' ? (
					<div className="cosmetics-controls">
						<div className="cosmetic-colors">
							<span className="cosmetic-colors-label">Color</span>
							{COSMETIC_COLORS.map((color) => (
								<button
									type="button"
									key={color}
									className={`cosmetic-swatch${me.decorationColor === color ? ' is-active' : ''}`}
									style={{backgroundColor: color}}
									title={color}
									onClick={() => onPatch({decorationColor: color})}
								/>
							))}
							<label className="cosmetic-swatch is-input" title="Elegir otro color">
								<input
									type="color"
									value={me.decorationColor ?? '#ff7ab8'}
									onChange={(event) => onPatch({decorationColor: event.target.value})}
								/>
							</label>
						</div>
						<label className="cosmetic-slider">
							<span>Tamaño del marco</span>
							<input
								type="range"
								min={0.5}
								max={1.8}
								step={0.1}
								value={me.decoSize ?? 1}
								onChange={(event) => onPatch({decoSize: Number(event.target.value)})}
							/>
							<span className="cosmetic-slider-value">{(me.decoSize ?? 1).toFixed(1)}×</span>
						</label>
						{equipped === 'custom' ? (
							<label className="settings-toggle">
								<input
									type="checkbox"
									checked={me.particleOriginal ?? false}
									onChange={(event) => onPatch({particleOriginal: event.target.checked})}
								/>
								<span>Mantener el color original de la imagen</span>
							</label>
						) : null}
					</div>
				) : null}
			</div>

			<div className="cosmetics-block">
				<div className="cosmetics-block-head">
					<span className="cosmetics-block-title">Overlay del perfil</span>
					<span className="settings-hint">Se reproduce al abrir tu perfil.</span>
				</div>

				<div className="cosmetics-grid">
					{PROFILE_OVERLAYS.map((item) => {
						const isEquipped = equippedOverlay === item.id;
						return (
							<button
								type="button"
								key={item.id}
								className={`cosmetic-card${isEquipped ? ' is-equipped' : ''}`}
								onClick={() =>
									onPatch({
										profileEffect: item.id,
										profileEffectColor: item.id === 'none' ? undefined : me.profileEffectColor ?? item.color,
									})
								}>
								<span className="cosmetic-card-preview">
									<span className="cosmetic-overlay-demo">
										<ProfileOverlay
											effect={item.id}
											color={me.profileEffectColor ?? item.color}
											particle={me.customParticle}
											imageId={me.particleImage}
											direction={me.particleDirection}
											size={me.particleSize}
											count={me.particleCount}
											speed={me.particleSpeed}
											life={me.particleLife}
											original={me.particleOriginal}
										/>
									</span>
								</span>
								<span className="cosmetic-card-name">{item.name}</span>
								<span className={`cosmetic-chip ${isEquipped ? 'is-equipped' : 'is-apply'}`}>
									{isEquipped ? 'Equipado' : 'Aplicar'}
								</span>
							</button>
						);
					})}
				</div>

				{equippedOverlay === 'custom' ? <ParticleRow kind="particle" current={particlePreview} /> : null}

				{equippedOverlay !== 'none' ? (
					<div className="cosmetics-controls">
						<div className="cosmetic-colors">
							<span className="cosmetic-colors-label">Color</span>
							{COSMETIC_COLORS.map((color) => (
								<button
									type="button"
									key={color}
									className={`cosmetic-swatch${me.profileEffectColor === color ? ' is-active' : ''}`}
									style={{backgroundColor: color}}
									title={color}
									onClick={() => onPatch({profileEffectColor: color})}
								/>
							))}
							<label className="cosmetic-swatch is-input" title="Elegir otro color">
								<input
									type="color"
									value={me.profileEffectColor ?? '#a78bfa'}
									onChange={(event) => onPatch({profileEffectColor: event.target.value})}
								/>
							</label>
						</div>

						<div className="cosmetic-directions">
							<span className="cosmetic-colors-label">Dirección</span>
							{DIRECTIONS.map((dir) => (
								<button
									type="button"
									key={dir.id}
									className={`cosmetic-direction${(me.particleDirection ?? 'up') === dir.id ? ' is-active' : ''}`}
									onClick={() => onPatch({particleDirection: dir.id})}>
									<span className="cosmetic-direction-icon">{dir.icon}</span>
									{dir.label}
								</button>
							))}
						</div>

						<label className="cosmetic-slider">
							<span>Tamaño</span>
							<input
								type="range"
								min={0.5}
								max={3}
								step={0.1}
								value={me.particleSize ?? 1}
								onChange={(event) => onPatch({particleSize: Number(event.target.value)})}
							/>
							<span className="cosmetic-slider-value">{(me.particleSize ?? 1).toFixed(1)}×</span>
						</label>
						<label className="cosmetic-slider">
							<span>Cantidad</span>
							<input
								type="range"
								min={1}
								max={20}
								step={1}
								value={me.particleCount ?? 5}
								onChange={(event) => onPatch({particleCount: Number(event.target.value)})}
							/>
							<span className="cosmetic-slider-value">{me.particleCount ?? 5}</span>
						</label>
						<label className="cosmetic-slider">
							<span>Velocidad</span>
							<input
								type="range"
								min={0.3}
								max={3}
								step={0.1}
								value={me.particleSpeed ?? 1}
								onChange={(event) => onPatch({particleSpeed: Number(event.target.value)})}
							/>
							<span className="cosmetic-slider-value">{(me.particleSpeed ?? 1).toFixed(1)}×</span>
						</label>
						<label className="cosmetic-slider">
							<span>Vida</span>
							<input
								type="range"
								min={0.2}
								max={1}
								step={0.05}
								value={me.particleLife ?? 1}
								onChange={(event) => onPatch({particleLife: Number(event.target.value)})}
							/>
							<span className="cosmetic-slider-value">{Math.round((me.particleLife ?? 1) * 100)}%</span>
						</label>
						{equippedOverlay === 'custom' ? (
							<label className="settings-toggle">
								<input
									type="checkbox"
									checked={me.particleOriginal ?? false}
									onChange={(event) => onPatch({particleOriginal: event.target.checked})}
								/>
								<span>Mantener el color original de la imagen</span>
							</label>
						) : null}
					</div>
				) : null}
			</div>

			<div className="cosmetics-block">
				<label className="settings-toggle">
					<input type="checkbox" checked={animations} onChange={(event) => onAnimations(event.target.checked)} />
					<span>Animar los cosméticos</span>
				</label>
				<p className="settings-hint">
					Si lo apagás, las decoraciones quedan fijas: útil si te molesta el movimiento o si la app va lenta.
				</p>
			</div>

			{picker ? (
				<ParticlePicker
					title={picker === 'deco' ? 'Elegí la imagen del marco' : 'Elegí la imagen que cae'}
					selectedId={picker === 'deco' ? me.decoImage : me.particleImage}
					onClose={() => setPicker(null)}
					onPick={(id) => {
						onPatch(
							picker === 'deco'
								? {decoImage: id, customDeco: undefined, customDecoP2P: false}
								: {particleImage: id, customParticle: undefined, customParticleP2P: false},
						);
						setPicker(null);
					}}
					onUpload={(file) => {
						void uploadImage(picker, file);
						setPicker(null);
					}}
				/>
			) : null}
		</>
	);
}
