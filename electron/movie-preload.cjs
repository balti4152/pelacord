// Puente del reproductor de películas.
//
// Este archivo corre DENTRO de la página del embed (CineSrc). Es lo que hace que podamos usar
// nuestro propio reproductor, y cumple tres cosas:
//
//  1. Reenvía a la app los eventos del reproductor (play, pause, timeupdate, duración…).
//  2. Recibe de la app los comandos (play, pause, seek, volumen) y se los pasa al reproductor.
//  3. Deja el video SIN CLICS (pointer-events: none) para que NUNCA se abra publicidad ni se salga
//     de la película: los clics los recibe nuestro overlay, no el embed. Los comandos siguen
//     funcionando igual, porque son llamadas del código (no clics reales).
//
// Además, elige los subtítulos en español: el embed los tiene, pero hay que pedirlos.

const {ipcRenderer} = require('electron');

const CINESRC = 'https://cinesrc.st';

/** Manda un comando al reproductor (el formato que documenta CineSrc). */
function command(name, args = []) {
	try {
		window.postMessage({type: 'cinesrc:command', command: name, args}, CINESRC);
	} catch {
		// si todavía no cargó, se ignora
	}
}

// 1) Eventos del reproductor -> app.
window.addEventListener('message', (event) => {
	const data = event?.data;
	if (!data || typeof data !== 'object') return;
	const type = String(data.type || '');
	if (!type.startsWith('cinesrc:')) return;
	ipcRenderer.sendToHost('pelacord:movie-event', {
		type,
		currentTime: typeof data.currentTime === 'number' ? data.currentTime : undefined,
		duration: typeof data.duration === 'number' ? data.duration : undefined,
		command: data.command,
		result: data.result,
	});
});

// 2) Comandos de la app -> reproductor.
ipcRenderer.on('pelacord:movie-command', (_event, message) => {
	const name = message?.command;
	if (!name) return;
	command(String(name), Array.isArray(message.args) ? message.args : []);
});

/** Deja el cuerpo sin recibir clics (los clics van a nuestro overlay, nunca al embed). */
function bloqueaClics() {
	if (!document.body) return;
	document.body.style.pointerEvents = 'none';
	document.body.style.userSelect = 'none';
	// Por si el reproductor vuelve a habilitarlo al entrar o salir de pantalla completa.
	setInterval(() => {
		if (document.body && document.body.style.pointerEvents !== 'none') {
			document.body.style.pointerEvents = 'none';
		}
	}, 2000);
}

document.addEventListener('DOMContentLoaded', bloqueaClics);
window.addEventListener('load', bloqueaClics);
bloqueaClics();

/**
 * Elige los subtítulos en español.
 *
 * Se abre el panel de subtítulos del reproductor, se elige "Spanish" y, si aparece un submenú con
 * las pistas, se elige la primera. Se hace con llamadas del código (click()), así funciona aunque
 * el video no reciba clics.
 */
async function subtitulosEnEspanol() {
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const clickeable = (el) => el && typeof el.click === 'function';
	for (let intento = 0; intento < 6; intento++) {
		const boton = [...document.querySelectorAll('button')].find((el) =>
			/subtitle settings/i.test(el.getAttribute('aria-label') || el.title || ''),
		);
		if (!clickeable(boton)) {
			await wait(1000);
			continue;
		}
		boton.click();
		await wait(1200);
		const opciones = [...document.querySelectorAll('button, [role="option"], [role="menuitem"], li')];
		const spanish = opciones.find((el) => /^spanish(\s|$)/i.test((el.textContent || '').trim()));
		if (!clickeable(spanish)) {
			await wait(1200);
			continue;
		}
		spanish.click();
		await wait(1200);
		// Si Spanish abre un submenú con pistas ("Default", "Spanish 1", …), se elige la primera.
		const pistas = [...document.querySelectorAll('button, [role="option"], [role="menuitem"]')].filter((el) => {
			const texto = (el.textContent || '').trim();
			return texto.length > 0 && texto.length < 24 && /^(default|forzad|spanish\s*\d*|1|2)$/i.test(texto) && !/^spanish$/i.test(texto);
		});
		if (pistas.length > 0) pistas[0].click();
		return true;
	}
	return false;
}

ipcRenderer.on('pelacord:movie-subtitles-es', () => {
	void subtitulosEnEspanol().then((ok) => ipcRenderer.sendToHost('pelacord:movie-subtitles', {ok}));
});
