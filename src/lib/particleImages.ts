/**
 * Partículas incluidas en la app (carpeta particles/, empaquetada con Vite).
 *
 * Se guarda el ID en el perfil (no la ruta), así cada máquina resuelve su propia imagen
 * y no se rompe entre versiones.
 */
export interface ParticleImage {
	id: string;
	label: string;
	category: string;
	url: string;
}

const modules = import.meta.glob('../assets/particles/*.png', {eager: true, import: 'default'}) as Record<
	string,
	string
>;

const CATEGORY_LABELS: Record<string, string> = {
	circle: 'Círculos',
	dirt: 'Tierra',
	fire: 'Fuego',
	flame: 'Llamas',
	flare: 'Destellos',
	light: 'Luz',
	magic: 'Magia',
	muzzle: 'Disparos',
	scorch: 'Quemaduras',
	scratch: 'Rayones',
	slash: 'Cortes',
	smoke: 'Humo',
	spark: 'Chispas',
	star: 'Estrellas',
	symbol: 'Símbolos',
	trace: 'Estelas',
	twirl: 'Remolinos',
	window: 'Ventanas',
};

export const PARTICLE_IMAGES: ParticleImage[] = Object.entries(modules)
	.map(([path, url]) => {
		const file = path.split('/').pop() ?? '';
		const id = file.replace(/\.png$/i, '');
		const prefix = id.split('_')[0];
		return {
			id,
			label: id.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()),
			category: CATEGORY_LABELS[prefix] ?? 'Otros',
			url,
		};
	})
	.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

export const PARTICLE_CATEGORIES = Array.from(new Set(PARTICLE_IMAGES.map((item) => item.category)));

const BY_ID = new Map(PARTICLE_IMAGES.map((item) => [item.id, item]));

/** Resuelve el ID guardado en el perfil a la imagen local. */
export function particleUrl(id?: string): string | undefined {
	if (!id) return undefined;
	return BY_ID.get(id)?.url;
}

export function particleLabel(id?: string): string | undefined {
	if (!id) return undefined;
	return BY_ID.get(id)?.label;
}
