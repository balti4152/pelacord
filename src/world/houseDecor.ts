/**
 * Paredes, piso y neones de la casa.
 *
 * - Empapelados y pisos: 20 estilos dibujados con código (rayas, madera, cuadros, ladrillo…), todos
 *   con color a elección. La casa no trae coordenadas de textura: se proyectan según la posición
 *   (las paredes de atrás por X/Y, las de los costados por Z/Y, el piso por X/Z).
 * - Neones: tiras dibujadas sobre una pared (a mano alzada o punto a punto), cada una de su color.
 *   Brillan (emisivo + un halo suave) e iluminan un poquito.
 *
 * Todo viaja en la casa como muebles especiales: 'style:wall:<estilo>', 'style:floor:<estilo>' y
 * 'neon' (con sus puntos en `pts`), así lo ven las visitas sin cambiar la red.
 */
import * as THREE from 'three';
import type {PlacedFurniture} from '@/world/core';

export type StyleKind = 'wall' | 'floor';
export interface HouseStyleDef {
	id: string;
	kind: StyleKind;
	name: string;
	price: number;
	color: string;
}

export const HOUSE_STYLES: HouseStyleDef[] = [
	// Paredes (pintura y empapelados).
	{id: 'paint', kind: 'wall', name: 'Pintura lisa', price: 80, color: '#5c428f'},
	{id: 'stripes', kind: 'wall', name: 'Rayas anchas', price: 160, color: '#e8a0b4'},
	{id: 'pinstripe', kind: 'wall', name: 'Rayitas finas', price: 160, color: '#7fb3d5'},
	{id: 'dots', kind: 'wall', name: 'Lunares', price: 170, color: '#ffd6a5'},
	{id: 'damask', kind: 'wall', name: 'Damasco', price: 240, color: '#8e3b5a'},
	{id: 'flowers', kind: 'wall', name: 'Florcitas', price: 220, color: '#b8e0c8'},
	{id: 'wainscot', kind: 'wall', name: 'Boiserie de madera', price: 260, color: '#9c6236'},
	{id: 'brick', kind: 'wall', name: 'Ladrillo', price: 230, color: '#b5553c'},
	{id: 'chevron', kind: 'wall', name: 'Zigzag', price: 190, color: '#4fb3a9'},
	{id: 'waves', kind: 'wall', name: 'Olas', price: 190, color: '#5d7fd6'},
	{id: 'stars', kind: 'wall', name: 'Estrellitas', price: 210, color: '#2b2d5c'},
	{id: 'plaid', kind: 'wall', name: 'Escocés', price: 210, color: '#c0392b'},
	// Pisos.
	{id: 'planks', kind: 'floor', name: 'Tablas de madera', price: 200, color: '#b07a4a'},
	{id: 'parquet', kind: 'floor', name: 'Parquet espiga', price: 260, color: '#9c6236'},
	{id: 'checker', kind: 'floor', name: 'Damero', price: 220, color: '#2a2a2a'},
	{id: 'tiles', kind: 'floor', name: 'Cerámicos', price: 200, color: '#d9e4ec'},
	{id: 'marble', kind: 'floor', name: 'Mármol', price: 320, color: '#eeeae4'},
	{id: 'carpet', kind: 'floor', name: 'Alfombra', price: 180, color: '#7a4f9e'},
	{id: 'hexagon', kind: 'floor', name: 'Hexágonos', price: 240, color: '#e2b04a'},
	{id: 'terrazzo', kind: 'floor', name: 'Granito', price: 240, color: '#e8dccb'},
];

export const NEON_COLORS = ['#ff4fa8', '#4fd8ff', '#b56bff', '#7dff8a', '#ffd23f', '#ff7a3c', '#ffffff', '#ff3b4f'];
/** Monedas por metro de tira (mínimo una moneda por tramo). */
export const NEON_PRICE_PER_METER = 45;

/** Las paredes de la casa (por dentro). */
export const HOUSE_WALLS = {back: 3.98, left: -4.46, right: 4.47, floor: 0.1, top: 3.05, minZ: -3.9};
export type WallId = 'back' | 'left' | 'right';

// ------------------------------------------------------------- texturas ---

const shade = (hex: string, k: number): string => {
	const c = new THREE.Color(hex);
	const hsl = {h: 0, s: 0, l: 0};
	c.getHSL(hsl);
	c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + k)));
	return '#' + c.getHexString();
};

