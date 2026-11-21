import {Color} from 'three';

export function furnitureColor(hex: string, light: boolean): Color {
	const color = new Color(hex);
	if (light) color.offsetHSL(0, 0, .18);
	return color;
}
