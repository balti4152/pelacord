import type {AvatarDecoration} from '@/types';

export interface DecorationInfo {
	id: AvatarDecoration;
	name: string;
	description: string;
	category: string;
	/** Color por defecto del estilo (se puede cambiar desde la galería). */
	color: string;
	/** Si el estilo usa una imagen propia que sube el usuario. */
	usesImage?: boolean;
}

/**
 * Catálogo de decoraciones del avatar. Las animaciones son CSS puro (sin imágenes),
 * así se ven nítidas a cualquier tamaño y no hay nada que descargar.
 */
export const DECORATIONS: DecorationInfo[] = [
	{id: 'none', name: 'Sin decoración', description: 'Solo tu avatar, limpio.', category: 'Básico', color: '#ffffff'},
	{
		id: 'hearts',
		name: 'Cutie Patootie',
		description: 'Corazones flotando, brillo y un rebote suave.',
		category: 'Amor',
		color: '#ff7ab8',
	},
	{
		id: 'arcane',
		name: 'Arcane Mystic',
		description: 'Anillos mágicos girando, runas y partículas.',
		category: 'Mágico',
		color: '#a78bfa',
	},
	{
		id: 'poison',
		name: 'Veneno',
		description: 'Burbujas tóxicas que suben y un brillo ácido.',
		category: 'Veneno',
		color: '#7cff4d',
	},
	{
		id: 'celestial',
		name: 'Celestial Halo',
		description: 'Halo luminoso con estrellitas en órbita.',
		category: 'Mágico',
		color: '#ffd76a',
	},
	{
		id: 'custom',
		name: 'Personalizado',
		description: 'Subí tu propio PNG y cae alrededor de tu avatar.',
		category: 'Tuyo',
		color: '#ffffff',
		usesImage: true,
	},
];

export const DECORATION_CATEGORIES = ['Todas', 'Amor', 'Mágico', 'Veneno', 'Tuyo', 'Básico'];

/** Colores rápidos para personalizar cada estilo. */
export const COSMETIC_COLORS = [
	'#ff7ab8',
	'#ff4d6d',
	'#ffd76a',
	'#7cff4d',
	'#4dd0ff',
	'#a78bfa',
	'#ff8a3d',
	'#f5f3ff',
];

export interface OverlayInfo {
	id: string;
	name: string;
	description: string;
	color: string;
	usesImage?: boolean;
}

/**
 * Overlays del perfil: se reproducen al abrir el perfil y van a tono con la decoración
 * del avatar.
 */
export const PROFILE_OVERLAYS: OverlayInfo[] = [
	{id: 'none', name: 'Sin overlay', description: 'El perfil se abre limpio.', color: '#ffffff'},
	{
		id: 'hearts',
		name: 'Lluvia de corazones',
		description: 'Corazones que suben con un brillo rosado.',
		color: '#ff7ab8',
	},
	{
		id: 'arcane',
		name: 'Energía arcana',
		description: 'Chispas mágicas y un halo violeta.',
		color: '#a78bfa',
	},
	{
		id: 'poison',
		name: 'Nube tóxica',
		description: 'Burbujas de veneno subiendo lentamente.',
		color: '#7cff4d',
	},
	{
		id: 'celestial',
		name: 'Polvo de estrellas',
		description: 'Estrellitas y destellos dorados.',
		color: '#ffd76a',
	},
	{
		id: 'custom',
		name: 'Mi imagen cayendo',
		description: 'Tu PNG cae sobre el perfil, tipo nieve.',
		color: '#ffffff',
		usesImage: true,
	},
];