function drawPattern(id: string, color: string): HTMLCanvasElement {
	const S = 256;
	const cv = document.createElement('canvas');
	cv.width = cv.height = S;
	const g = cv.getContext('2d')!;
	const light = shade(color, 0.12);
	const dark = shade(color, -0.12);
	const darker = shade(color, -0.25);
	g.fillStyle = color;
	g.fillRect(0, 0, S, S);
	const rnd = (() => {
		let seed = 7;
		return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	})();
	switch (id) {
		case 'stripes':
			g.fillStyle = light;
			for (let x = 0; x < S; x += 64) g.fillRect(x, 0, 32, S);
			break;
		case 'pinstripe':
			g.fillStyle = dark;
			for (let x = 0; x < S; x += 21) g.fillRect(x, 0, 3, S);
			break;
		case 'dots':
			g.fillStyle = light;
			for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
				g.beginPath();
				g.arc(32 + x * 64 + (y % 2) * 32, 32 + y * 64, 10, 0, Math.PI * 2);
				g.fill();
			}
			break;
		case 'damask':
			g.fillStyle = dark;
			for (const [cx, cy] of [[64, 64], [192, 192], [192, 64 - 128 + 128], [64, 192]] as const) {
				if ((cx === 64 && cy === 192) || (cx === 192 && cy === 64)) continue;
				g.beginPath();
				g.ellipse(cx, cy, 26, 44, 0, 0, Math.PI * 2);
				g.fill();
				g.beginPath();
				g.ellipse(cx - 30, cy, 12, 26, 0.5, 0, Math.PI * 2);
				g.ellipse(cx + 30, cy, 12, 26, -0.5, 0, Math.PI * 2);
				g.fill();
			}
			g.strokeStyle = light;
			g.lineWidth = 3;
			for (const [cx, cy] of [[64, 64], [192, 192]] as const) {
				g.beginPath();
				g.ellipse(cx, cy, 14, 28, 0, 0, Math.PI * 2);
				g.stroke();
			}
			break;
		case 'flowers':
			for (let i = 0; i < 14; i++) {
				const x = rnd() * S;
				const y = rnd() * S;
				g.fillStyle = i % 2 ? '#ffffff' : light;
				for (let p = 0; p < 5; p++) {
					g.beginPath();
					g.arc(x + Math.cos(p * 1.256) * 8, y + Math.sin(p * 1.256) * 8, 6, 0, Math.PI * 2);
					g.fill();
				}
				g.fillStyle = '#ffd23f';
				g.beginPath();
				g.arc(x, y, 4, 0, Math.PI * 2);
				g.fill();
			}
			break;
		case 'wainscot':
			// Abajo madera con paneles; arriba lisa (la textura cubre 1 m de alto: se repite justo).
			g.fillStyle = shade(color, 0.3);
			g.fillRect(0, 0, S, S * 0.45);
			g.fillStyle = dark;
			g.fillRect(0, S * 0.45, S, 10);
			for (let x = 0; x < S; x += 128) {
				g.strokeStyle = darker;
				g.lineWidth = 6;
				g.strokeRect(x + 16, S * 0.55, 96, S * 0.38);
			}
			break;
		case 'brick':
			g.fillStyle = shade(color, 0.25);
			g.fillRect(0, 0, S, S);
			g.fillStyle = color;
			for (let row = 0; row < 8; row++) for (let col = -1; col < 4; col++) {
				const off = (row % 2) * 32;
				g.fillStyle = [color, dark, light][(row * 3 + col + 9) % 3];
				g.fillRect(col * 64 + off + 3, row * 32 + 3, 58, 26);
			}
			break;
		case 'chevron':
			g.strokeStyle = light;
			g.lineWidth = 14;
			for (let y = -32; y < S + 32; y += 48) {
				g.beginPath();
				for (let x = 0; x <= S; x += 32) g.lineTo(x, y + ((x / 32) % 2 ? 20 : 0));
				g.stroke();
			}
			break;
		case 'waves':
			g.strokeStyle = light;
			g.lineWidth = 8;
			for (let y = 16; y < S; y += 40) {
				g.beginPath();
				for (let x = 0; x <= S; x += 4) g.lineTo(x, y + Math.sin((x / S) * Math.PI * 4) * 10);
				g.stroke();
			}
			break;
		case 'stars':
			g.fillStyle = '#ffe9a8';
			for (let i = 0; i < 22; i++) {
				const x = rnd() * S;
				const y = rnd() * S;
				const r = 3 + rnd() * 5;
				g.beginPath();
				for (let p = 0; p < 10; p++) {
					const a = (p / 10) * Math.PI * 2 - Math.PI / 2;
					const rr = p % 2 ? r * 0.45 : r;
					g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
				}
				g.fill();
			}
			break;
		case 'plaid':
			g.globalAlpha = 0.45;
			g.fillStyle = darker;
			for (let i = 0; i < S; i += 64) {
				g.fillRect(i, 0, 24, S);
				g.fillRect(0, i, S, 24);
			}
			g.fillStyle = '#ffffff';
			g.globalAlpha = 0.35;
			for (let i = 40; i < S; i += 64) {
				g.fillRect(i, 0, 4, S);
				g.fillRect(0, i, S, 4);
			}
			g.globalAlpha = 1;
			break;
		case 'planks':
			for (let row = 0; row < 8; row++) {
				g.fillStyle = [color, light, dark, color][row % 4];
				g.fillRect(0, row * 32, S, 32);
				g.fillStyle = darker;
				g.fillRect(0, row * 32, S, 2);
				g.fillRect(((row * 97) % S), row * 32, 2, 32);
			}
			break;
		case 'parquet':
			for (let y = 0; y < S; y += 32) for (let x = 0; x < S; x += 64) {
				const flip = ((x + y) / 32) % 2;
				g.fillStyle = flip ? light : dark;
				g.save();
				g.translate(x + 32, y + 16);
				g.rotate(flip ? Math.PI / 4 : -Math.PI / 4);
				g.fillRect(-30, -9, 60, 18);
				g.restore();
			}
			break;
		case 'checker':
			g.fillStyle = shade(color, 0.6);
			for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) g.fillRect(x * 64, y * 64, 64, 64);
			break;
		case 'tiles':
			g.fillStyle = dark;
			for (let i = 0; i <= S; i += 64) {
				g.fillRect(i - 2, 0, 4, S);
				g.fillRect(0, i - 2, S, 4);
			}
			break;
		case 'marble':
			g.strokeStyle = shade(color, -0.2);
			g.lineWidth = 2;
			for (let i = 0; i < 9; i++) {
				g.beginPath();
				let x = rnd() * S;
				let y = 0;
				g.moveTo(x, y);
				while (y < S) {
					x += (rnd() - 0.5) * 40;
					y += 20 + rnd() * 20;
					g.lineTo(x, y);
				}
				g.stroke();
			}
			break;
		case 'carpet':
			for (let i = 0; i < 3000; i++) {
				g.fillStyle = rnd() > 0.5 ? light : dark;
				g.fillRect(rnd() * S, rnd() * S, 2, 2);
			}
			break;
		case 'hexagon': {
			const r = 26;
			const h = Math.sqrt(3) * r;
			g.strokeStyle = darker;
			g.lineWidth = 4;
			for (let row = -1; row < S / h + 1; row++) for (let col = -1; col < S / (r * 3) + 1; col++) {
				for (const off of [0, 1]) {
					const cx = col * r * 3 + off * r * 1.5;
					const cy = row * h + off * h / 2;
					g.beginPath();
					for (let p = 0; p < 6; p++) g.lineTo(cx + Math.cos((p * Math.PI) / 3) * r, cy + Math.sin((p * Math.PI) / 3) * r);
					g.closePath();
					g.stroke();
				}
			}
			break;
		}
		case 'terrazzo':
			for (let i = 0; i < 260; i++) {
				g.fillStyle = ['#c9b79c', '#8a7f74', '#f6efe4', '#b99a7a', shade(color, -0.3)][i % 5];
				g.beginPath();
				g.ellipse(rnd() * S, rnd() * S, 2 + rnd() * 6, 2 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
				g.fill();
			}
			break;
		default:
			// Pintura lisa: apenas una textura de rodillo.
			for (let i = 0; i < 1200; i++) {
				g.fillStyle = rnd() > 0.5 ? light : dark;
				g.globalAlpha = 0.08;
				g.fillRect(rnd() * S, rnd() * S, 6, 6);
			}
			g.globalAlpha = 1;
	}
	return cv;
}

