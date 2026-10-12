import {useState} from 'react';
import {Icon} from '@/components/primitives';
import {PARTICLE_CATEGORIES, PARTICLE_IMAGES} from '@/lib/particleImages';

/**
 * Selector de partículas en un modal: las que vienen con la app (carpeta particles/) y la
 * opción de subir la propia. Así no se llena la página de imágenes.
 */
export function ParticlePicker({
	title,
	selectedId,
	onPick,
	onUpload,
	onClose,
}: {
	title: string;
	selectedId?: string;
	onPick: (id: string) => void;
	onUpload: (file: File) => void;
	onClose: () => void;
}): JSX.Element {
	const [query, setQuery] = useState('');
	const [category, setCategory] = useState('Todas');
	const search = query.trim().toLowerCase();
	const list = PARTICLE_IMAGES.filter((item) => {
		const inCategory = category === 'Todas' || item.category === category;
		return inCategory && `${item.id} ${item.label} ${item.category}`.toLowerCase().includes(search);
	});

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal particle-picker" onClick={(event) => event.stopPropagation()}>
				<div className="particle-picker-head">
					<h2 className="modal-title">{title}</h2>
					<button type="button" className="icon-btn" title="Cerrar" onClick={onClose}>
						<Icon name="x" size={18} />
					</button>
				</div>

				<div className="particle-picker-toolbar">
					<input
						className="input"
						placeholder="Buscar partícula…"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<label className="button primary" style={{cursor: 'pointer'}}>
						Subir la mía
						<input
							type="file"
							accept="image/png,image/webp,image/*"
							hidden
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = '';
								if (file) onUpload(file);
							}}
						/>
					</label>
				</div>

				<div className="particle-picker-filters">
					{['Todas', ...PARTICLE_CATEGORIES].map((name) => (
						<button
							type="button"
							key={name}
							className={`cosmetics-filter${category === name ? ' is-active' : ''}`}
							onClick={() => setCategory(name)}>
							{name}
						</button>
					))}
				</div>

				<div className="particle-grid">
					{list.map((item) => (
						<button
							type="button"
							key={item.id}
							className={`particle-tile${selectedId === item.id ? ' is-active' : ''}`}
							title={item.label}
							onClick={() => onPick(item.id)}>
							<img src={item.url} alt={item.label} loading="lazy" />
							<span>{item.label}</span>
						</button>
					))}
					{list.length === 0 ? <p className="settings-hint">Sin resultados.</p> : null}
				</div>
			</div>
		</div>
	);
}
