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

/** El video real de la página. */
function elVideo() {
	return document.querySelector('video');
}

/** Le contesta a la app (mismo formato que el reproductor, así nuestro lado no cambia). */
function responder(command, result) {
	ipcRenderer.sendToHost('pelacord:movie-event', {type: 'cinesrc:response', command, result});
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
		paused: typeof data.paused === 'boolean' ? data.paused : undefined,
		command: data.command,
		result: data.result,
	});
});

/**
 * 2) Comandos de la app -> video.
 *
 * OJO: se aplican DIRECTO sobre el `<video>` en vez de usar el puente del reproductor. Su puente
 * tiene un problema real: al contestar los "getters" intenta mandar una Promise por postMessage y
 * tira `DataCloneError`, así que la respuesta nunca llega (por eso el botón de play/pausa no sabía
 * en qué estado estaba). Manejar el video de la página es más simple y no depende de ellos.
 */
ipcRenderer.on('pelacord:movie-command', (_event, message) => {
	const name = String(message?.command || '');
	const args = Array.isArray(message?.args) ? message.args : [];
	const video = elVideo();
	if (video) {
		try {
			if (name === 'play') void video.play();
			else if (name === 'pause') video.pause();
			else if (name === 'seek') video.currentTime = Math.max(0, Number(args[0]) || 0);
			else if (name === 'setVolume') video.volume = Math.min(1, Math.max(0, Number(args[0] ?? 1)));
			else if (name === 'setMuted') video.muted = Boolean(args[0]);
			else if (name === 'getCurrentTime') responder('getCurrentTime', video.currentTime);
			else if (name === 'getDuration') responder('getDuration', video.duration || 0);
			else if (name === 'getPaused') responder('getPaused', video.paused);
		} catch {
			// si el video todavía no está, se ignora
		}
	}
	// Igual se le avisa al reproductor, para que su interfaz quede en el mismo estado.
	command(name, args);
});

/**
 * 3) Los eventos del video de verdad -> app.
 *
 * El reproductor no manda los eventos cuando se lo carga directo en un webview (sólo postea si está
 * dentro de un iframe), así que se engancha el `<video>` de la página: play, pausa y tiempo salen
 * de ahí y son confiables.
 */
function engancharVideo() {
	const video = elVideo();
	if (!video || video.dataset.pelacordEnganchado === '1') return;
	video.dataset.pelacordEnganchado = '1';
	const avisar = (type) => () => {
		try {
			ipcRenderer.sendToHost('pelacord:movie-event', {
				type,
				currentTime: video.currentTime,
				duration: video.duration || 0,
				paused: video.paused,
			});
		} catch {
			// se ignora
		}
	};
	video.addEventListener('play', avisar('cinesrc:play'));
	video.addEventListener('pause', avisar('cinesrc:pause'));
	video.addEventListener('timeupdate', avisar('cinesrc:timeupdate'));
	video.addEventListener('durationchange', avisar('cinesrc:loadedmetadata'));
	video.addEventListener('ended', avisar('cinesrc:ended'));
	setInterval(avisar('cinesrc:timeupdate'), 1000);
}

setInterval(engancharVideo, 1200);
document.addEventListener('DOMContentLoaded', engancharVideo);
window.addEventListener('load', engancharVideo);

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