/** Vista previa chiquita (para el panel). */
export function stylePreview(id: string, color: string): string {
	return drawPattern(id, color).toDataURL();
}

/** Coordenadas de textura proyectadas por la posición (metros) y la normal. */
function projectUv(geometry: THREE.BufferGeometry, mode: 'wall' | 'floor', meters: number): void {
	const pos = geometry.attributes.position as THREE.BufferAttribute;
	if (!geometry.attributes.normal) geometry.computeVertexNormals();
	const nor = geometry.attributes.normal as THREE.BufferAttribute;
	const uv = new Float32Array(pos.count * 2);
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z = pos.getZ(i);
		if (mode === 'floor') {
			uv[i * 2] = x / meters;
			uv[i * 2 + 1] = z / meters;
		} else {
			const side = Math.abs(nor.getX(i)) > Math.abs(nor.getZ(i));
			uv[i * 2] = (side ? z : x) / meters;
			uv[i * 2 + 1] = y / meters;
		}
	}
	geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// --------------------------------------------------------------- neones ---

export interface NeonStrip {
	color: string;
	/** Puntos en la sala: [x, y, z, x, y, z, …]. */
	pts: number[];
}

export function neonLength(pts: number[]): number {
	let total = 0;
	for (let i = 3; i < pts.length; i += 3) total += Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]);
	return total;
}

