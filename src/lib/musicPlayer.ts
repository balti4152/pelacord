import {routeMediaOutput} from '@/lib/sounds';

/**
 * Reproductor LOCAL de la Jam.
 *
 * Cada uno reproduce el mismo tema en su máquina; qué suena, en qué segundo y si está pausado lo
 * sincroniza la Jam por la malla (el estado), no el audio.
 *
 * Por qué NO se manda el audio por WebRTC (como antes): con una sola fuente, cada cambio de host
 * cortaba la música para TODOS durante los 2-4 segundos que el nuevo host tardaba en resolver el
 * audio (yt-dlp). Con el audio local, que alguien se mueva de canal o que cambie el host no toca
 * la música de nadie.
 *
 * Acá no hay AudioContext: como el audio ya no viaja por la red, alcanza con un <audio> normal.
 */

let audio: HTMLAudioElement | null = null;
/** Volumen y silencio actuales: se aplican en el momento, sin reiniciar la reproducción. */
let volume = 0.8;
let muted = false;
let outputDeviceId = 'default';

/** El elemento de audio que está sonando (null si no hay nada). */
export function currentMusicAudio(): HTMLAudioElement | null {
	return audio;
}

/** Volumen (0 a 1) y silencio de MI música. */
export function setMusicOutput(nextVolume: number, nextMuted: boolean, nextDeviceId: string): void {
	volume = Math.min(1, Math.max(0, nextVolume));
	muted = nextMuted;
	if (audio) {
		audio.volume = muted ? 0 : volume;
		if (outputDeviceId !== nextDeviceId) void routeMediaOutput(audio, nextDeviceId);
	}
	outputDeviceId = nextDeviceId;
}

export function seekMusic(element: HTMLAudioElement, seconds: number): void {
	if (element.readyState < 1) return;
	const target = Number.isFinite(element.duration) ? Math.min(seconds, element.duration) : seconds;
	if (Math.abs(target - element.currentTime) > 0.35) element.currentTime = Math.max(0, target);
}

export function loadMusic(url: string, options: {
	signal: AbortSignal;
	onReady: (element: HTMLAudioElement) => void;
	onEnded: () => void;
	onError: () => void;
}): void {
	if (options.signal.aborted) return;
	stopMusic();
	const element = new Audio();
	audio = element;
	element.preload = 'auto';
	element.volume = muted ? 0 : volume;
	options.signal.addEventListener('abort', () => { if (audio === element) stopMusic(); }, {once: true});
	element.addEventListener('loadedmetadata', () => {
		if (audio === element) options.onReady(element);
	}, {once: true});
	element.addEventListener('ended', () => {
		if (audio === element) options.onEnded();
	});
	element.addEventListener('error', () => {
		if (audio === element) options.onError();
	});
	void routeMediaOutput(element, outputDeviceId).then(() => {
		if (audio === element) element.src = url;
	});
}

/** Corta la reproducción. */
export function stopMusic(): void {
	const element = audio;
	if (!element) return;
	audio = null;
	try {
		element.pause();
		element.removeAttribute('src');
		element.load();
	} catch {
		// se ignora: puede estar ya cerrado
	}
}
