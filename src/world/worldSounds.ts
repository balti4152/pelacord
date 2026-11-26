import {getOutputVolume, routeMediaOutput, subscribeOutputVolume} from '@/lib/sounds';
import type {RoomId} from '@/world/core';

const ENABLED_KEY = 'pelacord.world.sounds';
const ASSET_PATH = 'sounds/world/';
const MAX_EFFECTS = 7;

interface Cue {
	files: readonly string[];
	gain: number;
	gap?: number;
	pitch?: number;
	offset?: number;
}

const CUES = {
	select: {files: ['Button_Pressed.wav'], gain: .27, gap: 85},
	highlight: {files: ['Highlight.wav'], gain: .25, gap: 95},
	menuOpen: {files: ['Menu_Open.wav'], gain: .28, gap: 100},
	menuClose: {files: ['Menu_Close.wav'], gain: .24, gap: 100},
	confirm: {files: ['Confirm.wav'], gain: .50},
	cancel: {files: ['Cancel.wav'], gain: .30},
	purchase: {files: ['Purchase.wav'], gain: .55, gap: 200},
	sell: {files: ['Sell.wav'], gain: .55, gap: 200},
	coins: {files: ['Currency.wav'], gain: .47, gap: 350},
	reward: {files: ['Success.wav'], gain: .43, gap: 450},
	notice: {files: ['Unlock.wav'], gain: .45, gap: 350},
	error: {files: ['Warning.wav'], gain: .38, gap: 240},
	locked: {files: ['Lock.wav'], gain: .30, gap: 260},
	dialogue: {files: ['Dialogue_Expression.wav'], gain: .35, gap: 180},
	door: {files: ['door.ogg'], gain: .32, gap: 200},
	fabric: {files: ['fabric.ogg'], gain: .31, gap: 140},
	throw: {files: ['throw.ogg'], gain: .32, gap: 150},
	place: {files: ['place.ogg'], gain: .33, gap: 110},
	dealCards: {files: ['card-bundle.wav'], gain: .28},
	drawCard: {files: ['card-draw-1.ogg', 'card-draw-2.ogg'], gain: .31, gap: 150},
	playCard: {files: ['card-play-1.ogg'], gain: .32, gap: 120, offset: .105},
	flipCard: {files: ['card-flip.ogg'], gain: .37, gap: 120, pitch: .045},
	tile: {files: ['tile-1.ogg', 'tile-2.ogg'], gain: .38, gap: 105, pitch: .045},
	dice: {files: ['dice.ogg'], gain: .34, gap: 190},
	splash: {files: ['splash.ogg'], gain: .45, gap: 190},
	bite: {files: ['bite.ogg'], gain: .45, gap: 270},
	catch: {files: ['catch.ogg'], gain: .44, gap: 190},
	chip: {files: ['chip.ogg'], gain: .32, gap: 115},
	roulette: {files: ['roulette.ogg'], gain: .28, gap: 350},
	till: {files: ['garden-till.ogg'], gain: .3, gap: 125},
	plant: {files: ['garden-plant.ogg'], gain: .26, gap: 160},
	harvest: {files: ['garden-harvest.ogg'], gain: .28, gap: 200},
	water: {files: ['garden-water.ogg'], gain: .32, gap: 170},
	slapHit: {files: ['slap-hit.ogg'], gain: .42, gap: 120},
	tileBreak: {files: ['tile-break.ogg'], gain: .3, gap: 70, pitch: .08},
} satisfies Record<string, Cue>;

type CueName = keyof typeof CUES;
type Clip = {audio: HTMLAudioElement; level: number};

class WorldSounds {
	private active = false;
	private clips = new Map<string, HTMLAudioElement>();
	private playing = new Map<HTMLAudioElement, Clip>();
	private last = new Map<CueName, {at: number; index: number}>();
	private room: RoomId | null = null;
	private ambient: Clip | null = null;
	private outputDevice = 'default';
	enabled = this.readEnabled();

