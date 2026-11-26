// Genera el recorrido de las pistas del karting (puntos cada ~1 m, con altura).
// Lo usan el juego (src/world/kart/tracks.json) y el script de Blender que arma los modelos.
//   node tools/kart/tracks.mjs
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';

export const HALF = 6.5;
export const OFFROAD = 4.5;
/** Las pistas se dibujan chicas y se agrandan. */
const SCALE = 1.35;

const TRACKS = [
	{
		id: 'caramelo', name: 'Valle Caramelo', theme: 'candy',
		pts: [[0, 0, 0], [45, -6, 0], [82, 10, 1], [94, 46, 3.5], [72, 78, 5.5], [36, 74, 4.5], [10, 96, 2.5], [-22, 120, 1], [-62, 110, 0], [-84, 72, 0], [-66, 44, 2], [-82, 12, 1], [-46, -16, 0]],
	},
	{
		id: 'playa', name: 'Playa Gelatina', theme: 'beach',
		pts: [[0, 0, 0], [60, 0, 0], [96, 20, 0.5], [102, 60, 2.5], [68, 84, 6], [30, 66, 8], [0, 84, 6], [-16, 122, 3], [-56, 134, 1], [-92, 102, 0], [-84, 52, 0], [-50, 18, 0]],
	},
	{
		id: 'nevado', name: 'Pico Nevado', theme: 'snow',
		pts: [[0, 0, 0], [50, -8, 2], [86, -42, 6], [122, -20, 10], [118, 30, 12], [80, 46, 9], [82, 92, 6], [42, 114, 4], [-6, 92, 3], [-32, 50, 5], [-70, 56, 3], [-94, 18, 1], [-64, -18, 0]],
	},
];

const out = TRACKS.map((t) => {
	const curve = new THREE.CatmullRomCurve3(t.pts.map(([x, z, h]) => new THREE.Vector3(x * SCALE, h, z * SCALE)), true, 'centripetal');
	const n = Math.round(curve.getLength());
	const pts = curve.getSpacedPoints(n).slice(0, n);
	// Altura suavizada (sin escalones) y redondeada.
	const ys = pts.map((_, i) => {
		let s = 0;
		for (let k = -6; k <= 6; k++) s += pts[(i + k + n) % n].y;
		return s / 13;
	});
	let minSep = Infinity;
	for (let i = 0; i < n; i++) for (let j = i + 40; j < n; j++) {
		if (n - (j - i) < 40) continue;
		minSep = Math.min(minSep, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
	}
	let minR = Infinity;
	let minAt = 0;
	for (let i = 0; i < n; i++) {
		const a = pts[(i - 4 + n) % n], b = pts[i], c = pts[(i + 4) % n];
		const ab = Math.hypot(a.x - b.x, a.z - b.z), bc = Math.hypot(b.x - c.x, b.z - c.z), ac = Math.hypot(a.x - c.x, a.z - c.z);
		const s = (ab + bc + ac) / 2;
		const area = Math.sqrt(Math.max(1e-9, s * (s - ab) * (s - bc) * (s - ac)));
		const r = (ab * bc * ac) / (4 * area);
		if (r < minR) {
			minR = r;
			minAt = i;
		}
	}
	console.log(`${t.id}: ${n} m, separación mínima ${minSep.toFixed(1)}, radio mínimo ${minR.toFixed(1)} en (${pts[minAt].x.toFixed(0)}, ${pts[minAt].z.toFixed(0)})`);
	// Lo que va en la pista (el juego y Blender leen lo mismo): filas de cajas, flechas de turbo y monedas.
	const at = (f) => Math.floor(f * n) % n;
	const boxes = [0.17, 0.45, 0.72].map(at);
	const pads = [[0.07, 2.6], [0.33, -2.6], [0.58, 0], [0.86, 2.6]].map(([f, side]) => [at(f), side]);
	const coins = [];
	for (const [f, side] of [[0.1, -3], [0.25, 3], [0.4, 0], [0.52, -3], [0.66, 3], [0.8, -2], [0.93, 2]]) for (let k = 0; k < 5; k++) coins.push([(at(f) + k * 3) % n, side]);
	return {id: t.id, name: t.name, theme: t.theme, half: HALF, offroad: OFFROAD, boxes, pads, coins, pts: pts.map((p, i) => [+p.x.toFixed(2), +ys[i].toFixed(2), +p.z.toFixed(2)])};
});

writeFileSync(new URL('../../src/world/kart/tracks.json', import.meta.url), JSON.stringify(out));
console.log('ok');
