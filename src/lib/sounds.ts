import deafen from '@/assets/sounds/deafen.mp3';
import join from '@/assets/sounds/join.mp3';
import leave from '@/assets/sounds/leave.mp3';
import message from '@/assets/sounds/message.mp3';
import mute from '@/assets/sounds/mute.mp3';
import streamStart from '@/assets/sounds/stream-start.mp3';
import streamStop from '@/assets/sounds/stream-stop.mp3';
import undeafen from '@/assets/sounds/undeafen.mp3';
import unmute from '@/assets/sounds/unmute.mp3';
import userMoved from '@/assets/sounds/user-moved.mp3';
import userLeft from '@/assets/sounds/user-left.wav';

export type SoundName =
	| 'join'
	| 'leave'
	| 'mute'
	| 'unmute'
	| 'deafen'
	| 'undeafen'
	| 'message'
	| 'userJoined'
	| 'userLeft'
	| 'streamStart'
	| 'streamStop';

const SOURCES: Record<SoundName, string> = {
	join,
	leave,
	mute,
	unmute,
	deafen,
	undeafen,
	message,
	userJoined: userMoved,
	userLeft,
	streamStart,
	streamStop,
};

const cache: Partial<Record<SoundName, HTMLAudioElement>> = {};
let enabled = true;
let outputVolume = 1;
const volumeListeners = new Set<() => void>();

export function setSoundsEnabled(value: boolean): void {
	enabled = value;
}

export function areSoundsEnabled(): boolean {
	return enabled;
}

export function getOutputVolume(): number {
	return outputVolume;
}

/** Volumen general de salida de la app (0 a 1). No depende del mezclador de Windows. */
export function setOutputVolume(value: number): void {
	outputVolume = Math.min(1, Math.max(0, value));
	for (const listener of volumeListeners) listener();
}

export function subscribeOutputVolume(callback: () => void): () => void {
	volumeListeners.add(callback);
	return () => {
		volumeListeners.delete(callback);
	};
}

/** Reproduce un sonido de la interfaz. No rompe nada si el navegador lo bloquea. */
export function playSound(name: SoundName, volume = 0.5): void {
	if (!enabled) return;
	try {
		let audio = cache[name];
		if (!audio) {
			audio = new Audio(SOURCES[name]);
			audio.preload = 'auto';
			cache[name] = audio;
		}
		audio.volume = Math.min(1, Math.max(0, volume * outputVolume));
		audio.currentTime = 0;
		void audio.play().catch(() => {});
	} catch {
		// sin audio disponible: se ignora
	}
}
