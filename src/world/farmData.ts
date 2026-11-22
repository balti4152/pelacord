export const CROPS = {
	potato: {name: 'Papa', model: 'Potato', pack: 5, price: 18, sell: 9, duration: 75_000},
	carrot: {name: 'Zanahoria', model: 'Carrot', pack: 4, price: 28, sell: 16, duration: 105_000},
	berry: {name: 'Frutilla', model: 'Berry', pack: 4, price: 42, sell: 25, duration: 145_000},
} as const;

export type Crop = keyof typeof CROPS;
export type FarmTool = 'hoe' | 'can';
export type FarmAction = 'walk' | FarmTool | 'plant' | 'harvest' | 'sprinkler';
export type Plot = {crop?: Crop; wateredAt?: number; sprinkler?: boolean};
export type FarmLand = {level: number; plots: Record<string, Plot>};
export type Farm = {land: FarmLand; seeds: Record<Crop, number>; harvest: Record<Crop, number>; sprinklers: number; tools: Record<FarmTool, number>};

export const LOTS = [
	{left: -1, right: 1, front: -1, back: 0, price: 0},
	{left: -2, right: 2, front: -2, back: 1, price: 100},
	{left: -3, right: 3, front: -2, back: 2, price: 220},
	{left: -4, right: 4, front: -3, back: 3, price: 430},
	{left: -5, right: 5, front: -4, back: 4, price: 760},
	{left: -6, right: 6, front: -5, back: 5, price: 1250},
] as const;

export const SPRINKLER_PRICE = 135;
export const UPGRADES = [0, 160, 380] as const;
export const cropIds = Object.keys(CROPS) as Crop[];
export const isCrop = (v: unknown): v is Crop => typeof v === 'string' && Object.hasOwn(CROPS, v);
export const plotKey = (x: number, z: number): string => x + ':' + z;
export const plotPosition = (key: string): [number, number] => key.split(':').map(Number) as [number, number];

export function inLot(level: number, x: number, z: number): boolean {
	const lot = LOTS[level];
	return Boolean(lot && Number.isInteger(x) && Number.isInteger(z) && x >= lot.left && x <= lot.right && z >= lot.front && z <= lot.back);
}

export function makeFarm(): Farm {
	return {land: {level: 0, plots: {}}, seeds: {potato: 5, carrot: 0, berry: 0}, harvest: {potato: 0, carrot: 0, berry: 0}, sprinklers: 0, tools: {hoe: 1, can: 1}};
}

const count = (v: unknown, fallback = 0): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : fallback;

export function readLand(value: Partial<FarmLand> | null | undefined): FarmLand {
	const level = Math.min(LOTS.length - 1, count(value?.level));
	const plots: FarmLand['plots'] = {};
	for (const [key, plot] of Object.entries(value?.plots ?? {})) {
		if (!/^-?\d+:-?\d+$/.test(key) || !plot || typeof plot !== 'object') continue;
		const [x, z] = plotPosition(key);
		if (!inLot(level, x, z)) continue;
		plots[plotKey(x, z)] = plot.sprinkler === true ? {sprinkler: true} : isCrop(plot.crop) ? {
			crop: plot.crop,
			wateredAt: count(plot.wateredAt) || undefined,
		} : {};
	}
	return {level, plots};
}

export function readFarm(value?: Partial<Farm>): Farm {
	const farm = makeFarm();
	farm.land = readLand(value?.land);
	for (const crop of cropIds) {
		farm.seeds[crop] = count(value?.seeds?.[crop], farm.seeds[crop]);
		farm.harvest[crop] = count(value?.harvest?.[crop]);
	}
	farm.sprinklers = count(value?.sprinklers);
	for (const tool of ['hoe', 'can'] as const) farm.tools[tool] = Math.max(1, Math.min(UPGRADES.length, count(value?.tools?.[tool], 1)));
	return farm;
}

export function growth(plot: Plot, now: number): number {
	return plot.crop && plot.wateredAt ? Math.max(0, Math.min(1, (now - plot.wateredAt) / CROPS[plot.crop].duration)) : 0;
}

function sprinklerNear(plots: FarmLand['plots'], x: number, z: number): boolean {
	for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
		if (plots[plotKey(x + dx, z + dz)]?.sprinkler) return true;
	}
	return false;
}

export type TendResult = {farm?: Farm; notice?: string; sound?: 'till' | 'place' | 'water' | 'plant' | 'harvest'};
export function tend(farm: Farm, action: Exclude<FarmAction, 'walk'>, x: number, z: number, seed: Crop, now = Date.now()): TendResult {
	if (!inLot(farm.land.level, x, z)) return {notice: 'Ampliá el terreno para cultivar ahí.'};
	const key = plotKey(x, z);
	const current = farm.land.plots[key];
	const plots = {...farm.land.plots};
	const next = {...farm, land: {...farm.land, plots}};
	if (action === 'plant') {
		if (!current || current.crop || current.sprinkler) return {notice: 'Prepará una parcela libre con la azada.'};
		if (!farm.seeds[seed]) return {notice: 'Te quedaste sin semillas de ese cultivo.'};
		next.seeds = {...farm.seeds, [seed]: farm.seeds[seed] - 1};
		plots[key] = {crop: seed, wateredAt: sprinklerNear(plots, x, z) ? now : undefined};
		return {farm: next, sound: 'plant'};
	}
	if (action === 'harvest') {
		const crop = current?.crop;
		if (!crop) return {notice: 'Acá no hay un cultivo.'};
		if (!current.wateredAt) return {notice: 'Regalo para que empiece a crecer.'};
		if (growth(current, now) < 1) return {notice: 'Todavía está creciendo.'};
		next.harvest = {...farm.harvest, [crop]: farm.harvest[crop] + 1};
		plots[key] = {};
		return {farm: next, sound: 'harvest', notice: 'Cosechaste ' + CROPS[crop].name.toLowerCase() + '.'};
	}
	if (action === 'sprinkler') {
		if (current?.sprinkler) {
			plots[key] = {};
			next.sprinklers++;
			return {farm: next, sound: 'place', notice: 'Aspersor guardado.'};
		}
		if (!farm.sprinklers) return {notice: 'Comprá un aspersor en la tienda.'};
		if (current?.crop) return {notice: 'Elegí un lugar sin cultivo.'};
		next.sprinklers--;
		plots[key] = {sprinkler: true};
		for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
			const nearby = plotKey(x + dx, z + dz);
			const plot = plots[nearby];
			if (plot?.crop && !plot.wateredAt) plots[nearby] = {...plot, wateredAt: now};
		}
		return {farm: next, sound: 'water', notice: 'Riega las ocho parcelas de alrededor.'};
	}

	const radius = farm.tools[action] - 1;
	let changed = false;
	for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
		if (Math.abs(dx) + Math.abs(dz) > radius || !inLot(farm.land.level, x + dx, z + dz)) continue;
		const target = plotKey(x + dx, z + dz);
		const plot = plots[target];
		if (action === 'hoe' && !plot) {
			plots[target] = {};
			changed = true;
		}
		if (action === 'can' && plot?.crop && !plot.wateredAt) {
			plots[target] = {...plot, wateredAt: now};
			changed = true;
		}
	}
	if (!changed) return {notice: action === 'hoe' ? 'Esa tierra ya está preparada.' : 'Elegí un cultivo que todavía necesite agua.'};
	return {farm: next, sound: action === 'hoe' ? 'till' : 'water'};
}

