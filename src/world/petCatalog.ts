export const PETS = {
	nuez: {name: 'Nuez', description: 'Curioso y movedizo. Suele andar por la entrada de la plaza.', tone: '#eebc8a'},
	brote: {name: 'Brote', description: 'Una tortuguita con un caparazón de musgo y flores.', tone: '#c9d9a0'},
	bruma: {name: 'Bruma', description: 'El zorro de cola esponjosa que merodea cerca de la fuente.', tone: '#c9b5ea'},
} as const;

export type PetId = keyof typeof PETS;

export function isPetId(id: unknown): id is PetId {
	return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PETS, id);
}
