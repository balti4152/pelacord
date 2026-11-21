/**
 * El parlante de la tele: reproduce la música de la tele de MI sala (no la Jam), con el volumen
 * según qué tan cerca estoy de la pantalla. Si salgo de la sala, se calla.
 */
import {getDesktopTransport} from '@/lib/desktop';
import {currentTrack, type TvState, tvPosition} from '@/world/tv';

const DRIFT_MS = 1600;

class TvSpeaker {
	private audio: HTMLAudioElement | null = null;
	private trackKey = '';
	private loading = '';
	private volume = 0;
	private master = 0.85;
	/** Para avisar que el tema terminó (pasa al siguiente el que corresponda). */
	onEnded: (() => void) | null = null;
	/** El progreso real (para dibujar la tele y los controles). */
	positionMs = 0;
	ready = false;

	private element(): HTMLAudioElement {
		if (!this.audio) {
			const audio = new Audio();
			audio.preload = 'auto';
			audio.addEventListener('ended', () => this.onEnded?.());
			audio.addEventListener('timeupdate', () => {
				this.positionMs = audio.currentTime * 1000;
			});
			this.audio = audio;
		}
		return this.audio;
	}

	/** Pone en el parlante lo que tiene la tele (o lo calla con `null`). */
	sync(tv: TvState | null): void {
		const track = currentTrack(tv);
		if (!tv || !track) {
			this.stop();
			return;
		}
		const key = `${tv.room}|${tv.index}|${track.id}`;
		const audio = this.element();
		if (key !== this.trackKey) {
			this.trackKey = key;
			this.ready = false;
			audio.pause();
			if (this.loading === key) return;
			this.loading = key;
			const transport = getDesktopTransport();
			if (!transport) return;
			void transport.getAudioUrl(track.url || track.id).then((url) => {
				if (this.trackKey !== key || !url) return;
				audio.src = url;
				audio.volume = this.volume * this.master;
				audio.onloadedmetadata = () => {
					if (this.trackKey !== key) return;
					this.ready = true;
					this.align(tv);
				};
			}).finally(() => {
				if (this.loading === key) this.loading = '';
			});
			return;
		}
		if (this.ready) this.align(tv);
	}

	private align(tv: TvState): void {
		const audio = this.audio;
		if (!audio) return;
		const expected = tvPosition(tv);
		if (tv.paused) {
			if (!audio.paused) audio.pause();
			if (Math.abs(audio.currentTime * 1000 - expected) > 400) audio.currentTime = expected / 1000;
			return;
		}
		if (Math.abs(audio.currentTime * 1000 - expected) > DRIFT_MS) audio.currentTime = expected / 1000;
		if (audio.paused) void audio.play().catch(() => {});
	}

	setVolume(volume: number): void {
		this.volume = volume;
		if (this.audio) this.audio.volume = Math.min(1, Math.max(0, volume * this.master));
	}

	setMaster(master: number): void {
		this.master = master;
		this.setVolume(this.volume);
	}

	stop(): void {
		this.trackKey = '';
		this.ready = false;
		if (this.audio) {
			this.audio.pause();
			this.audio.removeAttribute('src');
			this.audio.load();
		}
	}
}

export const tvSpeaker = new TvSpeaker();
