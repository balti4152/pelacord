/**
 * Reproductor del host: reproduce el audio y lo convierte en un MediaStream.
 *
 * Ese stream es el que viaja por la malla (WebRTC) para que los demás lo escuchen como si fuera
 * un participante más. Nada de descargar el archivo: se toca directo desde la URL del stream,
 * así no hay que esperar a que termine de bajar para empezar a escuchar.
 *
 * Por qué se hace así: un `<audio>` normal no se puede mandar por WebRTC. Hay que pasar su salida
 * por un AudioContext y de ahí sacar un MediaStream con `createMediaStreamDestination`.
 */

let audio: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let destination: MediaStreamAudioDestinationNode | null = null;
let source: MediaElementAudioSourceNode | null = null;

/** El stream que hay que mandar a los peers (null si no hay nada sonando). */
export function currentMusicStream(): MediaStream | null {
	return destination?.stream ?? null;
}

/** El elemento de audio (para leer posición, duración, pausar, etc.). */
export function currentMusicAudio(): HTMLAudioElement | null {
	return audio;
}

export interface MusicStreamHandle {
	stream: MediaStream;
	audio: HTMLAudioElement;
	/** Segundos que lleva reproducidos. */
	position(): number;
	/** Duración total en segundos (0 si todavía no se sabe). */
	duration(): number;
	/** Se dispara cuando termina la pista. */
	onEnded(callback: () => void): void;
	/** Se dispara cuando ya se puede saber la duración. */
	onReady(callback: () => void): void;
}

/**
 * Arranca la reproducción de una URL de audio y devuelve el stream para mandar.
 * Si ya había algo sonando, se corta antes.
 */
export async function startMusicStream(url: string, startAtSeconds = 0): Promise<MusicStreamHandle> {
	stopMusicStream();

	const element = new Audio();
	element.crossOrigin = 'anonymous';
	element.preload = 'auto';
	element.src = url;

	// El AudioContext tiene que crearse después de un gesto del usuario o el navegador lo deja
	// suspendido: se reanuda por las dudas.
	const audioContext = new AudioContext();
	if (audioContext.state === 'suspended') await audioContext.resume();
	const streamDestination = audioContext.createMediaStreamDestination();
	const mediaSource = audioContext.createMediaElementSource(element);
	mediaSource.connect(streamDestination);
	// Se conecta también a los parlantes: el host también tiene que escuchar lo que pone.
	mediaSource.connect(audioContext.destination);

	audio = element;
	context = audioContext;
	destination = streamDestination;
	source = mediaSource;

	if (startAtSeconds > 0) {
		// Para retomar en el segundo exacto (traspaso de host o entrar a mitad de la pista).
		await new Promise<void>((resolve) => {
			const onLoaded = () => {
				element.currentTime = startAtSeconds;
				resolve();
			};
			if (element.readyState >= 1) onLoaded();
			else element.addEventListener('loadedmetadata', onLoaded, {once: true});
			setTimeout(resolve, 4000);
		});
	}

	await element.play();

	return {
		stream: streamDestination.stream,
		audio: element,
		position: () => element.currentTime,
		duration: () => (Number.isFinite(element.duration) ? element.duration : 0),
		onEnded: (callback) => element.addEventListener('ended', callback, {once: true}),
		onReady: (callback) => element.addEventListener('loadedmetadata', callback, {once: true}),
	};
}

/** Corta la reproducción y libera el AudioContext. */
export function stopMusicStream(): void {
	try {
		audio?.pause();
		if (audio) audio.src = '';
		source?.disconnect();
		destination?.disconnect();
		void context?.close();
	} catch {
		// se ignora: puede estar ya cerrado
	}
	audio = null;
	context = null;
	destination = null;
	source = null;
}

/** Cambia el volumen del host (0 a 1). No afecta a lo que reciben los demás. */
export function setHostVolume(value: number): void {
	if (audio) audio.volume = Math.min(1, Math.max(0, value));
}
