import {useState} from 'react';
import {Avatar} from '@/components/primitives';
import {ProfileOverlay} from '@/components/ProfileOverlay';
import {COSMETIC_COLORS, DECORATIONS, DECORATION_CATEGORIES, PROFILE_OVERLAYS} from '@/lib/cosmetics';
import {getDesktopTransport} from '@/lib/desktop';
import {fileToDataUrl} from '@/lib/image';
import type {Member} from '@/types';

/**
 * Galería de cosméticos: decoración y overlay, con color, tamaño y cantidad ajustables.
 * La imagen del marco y la que cae son independientes.
 */
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
	const equipped = me.decoration ?? 'none';
	const equippedOverlay = me.profileEffect ?? 'none';
	const search = query.trim().toLowerCase();
	const list = DECORATIONS.filter((item) => {
		const inCategory = category === 'Todas' || item.category === category;
		return inCategory && `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(search);
	});

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
					onPatch(kind === 'deco' ? {customDeco: url, customDecoP2P: true} : {customParticle: url, customParticleP2P: true});
					return;
				}
			} catch {
				// cae al data URL
			}
		}
		onPatch(kind === 'deco' ? {customDeco: dataUrl, customDecoP2P: false} : {customParticle: dataUrl, customParticleP2P: false});
	}

	function UploadRow({
		kind,
		label,
		hint,
		current,
	}: {
		kind: 'deco' | 'particle';
		label: string;
		hint: string;
		current?: string;
	}): JSX.Element {
		return (
			<div className="settings-section">
				<span className="settings-label">{label}</span>
				<div className="input-row">
					<label className="button primary" style={{cursor: 'pointer'}}>
						{current ? 'Cambiar imagen' : 'Subir PNG'}
						<input
							type="file"
							accept="image/png,image/webp,image/*"
							hidden
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = '';
								if (file) void uploadImage(kind, file);
							}}
						/>
					</label>
					{current ? (
						<button
							type="button"
							className="button secondary"
							onClick={() =>
								onPatch(
									kind === 'deco'
										? {customDeco: undefined, customDecoP2P: false}
										: {customParticle: undefined, customParticleP2P: false},
								)
							}>
							Quitar
						</button>
					) : null}
				</div>
				<p className="settings-hint">{hint}</p>
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
					<p className="settings-hint">Así se ve en tu perfil y en tamaño chico (lista de miembros y mensajes).</p>
				</div>
			</div>

			<div className="cosmetics-toolbar">
				<input
					className="input"
					placeholder="Buscar cosmético…"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
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
								<Avatar member={{...me, decoration: item.id, decorationColor: me.decorationColor ?? item.color}} size={64} />
							</span>
							<span className="cosmetic-card-name">{item.name}</span>
							<span className="cosmetic-card-desc">{item.description}</span>
							<span className="cosmetic-card-foot">
								<span className="cosmetic-chip">{item.category}</span>
								<span className={`cosmetic-chip ${isEquipped ? 'is-equipped' : 'is-apply'}`}>
									{isEquipped ? 'Equipada' : 'Aplicar'}
								</span>
							</span>
						</button>
					);
				})}
				{list.length === 0 ? <p className="settings-hint">Sin resultados.</p> : null}
			</div>

			{equipped === 'custom' ? (
				<UploadRow
					kind="deco"
					label="Imagen del marco"
					hint="Tu PNG forma un anillo alrededor del avatar. Se ve mejor chico y con fondo transparente."
					current={me.customDeco}
				/>
			) : null}

			{equipped !== 'none' && equipped !== 'custom' ? (
				<div className="settings-section">
					<span className="settings-label">Color de la decoración</span>
					<div className="cosmetic-colors">
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
							<input type="color" value={me.decorationColor ?? '#ff7ab8'} onChange={(event) => onPatch({decorationColor: event.target.value})} />
						</label>
						<button type="button" className="cosmetic-reset" onClick={() => onPatch({decorationColor: undefined})}>
							Color por defecto
						</button>
					</div>
				</div>
			) : null}

			<div className="settings-section">
				<span className="settings-label">Overlay del perfil</span>
				<p className="settings-hint">Se reproduce cuando alguien abre tu perfil (y también cuando lo abrís vos).</p>
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
											size={me.particleSize}
											count={me.particleCount}
										/>
									</span>
								</span>
								<span className="cosmetic-card-name">{item.name}</span>
								<span className="cosmetic-card-desc">{item.description}</span>
								<span className="cosmetic-card-foot">
									<span className={`cosmetic-chip ${isEquipped ? 'is-equipped' : 'is-apply'}`}>
										{isEquipped ? 'Equipado' : 'Aplicar'}
									</span>
								</span>
							</button>
						);
					})}
				</div>
			</div>

			{equippedOverlay === 'custom' ? (
				<UploadRow
					kind="particle"
					label="Imagen que cae"
					hint="Tu PNG cae sobre el perfil, tipo nieve. Es independiente de la imagen del marco."
					current={me.customParticle}
				/>
			) : null}

			{equippedOverlay !== 'none' && equippedOverlay !== 'custom' ? (
				<div className="settings-section">
					<span className="settings-label">Color del overlay</span>
					<div className="cosmetic-colors">
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
						<button type="button" className="cosmetic-reset" onClick={() => onPatch({profileEffectColor: undefined})}>
							Color por defecto
						</button>
					</div>
				</div>
			) : null}

			{equipped !== 'none' || equippedOverlay !== 'none' ? (
				<div className="settings-section">
					<span className="settings-label">Partículas</span>
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
					<p className="settings-hint">
						La cantidad aplica al overlay del perfil. Las partículas salen en posiciones y tiempos al azar.
					</p>
				</div>
			) : null}

			<div className="settings-section">
				<label className="settings-toggle">
					<input type="checkbox" checked={animations} onChange={(event) => onAnimations(event.target.checked)} />
					<span>Animar los cosméticos</span>
				</label>
				<p className="settings-hint">
					Si lo apagás, las decoraciones quedan fijas: útil si te molesta el movimiento o si la app va lenta.
				</p>
			</div>
		</>
	);
}
