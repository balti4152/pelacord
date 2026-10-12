import type {AvatarDecoration} from '@/types';

export interface DecorationInfo {
	id: AvatarDecoration;
	name: string;
	description: string;
	category: string;
}

/**
 * Catálogo de decoraciones del avatar. Las animaciones son CSS puro (sin imágenes),
 * así se ven nítidas a cualquier tamaño y no hay nada que descargar.
 */
export const DECORATIONS: DecorationInfo[] = [
	{id: 'none', name: 'Sin decoración', description: 'Solo tu avatar, limpio.', category: 'Básico'},
	{id: 'hearts', name: 'Cutie Patootie', description: 'Corazones flotando, brillo rosado y un rebote suave.', category: 'Tierno'},
	{id: 'arcane', name: 'Arcane Mystic', description: 'Anillos mágicos girando, runas y partículas.', category: 'Mágico'},
	{id: 'cyber', name: 'Cyberpunk Neon', description: 'Neón cian y magenta con línea de escaneo.', category: 'Sci-fi'},
];

export const DECORATION_CATEGORIES = ['Todas', 'Tierno', 'Mágico', 'Sci-fi', 'Básico'];