export function neonPrice(pts: number[]): number {
	return pts.length < 6 ? 0 : Math.max(5, Math.ceil(neonLength(pts) * NEON_PRICE_PER_METER));
}

let glowTexture: THREE.Texture | null = null;
function glowStrip(): THREE.Texture {
	if (glowTexture) return glowTexture;
	const cv = document.createElement('canvas');
	cv.width = 4;
	cv.height = 64;
	const g = cv.getContext('2d')!;
	const grad = g.createLinearGradient(0, 0, 0, 64);
	grad.addColorStop(0, 'rgba(255,255,255,0)');
	grad.addColorStop(0.5, 'rgba(255,255,255,1)');
	grad.addColorStop(1, 'rgba(255,255,255,0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, 4, 64);
	glowTexture = new THREE.CanvasTexture(cv);
	return glowTexture;
}

/** Normal de la pared donde está la tira (hacia adentro de la casa). */
function wallNormal(points: THREE.Vector3[]): THREE.Vector3 {
	const W = HOUSE_WALLS;
	const p = points[0];
	if (Math.abs(p.z - W.back) < 0.2) return new THREE.Vector3(0, 0, -1);
	if (Math.abs(p.x - W.left) < 0.2) return new THREE.Vector3(1, 0, 0);
	return new THREE.Vector3(-1, 0, 0);
}

/** Franja de luz sobre la pared que sigue la tira (ilumina parejo de punta a punta). */
function wallGlow(points: THREE.Vector3[], color: THREE.Color): THREE.Mesh | null {
	if (points.length < 2) return null;
	const normal = wallNormal(points);
	const half = 0.32;
	const pos: number[] = [];
	const uv: number[] = [];
	const idx: number[] = [];
	for (let i = 0; i < points.length; i++) {
		const prev = points[Math.max(0, i - 1)];
		const next = points[Math.min(points.length - 1, i + 1)];
		const dir = next.clone().sub(prev);
		if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
		const side = new THREE.Vector3().crossVectors(normal, dir.normalize()).normalize().multiplyScalar(half);
		const base = points[i].clone().addScaledVector(normal, -0.012);
		const a = base.clone().add(side);
		const b = base.clone().sub(side);
		pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
		uv.push(0, 0, 0, 1);
		if (i > 0) {
			const k = (i - 1) * 2;
			idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geometry.setIndex(idx);
	const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({map: glowStrip(), color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false}));
	mesh.renderOrder = 2;
	return mesh;
}

/** Arma la tira de neón (tubo que brilla + halo suave). */
export function buildNeon(strip: NeonStrip, preview = false): THREE.Group {
	const group = new THREE.Group();
	group.name = 'Neon';
	const points: THREE.Vector3[] = [];
	for (let i = 0; i + 2 < strip.pts.length; i += 3) points.push(new THREE.Vector3(strip.pts[i], strip.pts[i + 1], strip.pts[i + 2]));
	if (points.length < 2) return group;
	const path = new THREE.CurvePath<THREE.Vector3>();
	for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(points[i - 1], points[i]));
	const segments = Math.min(600, Math.max(8, points.length * 4));
	const color = new THREE.Color(strip.color);
	const tube = new THREE.Mesh(
		new THREE.TubeGeometry(path, segments, 0.017, 8, false),
		new THREE.MeshStandardMaterial({color: color.clone().lerp(new THREE.Color('#ffffff'), 0.2), emissive: color, emissiveIntensity: 1.15, roughness: 0.3, toneMapped: false, transparent: preview, opacity: preview ? 0.75 : 1}),
	);
	const halo = new THREE.Mesh(
		new THREE.TubeGeometry(path, segments, 0.05, 8, false),
		new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}),
	);
	// El reflejo en la pared, a lo largo de TODA la tira (no sólo en el centro): una franja que se
	// desvanece hacia los costados, sumada encima de la pared.
	const glow = wallGlow(points, color);
	if (glow) group.add(glow);
	// Puntitas redondeadas.
	for (const end of [points[0], points[points.length - 1]]) {
		const cap = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), tube.material);
		cap.position.copy(end);
		group.add(cap);
	}
	group.add(tube, halo);
	return group;
}

