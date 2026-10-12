import {useState} from 'react';
import {Avatar} from '@/components/primitives';
import {ProfileOverlay} from '@/components/ProfileOverlay';
import {DECORATIONS, DECORATION_CATEGORIES, PROFILE_OVERLAYS} from '@/lib/cosmetics';
import type {Member} from '@/types';

/**
 * Galería de cosméticos: se elige una decoración y se ve al instante cómo queda en el
 * avatar grande y en los tamaños chicos (lista de miembros, mensajes).
 */
export function CosmeticsTab({
	me,
	onEquip,
	onEquipOverlay,
	animations,
	onAnimations,
}: {
	me: Member;
	onEquip: (id: Member['decoration']) => void;
	onEquipOverlay: (id: string) => void;
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
							onClick={() => onEquip(item.id)}>
							<span className="cosmetic-card-preview">
								<Avatar member={{...me, decoration: item.id}} size={64} />
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
								onClick={() => onEquipOverlay(item.id)}>
								<span className="cosmetic-card-preview">
									<span className="cosmetic-overlay-demo">
										<ProfileOverlay effect={item.id} />
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
