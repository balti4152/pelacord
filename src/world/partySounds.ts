/**
 * Sonidos de la Arena hechos con Web Audio (sin archivos): el "bip" de la bomba y la explosión.
 * Volumen moderado y con límite (nada de sonidos trabados re fuertes).
 */
import {getOutputVolume} from '@/lib/sounds';

let ctx: AudioContext | null = null;
let lastTick = 0;

function audio(): AudioContext | null {
	if (typeof AudioContext === 'undefined') return null;
	ctx ??= new AudioContext({latencyHint: 'interactive'});
	if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
	return ctx;
}

function level(base: number): number {
	return base * Math.min(1, Math.max(0, getOutputVolume()));
}

/** El tic de la mecha (agudo, cortito). Como mucho uno cada 70 ms. */
export function bombTick(urgent: boolean): void {
	const c = audio();
	if (!c) return;
	const now = performance.now();
	if (now - lastTick < 70) return;
	lastTick = now;
	const osc = c.createOscillator();
	const gain = c.createGain();
	osc.type = 'square';
	osc.frequency.value = urgent ? 1180 : 880;
	gain.gain.setValueAtTime(level(0.06), c.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.08);
	osc.connect(gain).connect(c.destination);
	osc.start();
	osc.stop(c.currentTime + 0.09);
}

/** ¡BUM! Ruido filtrado que cae + un golpe grave. */
export function bombBoom(): void {
	const c = audio();
	if (!c) return;
	const length = Math.floor(c.sampleRate * 0.9);
	const buffer = c.createBuffer(1, length, c.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
	const noise = c.createBufferSource();
	noise.buffer = buffer;
	const filter = c.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.setValueAtTime(1800, c.currentTime);
	filter.frequency.exponentialRampToValueAtTime(120, c.currentTime + 0.8);
	const gain = c.createGain();
	gain.gain.value = level(0.32);
	noise.connect(filter).connect(gain).connect(c.destination);
	noise.start();
	const thump = c.createOscillator();
	const tg = c.createGain();
	thump.type = 'sine';
	thump.frequency.setValueAtTime(120, c.currentTime);
	thump.frequency.exponentialRampToValueAtTime(38, c.currentTime + 0.45);
	tg.gain.setValueAtTime(level(0.4), c.currentTime);
	tg.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.5);
	thump.connect(tg).connect(c.destination);
	thump.start();
	thump.stop(c.currentTime + 0.5);
}

/** "Pop" suave al pasar la bomba. */
export function bombPass(): void {
	const c = audio();
	if (!c) return;
	const osc = c.createOscillator();
	const gain = c.createGain();
	osc.type = 'triangle';
	osc.frequency.setValueAtTime(420, c.currentTime);
	osc.frequency.exponentialRampToValueAtTime(900, c.currentTime + 0.12);
	gain.gain.setValueAtTime(level(0.08), c.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.15);
	osc.connect(gain).connect(c.destination);
	osc.start();
	osc.stop(c.currentTime + 0.16);
}
