/**
 * Audio espacial del mundo 3D: la voz de cada uno sale desde donde está su personaje.
 *
 * Mientras estás en el mundo (y en la llamada), cada voz pasa por un PannerNode con HRTF: cerca se
 * escucha fuerte, lejos más bajo, y de izquierda/derecha según dónde esté respecto de tu personaje.
 * Quien está en otra sala del mundo (o no entró al mundo) se sigue escuchando normal: la llamada no
 * se corta por moverte de sala.
 *
 * Chromium necesita que el stream WebRTC esté enganchado a un <audio> para que fluya hacia WebAudio:
 * por eso el <audio> sigue existiendo (mudo) y el sonido real sale por acá.
 */
import {useSyncExternalStore} from 'react';

interface VoiceNode {
	stream: MediaStream;
	source: MediaStreamAudioSourceNode;
	panner: PannerNode;
	gain: GainNode;
	volume: number;
}

export interface Listener {
	x: number;
	z: number;
	/** Hacia dónde mira (radianes, 0 = +Z). */
	ry: number;
}

export type VoicePlace = {x: number; z: number} | 'flat' | 'muted' | null;

class SpatialVoices {
	private ctx: AudioContext | null = null;
	private nodes = new Map<string, VoiceNode>();
	private active = false;
	private sinkId = 'default';
	private listeners = new Set<() => void>();
	/**
	 * Dónde está cada uno respecto de mí:
	 *  - {x, z}: en mi misma sala, con audio 3D (sale desde su personaje).
	 *  - 'flat': en mi sala, pero con el audio 3D apagado (se escucha normal).
	 *  - 'muted': está en OTRO lugar del mundo → no se escucha (cada lugar es una sala aparte).
	 *  - null: no está en el mundo (en la parte 2D) → se escucha normal.
	 */
	private positions: Record<string, VoicePlace> = {};

	isActive(): boolean {
		return this.active;
	}

	subscribe(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	setActive(on: boolean): void {
		if (on === this.active) return;
		this.active = on;
		if (!on) {
			for (const id of [...this.nodes.keys()]) this.drop(id);
		} else {
			this.context();
		}
		for (const listener of this.listeners) listener();
	}

	private context(): AudioContext {
		if (!this.ctx) {
			this.ctx = new AudioContext({latencyHint: 'interactive'});
			void this.applySink();
		}
		void this.ctx.resume().catch(() => {});
		return this.ctx;
	}

	private async applySink(): Promise<void> {
		const ctx = this.ctx as (AudioContext & {setSinkId?: (id: string) => Promise<void>}) | null;
		if (!ctx?.setSinkId) return;
		await ctx.setSinkId(this.sinkId === 'default' ? '' : this.sinkId).catch(() => {});
	}

	setSink(id: string): void {
		if (id === this.sinkId) return;
		this.sinkId = id || 'default';
		void this.applySink();
	}

	/** Conecta/desconecta las voces que hay ahora. `volume` ya incluye el volumen por persona. */
	sync(voices: Array<{peerId: string; stream: MediaStream; volume: number}>, deafened: boolean): void {
		if (!this.active) return;
		const ctx = this.context();
		const wanted = new Set(voices.map((v) => v.peerId));
		for (const id of [...this.nodes.keys()]) if (!wanted.has(id)) this.drop(id);
		for (const voice of voices) {
			let node = this.nodes.get(voice.peerId);
			if (node && node.stream !== voice.stream) {
				this.drop(voice.peerId);
				node = undefined;
			}
			if (!node) {
				const source = ctx.createMediaStreamSource(voice.stream);
				const panner = new PannerNode(ctx, {
					panningModel: 'HRTF',
					distanceModel: 'inverse',
					refDistance: 1.4,
					maxDistance: 30,
					rolloffFactor: 1.3,
				});
				const gain = ctx.createGain();
				source.connect(panner).connect(gain).connect(ctx.destination);
				node = {stream: voice.stream, source, panner, gain, volume: voice.volume};
				this.nodes.set(voice.peerId, node);
			}
			node.volume = deafened ? 0 : voice.volume;
		}
		this.place();
	}

	/** Actualiza dónde estoy yo y dónde está cada uno (se llama en cada cuadro del mundo). */
	update(listener: Listener, positions: Record<string, VoicePlace>): void {
		this.positions = positions;
		if (!this.active || !this.ctx) return;
		const l = this.ctx.listener;
		const t = this.ctx.currentTime;
		const fx = Math.sin(listener.ry);
		const fz = Math.cos(listener.ry);
		if (l.positionX) {
			l.positionX.setTargetAtTime(listener.x, t, 0.05);
			l.positionY.setTargetAtTime(1.0, t, 0.05);
			l.positionZ.setTargetAtTime(listener.z, t, 0.05);
			l.forwardX.setTargetAtTime(fx, t, 0.05);
			l.forwardY.setTargetAtTime(0, t, 0.05);
			l.forwardZ.setTargetAtTime(fz, t, 0.05);
			l.upX.setTargetAtTime(0, t, 0.05);
			l.upY.setTargetAtTime(1, t, 0.05);
			l.upZ.setTargetAtTime(0, t, 0.05);
		} else {
			l.setPosition(listener.x, 1, listener.z);
			l.setOrientation(fx, 0, fz, 0, 1, 0);
		}
		this.place(listener);
	}

	private place(listener?: Listener): void {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		for (const [id, node] of this.nodes) {
			const pos = this.positions[id];
			// En otro lugar del mundo: silencio (con un fundido cortito para que no haga "click").
			node.gain.gain.setTargetAtTime(pos === 'muted' ? 0 : node.volume, t, 0.08);
			if (pos && typeof pos === 'object') {
				node.panner.panningModel = 'HRTF';
				node.panner.distanceModel = 'inverse';
				node.panner.positionX.setTargetAtTime(pos.x, t, 0.06);
				node.panner.positionY.setTargetAtTime(1.0, t, 0.06);
				node.panner.positionZ.setTargetAtTime(pos.z, t, 0.06);
			} else {
				// No está en mi sala: se escucha "normal" (pegado a mí, sin atenuar).
				const at = listener ?? {x: 0, z: 0, ry: 0};
				node.panner.panningModel = 'equalpower';
				node.panner.distanceModel = 'linear';
				node.panner.positionX.setTargetAtTime(at.x, t, 0.06);
				node.panner.positionY.setTargetAtTime(1.0, t, 0.06);
				node.panner.positionZ.setTargetAtTime(at.z + 0.01, t, 0.06);
			}
		}
	}

	private drop(id: string): void {
		const node = this.nodes.get(id);
		if (!node) return;
		node.source.disconnect();
		node.panner.disconnect();
		node.gain.disconnect();
		this.nodes.delete(id);
	}
}

export const spatialVoices = new SpatialVoices();

export function useSpatialActive(): boolean {
	return useSyncExternalStore((cb) => spatialVoices.subscribe(cb), () => spatialVoices.isActive());
}
