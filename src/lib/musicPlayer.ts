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
let endedCallback: (() => void) | null = null;
/** Volumen y silencio actuales: se aplican en el momento, sin reiniciar la reproducción. */
let volume = 0.8;
let muted = false;

/** El elemento de audio que está sonando (null si no hay nada). */
export function currentMusicAudio(): HTMLAudioElement | null {
	return audio;
}

/** Avisa cuando el tema termina (para saltar al siguiente). */
export function onMusicEnded(callback: (() => void) | null): void {
	endedCallback = callback;
}

/** Volumen (0 a 1) y silencio de MI música. */
export function setMusicOutput(nextVolume: number, nextMuted: boolean): void {
	volume = Math.min(1, Math.max(0, nextVolume));
	muted = nextMuted;
	if (audio) audio.volume = muted ? 0 : volume;
}

/** Espera a que el audio sepa su duración y lo deja en el segundo pedido. */
async function seek(element: HTMLAudioElement, seconds: number): Promise<void> {
	if (seconds <= 0.5) return;
	await new Promise<void>((resolve) => {
		const listo = () => {
			element.currentTime = seconds;
			resolve();
		};
		if (element.readyState >= 1) listo();
		else element.addEventListener('loadedmetadata', listo, {once: true});
		// Si nunca avisa, se sigue igual: el vigilante de sincronía lo corrige después.
		setTimeout(resolve, 4000);
	});
}

/**
 * Arranca la reproducción de una URL de audio desde un segundo puntual.
 * Si ya había algo sonando, se corta antes.
 */
export async function playMusic(url: string, startAtSeconds = 0): Promise<HTMLAudioElement> {
	stopMusic();
	const element = new Audio();
	element.preload = 'auto';
	element.src = url;
	element.volume = muted ? 0 : volume;
	element.addEventListener(
		'ended',
		() => {
			if (audio === element) endedCallback?.();
		},
		{once: true},
	);
	audio = element;
	await seek(element, startAtSeconds);
	await element.play();
	return element;
}

/** Corta la reproducción. */
export function stopMusic(): void {
	const element = audio;
	if (!element) return;
	audio = null;
	try {
		element.pause();
		element.src = '';
	} catch {
		// se ignora: puede estar ya cerrado
	}
}
