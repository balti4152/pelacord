export const MOUNT_IDS = ['mount_bike', 'mount_car', 'mount_broom'] as const;

export type MountId = typeof MOUNT_IDS[number];
export type MountColors = Partial<Record<MountId, string>>;
export interface MountSelection {
	id: MountId;
	color?: string;
}

export const MOUNT_COLOR_LABEL: Record<MountId, string> = {
	mount_bike: 'Color del marco',
	mount_car: 'Color de la carrocería',
	mount_broom: 'Color de partículas y estela',
};

export function isMountId(value: unknown): value is MountId {
	return MOUNT_IDS.some((id) => id === value);
}

export function readMountColor(value: unknown): string | undefined {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

export function readMountColors(value: unknown): MountColors {
	const colors: MountColors = {};
	if (!value || typeof value !== 'object') return colors;
	for (const id of MOUNT_IDS) {
		const color = readMountColor((value as Record<string, unknown>)[id]);
		if (color) colors[id] = color;
	}
	return colors;
}

export function selectedMount(id: MountId | null, colors: MountColors): MountSelection | null {
	return id ? {id, color: colors[id]} : null;
}