// ---------------------------------------------------------------- la casa --

export class HouseDecor {
	private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
	private geometries = new Map<THREE.Mesh, THREE.BufferGeometry>();
	private textures: THREE.Texture[] = [];
	private neonGroup = new THREE.Group();
	private lights: THREE.PointLight[] = [];
	private styleKey = '';
	private neonKey = '';

	/** Aplica paredes, piso y neones de la casa (`room` es la sala cargada). */
	apply(room: THREE.Object3D, items: PlacedFurniture[]): void {
		const wall = items.find((i) => i.id.startsWith('style:wall:'));
		const floor = items.find((i) => i.id.startsWith('style:floor:'));
		const key = `${wall?.id}|${wall?.color}|${floor?.id}|${floor?.color}`;
		if (key !== this.styleKey || !this.originals.size) {
			this.styleKey = key;
			this.restore();
			room.traverse((o) => {
				const mesh = o as THREE.Mesh;
				if (!mesh.isMesh || Array.isArray(mesh.material)) return;
				const name = (mesh.material as THREE.Material).name;
				const isWall = /^Wall/.test(name);
				const isFloor = /^HousePlank/.test(name);
				const def = isWall ? wall : isFloor ? floor : undefined;
				if (!def) return;
				const id = def.id.split(':')[2];
				const color = def.color ?? HOUSE_STYLES.find((s) => s.id === id)?.color ?? '#888888';
				const texture = new THREE.CanvasTexture(drawPattern(id, color));
				texture.colorSpace = THREE.SRGBColorSpace;
				texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
				texture.anisotropy = 4;
				this.textures.push(texture);
				this.originals.set(mesh, mesh.material);
				this.geometries.set(mesh, mesh.geometry);
				const geometry = mesh.geometry.clone();
				projectUv(geometry, isWall ? 'wall' : 'floor', isWall ? (id === 'wainscot' ? 3.0 : 1.4) : 1.6);
				mesh.geometry = geometry;
				const base = mesh.material as THREE.MeshStandardMaterial;
				mesh.material = new THREE.MeshStandardMaterial({map: texture, color: 0xffffff, roughness: isFloor ? 0.6 : 0.85, side: base.side});
			});
		}
		// Neones.
		const strips = items.filter((i) => i.id === 'neon' && Array.isArray(i.pts) && (i.pts?.length ?? 0) >= 6);
		const nkey = JSON.stringify(strips.map((s) => [s.color, s.pts]));
		if (nkey !== this.neonKey || this.neonGroup.parent !== room) {
			this.neonKey = nkey;
			this.clearNeon();
			room.add(this.neonGroup);
			for (const s of strips) this.neonGroup.add(buildNeon({color: s.color ?? NEON_COLORS[0], pts: s.pts!}));
			// Luces repartidas a lo largo de las tiras (una cada ~1,5 m), con un tope total: cada luz
			// cuesta en las PCs flojas. Así ilumina parejo y no sólo desde el centro.
			const MAX_LIGHTS = 8;
			const spots: Array<{p: THREE.Vector3; color: string}> = [];
			for (const s of strips) {
				const p = s.pts!;
				let run = 0;
				let last: THREE.Vector3 | null = null;
				for (let i = 0; i < p.length; i += 3) {
					const here = new THREE.Vector3(p[i], p[i + 1], p[i + 2]);
					if (last) run += here.distanceTo(last);
					if (!last || run >= 1.5 || i === p.length - 3) {
						if (!last || run >= 0.6) spots.push({p: here, color: s.color ?? NEON_COLORS[0]});
						run = 0;
					}
					last = here;
				}
			}
			const step = Math.max(1, spots.length / MAX_LIGHTS);
			for (let k = 0; k < spots.length && this.lights.length < MAX_LIGHTS; k += step) {
				const spot = spots[Math.floor(k)];
				const light = new THREE.PointLight(new THREE.Color(spot.color), 1.6, 3.4, 1.6);
				light.position.copy(spot.p).lerp(new THREE.Vector3(0, 1.4, 0), 0.06);
				this.neonGroup.add(light);
				this.lights.push(light);
			}
		}
	}

