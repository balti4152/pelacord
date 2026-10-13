// Genera src/assets/sounds/user-left.wav: el "alguien salió de la llamada".
//
// Es un blip descendente de dos notas, en la misma familia que el sonido de entrada, para que
// suene a Discord sin depender de ningún archivo de terceros.
//
// Uso: node scripts/make-user-left-sound.mjs
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SAMPLE_RATE = 44100;
const DURATION = 0.3;

/** Dos notas descendentes (G5 -> D5), con armónico para que no suene a pitito de microondas. */
const NOTES = [
	{freq: 783.99, start: 0, length: 0.14, gain: 0.5},
	{freq: 587.33, start: 0.11, length: 0.19, gain: 0.45},
];

const ATTACK = 0.008; // 8 ms: evita el "click" al arrancar
const DECAY = 5.5; // caída exponencial

const total = Math.round(SAMPLE_RATE * DURATION);
const samples = new Float32Array(total);

for (const note of NOTES) {
	const from = Math.round(note.start * SAMPLE_RATE);
	const count = Math.round(note.length * SAMPLE_RATE);
	for (let i = 0; i < count && from + i < total; i += 1) {
		const t = i / SAMPLE_RATE;
		const attack = Math.min(1, t / ATTACK);
		const envelope = attack * Math.exp((-DECAY * t) / note.length);
		const phase = 2 * Math.PI * note.freq * t;
		const tone = Math.sin(phase) + 0.25 * Math.sin(2 * phase);
		samples[from + i] += tone * envelope * note.gain;
	}
}

// Normaliza a -1..1 sin recortar.
let peak = 0;
for (const value of samples) peak = Math.max(peak, Math.abs(value));
const scale = peak > 0 ? 0.92 / peak : 1;

const data = Buffer.alloc(total * 2);
for (let i = 0; i < total; i += 1) {
	const value = Math.max(-1, Math.min(1, samples[i] * scale));
	data.writeInt16LE(Math.round(value * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'assets', 'sounds', 'user-left.wav');
mkdirSync(dirname(target), {recursive: true});
writeFileSync(target, Buffer.concat([header, data]));
console.log(`Listo: ${target} (${((header.length + data.length) / 1024).toFixed(1)} KB, ${DURATION}s)`);
