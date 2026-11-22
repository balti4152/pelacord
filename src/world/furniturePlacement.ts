import type {FurnitureSupport, PlacedFurniture} from '@/world/core';

export interface FurnitureSurface {
	height: number;
	halfX: number;
	halfZ: number;
	round?: boolean;
	occupied?: ReadonlyArray<{x: number; z: number; radius: number}>;
}

// Las tapas son las partes planas de los modelos, descontando el borde redondeado.
const SURFACES: Record<string, FurnitureSurface> = {
	coffee_table: {height: .46, halfX: .524, halfZ: .524, round: true},
	side_table: {height: .53, halfX: .254, halfZ: .254, round: true},
	atelier_mosaic: {height: .60, halfX: .409, halfZ: .409, round: true},
	atelier_cabinet: {height: .831, halfX: .552, halfZ: .252, occupied: [
		{x: -.244, z: -.02, radius: .166},
		{x: .295, z: -.057, radius: .140},
	]},
};

// Radio de la base que apoya; hojas, pantallas y otras partes superiores pueden sobresalir un poco.
const BASE_RADIUS: Record<string, number> = {
	table_lamp: .133, plant: .158,
	atelier_radio: .333, atelier_ceramic_cat: .300, atelier_coral: .286,
	atelier_sailboat: .264, atelier_hourglass: .249, atelier_globe: .230,
	atelier_bird: .244, atelier_bonsai: .331, atelier_hydrangea: .226,
	atelier_orchid: .193, atelier_succulents: .344, atelier_monstera: .259,
	atelier_harbor_lamp: .230, atelier_scallop_lamp: .196,
};

export interface FurniturePose {x: number; y: number; z: number; rot: number}

export function furnitureSurface(id: string): FurnitureSurface | undefined {
	return Object.hasOwn(SURFACES, id) ? SURFACES[id] : undefined;
}

export function tabletopRadius(id: string): number | undefined {
	return Object.hasOwn(BASE_RADIUS, id) ? BASE_RADIUS[id] : undefined;
}

export function surfaceContains(surface: FurnitureSurface, x: number, z: number): boolean {
	return surface.round ? Math.hypot(x, z) <= surface.halfX : Math.abs(x) <= surface.halfX && Math.abs(z) <= surface.halfZ;
}

export function tabletopPosition(surface: FurnitureSurface, radius: number, x: number, z: number): {x: number; z: number} | null {
	const maxX = surface.halfX - radius;
	const maxZ = surface.halfZ - radius;
	if (maxX < 0 || maxZ < 0) return null;
	if (surface.round) {
		const distance = Math.hypot(x, z);
		const factor = distance > maxX ? maxX / distance : 1;
		return {x: x * factor, z: z * factor};
	}
	const point = {x: Math.max(-maxX, Math.min(maxX, x)), z: Math.max(-maxZ, Math.min(maxZ, z))};
	return surface.occupied?.some((prop) => Math.hypot(point.x - prop.x, point.z - prop.z) < radius + prop.radius) ? null : point;
}

export function relativeToFurniture(x: number, z: number, table: PlacedFurniture): {x: number; z: number} {
	const dx = x - table.x!;
	const dz = z - table.z!;
	const cos = Math.cos(table.rot);
	const sin = Math.sin(table.rot);
	return {x: dx * cos - dz * sin, z: dx * sin + dz * cos};
}

export function furniturePose(item: PlacedFurniture, table?: PlacedFurniture): FurniturePose {
	const floor = {x: item.x ?? 0, y: 0, z: item.z ?? 0, rot: item.rot};
	const support = item.support;
	if (!support || !table || typeof table.x !== 'number' || typeof table.z !== 'number') return floor;
	const surface = furnitureSurface(table.id);
	const radius = tabletopRadius(item.id);
	if (!surface || radius === undefined || ![table.x, table.z, table.rot, support.x, support.z, support.rot].every(Number.isFinite)) return floor;
	const point = tabletopPosition(surface, radius, support.x, support.z);
	if (!point) return floor;
	const cos = Math.cos(table.rot);
	const sin = Math.sin(table.rot);
	return {x: table.x + point.x * cos + point.z * sin, y: surface.height, z: table.z - point.x * sin + point.z * cos, rot: table.rot + support.rot};
}

export function editFurniture(items: PlacedFurniture[], item: PlacedFurniture, change: Partial<PlacedFurniture>): PlacedFurniture[] {
	const fresh = items.find((row) => row.uid === item.uid);
	const next = {...(fresh ?? item), ...change};
	let support: FurnitureSupport | undefined = next.support;
	if (next.x === null || next.z === null) support = undefined;
	const supportUid = support?.uid;
	const table = supportUid ? items.find((row) => row.uid === supportUid) : undefined;
	if (support && table && change.rot !== undefined && !Object.hasOwn(change, 'support')) support = {...support, rot: change.rot - table.rot};
	next.support = support;
	if (support) {
		const {x, y, z, rot} = furniturePose(next, table);
		if (y === 0) next.support = undefined;
		else Object.assign(next, {x, z, rot});
	}
	if (!fresh) return [...items, next];
	return items.map((row) => {
		if (row.uid === next.uid) return next;
		if (row.support?.uid !== next.uid) return row;
		if (next.x === null || next.z === null) return {...row, support: undefined};
		const {x, z, rot} = furniturePose(row, next);
		return {...row, x, z, rot};
	});
}