	constructor() {
		subscribeOutputVolume(() => {
			for (const clip of this.playing.values()) this.applyVolume(clip);
			if (this.ambient) this.applyVolume(this.ambient);
		});
	}

	private readEnabled(): boolean {
		try {
			return localStorage.getItem(ENABLED_KEY) !== '0';
		} catch {
			return true;
		}
	}

	setEnabled(on: boolean): void {
		this.enabled = on;
		try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch { /* almacenamiento no disponible */ }
		if (on) this.syncAmbient();
		else this.stop();
	}

	setActive(on: boolean): void {
		if (this.active === on) return;
		this.active = on;
		if (on) {
			if (this.enabled) {
				for (const key of ['menuOpen', 'select', 'purchase', 'dealCards', 'playCard'] as const) {
					for (const file of CUES[key].files) this.clip(file);
				}
			}
			this.syncAmbient();
		} else {
			this.stop();
		}
	}

	setOutputDevice(device: string): void {
		if (this.outputDevice === device) return;
		this.outputDevice = device;
		for (const audio of this.clips.values()) void routeMediaOutput(audio, device);
	}

	enter(room: RoomId): void {
		if (this.room === room) return;
		// Sólo hay puerta si se entra o se sale de un lugar cerrado (el campamento, el puerto, la
		// Arena y el patio son al aire libre: ahí no suena).
		const outdoor = (r: RoomId) => r === 'city' || r === 'campfire' || r === 'port' || r === 'arena' || r.startsWith('yard:');
		if (this.room !== null && !(outdoor(this.room) && outdoor(room))) this.play('door');
		this.room = room;
		this.syncAmbient();
	}

	leave(): void {
		this.room = null;
		this.syncAmbient();
	}

	play(name: CueName, strength = 1): void {
		if (!this.active || !this.enabled || getOutputVolume() === 0) return;
		const cue: Cue = CUES[name];
		const now = performance.now();
		const previous = this.last.get(name);
		if (previous && now - previous.at < (cue.gap ?? 110)) return;
		const index = ((previous?.index ?? -1) + 1) % cue.files.length;
		this.last.set(name, {at: now, index});
		const audio = this.clip(cue.files[index]);
		if (this.playing.size >= MAX_EFFECTS && !this.playing.has(audio)) {
			const earliest = this.playing.keys().next().value;
			if (earliest) {
				earliest.pause();
				this.playing.delete(earliest);
			}
		}
		const clip = {audio, level: cue.gain * strength};
		this.playing.set(audio, clip);
		audio.currentTime = cue.offset ?? 0;
		audio.playbackRate = 1 + (Math.random() * 2 - 1) * (cue.pitch ?? 0);
		this.applyVolume(clip);
		void audio.play().catch(() => {
			if (this.playing.get(audio) === clip) this.playing.delete(audio);
		});
	}

	private clip(file: string): HTMLAudioElement {
		let audio = this.clips.get(file);
		if (!audio) {
			audio = new Audio(ASSET_PATH + file);
			audio.preload = 'auto';
			audio.preservesPitch = false;
			audio.onended = () => this.playing.delete(audio!);
			this.clips.set(file, audio);
			if (this.outputDevice !== 'default') void routeMediaOutput(audio, this.outputDevice);
		}
		return audio;
	}

	private applyVolume({audio, level}: Clip): void {
		audio.volume = Math.min(1, Math.max(0, level * getOutputVolume()));
	}

	private syncAmbient(): void {
		this.ambient?.audio.pause();
		this.ambient = null;
		if (!this.active || !this.enabled) return;
		if (this.room !== 'campfire') return;
		const audio = this.clip('fire.ogg');
		audio.loop = true;
		this.ambient = {audio, level: .21};
		this.applyVolume(this.ambient);
		void audio.play().catch(() => {});
	}

	private stop(): void {
		for (const audio of this.playing.keys()) audio.pause();
		this.playing.clear();
		this.ambient?.audio.pause();
		this.ambient = null;
	}
}

export const worldSounds = new WorldSounds();
