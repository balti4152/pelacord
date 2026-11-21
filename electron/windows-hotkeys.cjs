const MODIFIERS = new Map([
	['shift', 1], ['control', 2], ['ctrl', 2], ['commandorcontrol', 2], ['cmdorctrl', 2],
	['alt', 4], ['option', 4], ['super', 8], ['meta', 8],
]);

const NAMED_KEYS = {
	backspace: 0x08, tab: 0x09, return: 0x0d, enter: 0x0d, pause: 0x13, capslock: 0x14,
	escape: 0x1b, space: 0x20, pageup: 0x21, pagedown: 0x22, end: 0x23, home: 0x24,
	left: 0x25, up: 0x26, right: 0x27, down: 0x28, printscreen: 0x2c, insert: 0x2d, delete: 0x2e,
	nummult: 0x6a, numadd: 0x6b, numsub: 0x6d, numdec: 0x6e, numdiv: 0x6f, numlock: 0x90, scrolllock: 0x91,
	audiovolumemute: 0xad, audiovolumedown: 0xae, audiovolumeup: 0xaf,
	mediatracknext: 0xb0, mediatrackprevious: 0xb1, mediastop: 0xb2, mediaplaypause: 0xb3,
};

function windowsKeyboard() {
	const user32 = require('koffi').load('user32.dll');
	const bind = (name, result, args) => user32.func('__stdcall', name, result, args);
	const getKeyState = bind('GetAsyncKeyState', 'int16_t', ['int']);
	const foreground = bind('GetForegroundWindow', 'void *', []);
	const threadFor = bind('GetWindowThreadProcessId', 'uint32_t', ['void *', 'void *']);
	const layoutFor = bind('GetKeyboardLayout', 'uintptr_t', ['uint32_t']);
	const scan = bind('VkKeyScanExW', 'int16_t', ['uint16_t', 'uintptr_t']);
	return {
		isDown: (key) => (getKeyState(key) & 0x8000) !== 0,
		layout: () => {
			const window = foreground();
			return layoutFor(window ? threadFor(window, null) : 0);
		},
		scan: (character, layout) => scan(character.charCodeAt(0), layout),
	};
}

function compile(binding, keyboard, layout) {
	const parts = binding.accelerator.trim().toLowerCase().split('+');
	const key = parts.pop();
	let modifiers = 0;
	for (const part of parts) {
		if (!MODIFIERS.has(part)) return null;
		modifiers |= MODIFIERS.get(part);
	}
	let code = Object.hasOwn(NAMED_KEYS, key) ? NAMED_KEYS[key] : 0;
	if (/^f([1-9]|1\d|2[0-4])$/.test(key)) code = 0x6f + Number(key.slice(1));
	else if (/^num[0-9]$/.test(key)) code = 0x60 + Number(key.slice(3));
	else if (/^[a-z0-9]$/.test(key)) code = key.toUpperCase().charCodeAt(0);
	else if (key.length === 1 || key === 'plus') {
		const scanned = keyboard.scan(key === 'plus' ? '+' : key, layout);
		if (scanned === -1 || (scanned & ~0x7ff)) return null;
		code = scanned & 0xff;
		modifiers |= scanned >> 8;
	}
	return code ? {code, modifiers, action: binding.action} : null;
}

function createWindowsHotkeys(fire, keyboard = windowsKeyboard()) {
	let bindings = [];
	let compiled = [];
	let layout;
	let timer;
	let paused = false;
	const pressed = new Set();

	function mapBindings(nextLayout) {
		layout = nextLayout;
		const invalid = [];
		const used = new Set();
		compiled = [];
		pressed.clear();
		for (const binding of bindings) {
			const shortcut = compile(binding, keyboard, layout);
			const key = shortcut ? `${shortcut.modifiers}:${shortcut.code}` : '';
			if (!shortcut || used.has(key)) {
				invalid.push(binding);
				continue;
			}
			used.add(key);
			compiled.push(shortcut);
			if (keyboard.isDown(shortcut.code)) pressed.add(shortcut.code);
		}
		return invalid;
	}

	function poll() {
		const nextLayout = keyboard.layout();
		if (nextLayout !== layout) mapBindings(nextLayout);
		const actual = (keyboard.isDown(0x10) ? 1 : 0) | (keyboard.isDown(0x11) ? 2 : 0) |
			(keyboard.isDown(0x12) ? 4 : 0) | (keyboard.isDown(0x5b) || keyboard.isDown(0x5c) ? 8 : 0);
		const down = new Set();
		for (const {code, modifiers, action} of compiled) {
			if (!keyboard.isDown(code)) continue;
			down.add(code);
			if (!paused && !pressed.has(code) && modifiers === actual) fire(action);
		}
		pressed.clear();
		for (const code of down) pressed.add(code);
	}

	return {
		setBindings(next) {
			clearInterval(timer);
			bindings = next;
			const invalid = mapBindings(keyboard.layout());
			if (bindings.length) timer = setInterval(poll, 12).unref();
			return invalid;
		},
		setPaused(value) { paused = value; },
		stop() { clearInterval(timer); },
	};
}

module.exports = {createWindowsHotkeys};
