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
		description: 'Alterna la transmisión del monitor principal.',
	},
	{
		action: 'shareFocused',
		label: 'Compartir la ventana enfocada',
		description: 'Alterna la transmisión del programa que tenías adelante.',
	},
];

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
	mute: 'Control+Shift+M',
	deafen: 'Control+Shift+D',
	shareScreen: 'Control+Shift+S',
	shareFocused: 'Control+Shift+F',
};

/**
 * Nombres de teclas que Electron acepta.
 *
 * Ojo con los signos: van con el carácter literal ('-', ',', '.'). Los nombres "lindos" como
 * 'Minus', 'Comma' o 'Period' NO existen y Electron tira una excepción al registrarlos.
 * La única excepción es '+', que en el formato de Electron es el separador de teclas y por eso
 * se escribe 'Plus'.
 */
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
	Insert: 'Insert',
	Home: 'Home',
	End: 'End',
	PageUp: 'PageUp',
	PageDown: 'PageDown',
	PrintScreen: 'PrintScreen',
	ScrollLock: 'ScrollLock',
	'+': 'Plus',
	'-': '-',
};

/**
 * Teclado numérico: se identifica por la POSICIÓN física (event.code), no por el carácter.
 *
 * Esto importa porque el '+' de la fila de arriba (en un teclado US es Shift+=) no se puede
 * registrar como atajo global, mientras que el '+' del teclado numérico sí ('Numadd').
 */
const CODE_KEYS: Record<string, string> = {
	NumpadAdd: 'Numadd',
	NumpadSubtract: 'Numsub',
	NumpadMultiply: 'Nummult',
	NumpadDivide: 'Numdiv',
	NumpadDecimal: 'Numdec',
	NumpadEnter: 'Return',
};
for (let digit = 0; digit <= 9; digit += 1) CODE_KEYS[`Numpad${digit}`] = `num${digit}`;

/** Nombres técnicos que se muestran con un texto más amigable. */
const DISPLAY_NAMES: Record<string, string> = {
	Plus: '+',
	Numadd: '+ (num)',
	Numsub: '- (num)',
	Nummult: '* (num)',
	Numdiv: '/ (num)',
	Numdec: '. (num)',
	Space: 'Espacio',
	Return: 'Enter',
	Escape: 'Esc',
	PrintScreen: 'Impr Pant',
	ScrollLock: 'Bloq Despl',
};

/**
 * Convierte lo que apretó el usuario al formato de Electron ("Control+Shift+M").
 *
 * No hay restricciones: cualquier tecla vale, sola o con modificadores (el usuario decide).
 * Devuelve null sólo si apretó modificadores sueltos (Ctrl, Alt, Shift…), porque ahí todavía
 * no hay atajo.
 */
export function eventToAccelerator(event: KeyboardEvent): string | null {
	const modifiers: string[] = [];
	if (event.ctrlKey) modifiers.push('Control');
	if (event.altKey) modifiers.push('Alt');
	if (event.shiftKey) modifiers.push('Shift');
	if (event.metaKey) modifiers.push('Super');
	const key = event.key;
	if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
	// El teclado numérico se resuelve primero: su '+' es 'Numadd' y no el '+' de la fila de arriba.
	const name = CODE_KEYS[event.code] ?? NAMED_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
	return [...modifiers, name].join('+');
}

/** Texto lindo para mostrar: "Ctrl + Shift + M", "+", "+ (num)". */
export function formatAccelerator(accelerator?: string): string {
	if (!accelerator) return 'Sin asignar';
	return accelerator
		.split('+')
		.map((part) => DISPLAY_NAMES[part] ?? (part === 'Control' ? 'Ctrl' : part))
		.join(' + ');
}