	private restore(): void {
		for (const [mesh, material] of this.originals) {
			const used = mesh.material as THREE.Material;
			if (used !== material && !Array.isArray(used)) used.dispose();
			mesh.material = material;
			const geometry = this.geometries.get(mesh);
			if (geometry && mesh.geometry !== geometry) {
				mesh.geometry.dispose();
				mesh.geometry = geometry;
			}
		}
		this.originals.clear();
		this.geometries.clear();
		for (const t of this.textures) t.dispose();
		this.textures = [];
	}

	private clearNeon(): void {
		this.neonGroup.traverse((o) => {
			const m = o as THREE.Mesh;
			if (m.isMesh) m.geometry.dispose();
		});
		this.neonGroup.clear();
		this.lights = [];
	}

	/** Al salir de la casa (la sala se tira entera). */
	reset(): void {
		this.originals.clear();
		this.geometries.clear();
		for (const t of this.textures) t.dispose();
		this.textures = [];
		this.styleKey = '';
		this.neonKey = '';
		this.clearNeon();
		this.neonGroup.removeFromParent();
	}
}

// ------------------------------------------------------- dibujar neones ---

/** Punto sobre una pared a partir de un rayo (o null si no la toca). */
export function wallHit(ray: THREE.Ray, wall: WallId): THREE.Vector3 | null {
	const W = HOUSE_WALLS;
	const inset = 0.03;
	const plane = wall === 'back'
		? new THREE.Plane(new THREE.Vector3(0, 0, -1), W.back - inset)
		: wall === 'left'
			? new THREE.Plane(new THREE.Vector3(1, 0, 0), -(W.left + inset))
			: new THREE.Plane(new THREE.Vector3(-1, 0, 0), W.right - inset);
	const p = ray.intersectPlane(plane, new THREE.Vector3());
	if (!p) return null;
	p.y = Math.min(W.top - 0.05, Math.max(W.floor + 0.05, p.y));
	if (wall === 'back') p.x = Math.min(W.right - 0.05, Math.max(W.left + 0.05, p.x));
	else p.z = Math.min(W.back - 0.05, Math.max(W.minZ, p.z));
	return p;
}

/**
 * Cámara para dibujar: siempre de frente a la pared elegida. `dist` = qué tan lejos (con la ruedita),
 * `u`/`v` = corrida sobre la pared (arrastrando con el botón derecho).
 */
export function wallCamera(wall: WallId, dist = 7, u = 0, v = 0): {pos: THREE.Vector3; look: THREE.Vector3} {
	const W = HOUSE_WALLS;
	const y = 1.55 + v;
	if (wall === 'back') {
		const x = -0.25 + u;
		return {pos: new THREE.Vector3(x, y + 0.15, W.back - dist), look: new THREE.Vector3(x, y, W.back)};
	}
	if (wall === 'left') {
		const z = 0 - u;
		return {pos: new THREE.Vector3(W.left + dist, y + 0.15, z), look: new THREE.Vector3(W.left, y, z)};
	}
	const z = 0 + u;
	return {pos: new THREE.Vector3(W.right - dist, y + 0.15, z), look: new THREE.Vector3(W.right, y, z)};
}
