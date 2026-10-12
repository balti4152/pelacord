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
		id: 'inferno',
		name: 'Crimson Inferno',
		description: 'Marco ardiente con brasas que suben.',
		category: 'Fuego',
		color: '#ff4d3d',
	},
	{
		id: 'void',
		name: 'Void / Cosmic',
		description: 'Nebulosa oscura con estrellas girando.',
		category: 'Mágico',
		color: '#8b5cf6',
	},
	{
		id: 'frost',
		name: 'Frost Guardian',
		description: 'Borde cristalino con copos de nieve.',
		category: 'Hielo',
		color: '#7fe3ff',
	},
	{
		id: 'royal',
		name: 'Royal Gold',
		description: 'Anillo ornamentado con gemas que brillan.',
		category: 'Lujo',
		color: '#ffd76a',
	},
	{
		id: 'nature',
		name: 'Nature Spirit',
		description: 'Hojas flotando y luz de bosque.',
		category: 'Naturaleza',
		color: '#6ee7a8',
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

export const DECORATION_CATEGORIES = ['Todas', 'Amor', 'Mágico', 'Veneno', 'Fuego', 'Hielo', 'Lujo', 'Naturaleza', 'Tuyo', 'Básico'];

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
		id: 'inferno',
		name: 'Brasas',
		description: 'Brasas encendidas que suben.',
		color: '#ff4d3d',
	},
	{
		id: 'void',
		name: 'Cosmos',
		description: 'Estrellas frías en un cielo profundo.',
		color: '#8b5cf6',
	},
	{
		id: 'frost',
		name: 'Nevada',
		description: 'Copos de nieve cayendo.',
		color: '#7fe3ff',
	},
	{
		id: 'royal',
		name: 'Destellos dorados',
		description: 'Brillos dorados que titilan.',
		color: '#ffd76a',
	},
	{
		id: 'nature',
		name: 'Luciérnagas',
		description: 'Luces verdes que flotan en el bosque.',
		color: '#6ee7a8',
	},
	{
		id: 'custom',
		name: 'Mi imagen cayendo',
		description: 'Tu PNG cae sobre el perfil, tipo nieve.',
		color: '#ffffff',
		usesImage: true,
	},
];
