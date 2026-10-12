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

export interface OverlayInfo {
	id: string;
	name: string;
	description: string;
}

/**
 * Overlays del perfil: se reproducen al abrir el perfil y van a tono con la decoración
 * del avatar (corazones con Cutie Patootie, energía con Arcane, neón con Cyberpunk).
 */
export const PROFILE_OVERLAYS: OverlayInfo[] = [
	{id: 'none', name: 'Sin overlay', description: 'El perfil se abre limpio.'},
	{id: 'hearts', name: 'Lluvia de corazones', description: 'Corazones que suben con un brillo rosado.'},
	{id: 'arcane', name: 'Energía arcana', description: 'Chispas mágicas y un halo violeta.'},
	{id: 'cyber', name: 'Neón y glitch', description: 'Líneas de escaneo y destellos cian/magenta.'},
];
