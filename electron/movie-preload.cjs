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
	// Por si el reproductor vuelve a habilitarlo al entrar o salir de pantalla completa. Si la
	// persona pidió los subtítulos a mano (nuestro botón), se dejan los clics habilitados un rato.
	setInterval(() => {
		if (!document.body || window.__pelacordClicsPermitidos) return;
		if (document.body.style.pointerEvents !== 'none') {
			document.body.style.pointerEvents = 'none';
		}
	}, 2000);
}

/**
 * Esconde la barra del reproductor: usamos la nuestra.
 *
 * Ojo: el botón de subtítulos vive ADENTRO de esa barra. Se esconde igual porque igual lo podemos
 * apretar por código (`element.click()` anda aunque esté oculto), y así los subtítulos se activan
 * sin que se vea nada de su interfaz.
 */
const CSS_OCULTA_BARRA = `
	media-control-bar,
	.notflix-controlbar { display: none !important; }
`;

function ocultaBarra() {
	if (!document.head || document.getElementById('pelacord-movie-css')) return;
	const style = document.createElement('style');
	style.id = 'pelacord-movie-css';
	style.textContent = CSS_OCULTA_BARRA;
	document.head.appendChild(style);
}

document.addEventListener('DOMContentLoaded', () => {
	bloqueaClics();
	ocultaBarra();
});
window.addEventListener('load', () => {
	bloqueaClics();
	ocultaBarra();
});
bloqueaClics();
ocultaBarra();

// Los subtítulos en español los pone el proceso principal (pelacord:movie-subtitles) porque el
// reproductor sólo responde a clics REALES de mouse; acá solo se reenvían eventos y comandos.
