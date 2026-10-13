/** Acciones que se pueden disparar con un atajo global. */
export type HotkeyAction = 'mute' | 'deafen' | 'shareScreen' | 'shareFocused';

export interface HotkeyInfo {
	action: HotkeyAction;
	label: string;
	description: string;
}

export const HOTKEYS: HotkeyInfo[] = [
	{
		action: 'mute',
		label: 'Silenciar micrófono',
		description: 'Alterna tu micrófono desde cualquier programa.',
	},
	{
		action: 'deafen',
		label: 'Ensordecer',
		description: 'Alterna el audio de la llamada.',
	},
	{
		action: 'shareScreen',
		label: 'Compartir pantalla',
		description: 'Abre el selector de pantalla.',
	},
	{
		action: 'shareFocused',
		label: 'Compartir la ventana enfocada',
		description: 'Transmite el programa que tenías adelante, sin abrir el selector.',
	},
];

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
	mute: 'Control+Shift+M',
	deafen: 'Control+Shift+D',
	shareScreen: 'Control+Shift+S',
	shareFocused: 'Control+Shift+F',
};

/** Nombres de teclas que Electron espera. */
const NAMED_KEYS: Record<string, string> = {
	' ': 'Space',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	Enter: 'Return',
	Escape: 'Escape',
	Tab: 'Tab',
	Backspace: 'Backspace',
	Delete: 'Delete',
	Home: 'Home',
	End: 'End',
	PageUp: 'PageUp',
	PageDown: 'PageDown',
	'+': 'Plus',
	'-': 'Minus',
};

/**
 * Convierte lo que apretó el usuario al formato de Electron ("Control+Shift+M").
 * Devuelve null si sólo apretó modificadores o ninguna tecla: un atajo global sin
 * modificador se comería el teclado de todo el sistema.
 */
export function eventToAccelerator(event: KeyboardEvent): string | null {
	const modifiers: string[] = [];
	if (event.ctrlKey) modifiers.push('Control');
	if (event.altKey) modifiers.push('Alt');
	if (event.shiftKey) modifiers.push('Shift');
	if (event.metaKey) modifiers.push('Super');
	if (modifiers.length === 0) return null;
	const key = event.key;
	if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
	const name = NAMED_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
	return [...modifiers, name].join('+');
}

/** Texto lindo para mostrar: "Ctrl + Shift + M". */
export function formatAccelerator(accelerator?: string): string {
	if (!accelerator) return 'Sin asignar';
	return accelerator.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ');
}
