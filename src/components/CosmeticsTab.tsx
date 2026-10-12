import {useState} from 'react';
import {Avatar} from '@/components/primitives';
import {ProfileOverlay} from '@/components/ProfileOverlay';
import {COSMETIC_COLORS, DECORATIONS, DECORATION_CATEGORIES, PROFILE_OVERLAYS} from '@/lib/cosmetics';
import {getDesktopTransport} from '@/lib/desktop';
import {fileToDataUrl} from '@/lib/image';
import type {Member} from '@/types';

/**
 * Galería de cosméticos: se elige decoración y overlay, se personaliza el color y se ve
 * al instante cómo queda en el avatar grande y en los tamaños chicos.
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
	const needsImage = equipped === 'custom' || equippedOverlay === 'custom';

	/** La imagen propia se guarda chica (96px) y, si se puede, se sirve por P2P. */
	async function uploadParticle(file: File): Promise<void> {
		const dataUrl = await fileToDataUrl(file, 96, 0.9);
		const transport = getDesktopTransport();
		if (transport) {
			try {
				const data = await (await fetch(dataUrl)).arrayBuffer();
				const ok = await transport.shareProfileAsset({kind: 'particle', name: 'particle.webp', mime: 'image/webp', data});
				const endpoint = ok ? await transport.getFileEndpoint() : null;
				if (endpoint?.host && endpoint.port) {
					onPatch({customParticle: `http://${endpoint.host}:${endpoint.port}/file/particle`, customParticleP2P: true});
					return;
				}
			} catch {
				// cae al data URL
			}
		}
		onPatch({customParticle: dataUrl, customParticleP2P: false});
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

			{needsImage ? (
				<div className="settings-section">
					<span className="settings-label">Tu imagen</span>
					<div className="input-row">
						<label className="button primary" style={{cursor: 'pointer'}}>
							{me.customParticle ? 'Cambiar imagen' : 'Subir PNG'}
							<input
								type="file"
								accept="image/png,image/webp,image/*"
								hidden
								onChange={(event) => {
									const file = event.target.files?.[0];
									event.target.value = '';
									if (file) void uploadParticle(file);
								}}
							/>
						</label>
						{me.customParticle ? (
							<button
								type="button"
								className="button secondary"
								onClick={() => onPatch({customParticle: undefined, customParticleP2P: false})}>
								Quitar
							</button>
						) : null}
					</div>
					<p className="settings-hint">
						Se ve mejor un PNG chico y con fondo transparente. Cae alrededor de tu avatar y sobre tu perfil.
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
