/**
 * Ambiente "re cozy" de los lugares de afuera: cielo de atardecer-noche, niebla suave, halos cálidos
 * en los faroles, guirnaldas de lamparitas entre los faroles y luciérnagas.
 *
 * Todo es barato: los halos son sprites (sin luces reales extra, que son caras para PCs flojas).
 */
import * as THREE from 'three';
import type {RoomId} from '@/world/core';

let glowTexture: THREE.Texture | null = null;

function glow(): THREE.Texture {
	if (glowTexture) return glowTexture;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 128;
	const ctx = canvas.getContext('2d')!;
	const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
	g.addColorStop(0, 'rgba(255,255,255,1)');
	g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
	g.addColorStop(0.55, 'rgba(255,255,255,0.12)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 128, 128);
	glowTexture = new THREE.CanvasTexture(canvas);
	glowTexture.colorSpace = THREE.SRGBColorSpace;
	return glowTexture;
}

function skyTexture(top: string, middle: string, bottom: string): THREE.Texture {
	const canvas = document.createElement('canvas');
	canvas.width = 4;
	canvas.height = 256;
	const ctx = canvas.getContext('2d')!;
	const g = ctx.createLinearGradient(0, 0, 0, 256);
	g.addColorStop(0, top);
	g.addColorStop(0.55, middle);
	g.addColorStop(1, bottom);
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 4, 256);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

const BULB_COLORS = [0xffd27a, 0xff9e6b, 0xfff1c9, 0xff7fae, 0x9fe3ff, 0xc6a2ff];

export class Ambience {
	private group = new THREE.Group();
	private fireflies: THREE.Points | null = null;
	private fireflySeeds: Float32Array | null = null;
	private halos: THREE.Sprite[] = [];

	constructor(private scene: THREE.Scene) {
		scene.add(this.group);
	}

	setup(room: RoomId, root: THREE.Object3D): void {
		this.clear();
		if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
		const outdoor = room === 'city' || room === 'port' || room === 'campfire';
		if (!outdoor) {
			this.scene.background = new THREE.Color(0x1d1430);
			this.scene.fog = null;
			return;
		}
		this.scene.background = room === 'city' ? skyTexture('#ac94c5', '#edafae', '#f7cfb0')
			: skyTexture('#1b1240', room === 'port' ? '#4a3a7a' : '#43306e', room === 'port' ? '#f2a07a' : '#c97a8f');
		this.scene.fog = room === 'city' ? new THREE.Fog(0xe7b9a9, 27, 69)
			: new THREE.Fog(room === 'port' ? 0x6a4a7e : 0x4a3466, 22, 60);

		// Halos en las lamparitas (todo lo que se llame Lamp_*, o las luces que quedaron).
		root.updateMatrixWorld(true);
		const lamps: THREE.Vector3[] = [];
		root.traverse((obj) => {
			if (/^(Lamp|PierLamp)_\d+$/.test(obj.name)) {
				const box = new THREE.Box3().setFromObject(obj);
				lamps.push(new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - 0.2, (box.min.z + box.max.z) / 2));
			}
			if (/WindowGlow|StreetGlow|Glow/.test(((obj as THREE.Mesh).material as THREE.Material | undefined)?.name ?? '') && /win|Lantern/i.test(obj.name)) {
				const box = new THREE.Box3().setFromObject(obj);
				this.halo(box.getCenter(new THREE.Vector3()), 1.4, 0xffc27a, 0.35);
			}
		});
		for (const p of lamps) this.halo(p, room === 'city' ? 1.07 : 2.4, 0xffc070, room === 'city' ? .34 : .75);
		if (room === 'city') return;

		// Guirnaldas: entre faroles vecinos (en la ciudad forman un anillo alrededor de la plaza).
		const ring = lamps.slice().sort((a, b) => a.x - b.x || a.z - b.z);
		const points: Array<{p: THREE.Vector3; c: number}> = [];
		const pairs = ring.length - 1;
		for (let i = 0; i < pairs; i++) {
			const a = ring[i];
			const b = ring[(i + 1) % ring.length];
			if (!a || !b || a.distanceTo(b) > 9) continue;
			const count = Math.max(6, Math.round(a.distanceTo(b) * 2.6));
			for (let k = 1; k < count; k++) {
				const t = k / count;
				const p = a.clone().lerp(b, t);
				p.y = a.y - 0.25 - Math.sin(t * Math.PI) * 0.7;
				points.push({p, c: BULB_COLORS[(i * 3 + k) % BULB_COLORS.length]});
			}
			// El cable.
			const curve = new THREE.QuadraticBezierCurve3(a.clone().setY(a.y - 0.25), a.clone().lerp(b, 0.5).setY(a.y - 1.65), b.clone().setY(b.y - 0.25));
			const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)), new THREE.LineBasicMaterial({color: 0x2a1e30}));
			this.group.add(wire);
		}
		if (points.length) {
			const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({toneMapped: false}), points.length);
			const m = new THREE.Matrix4();
			points.forEach(({p, c}, i) => {
				bulbs.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
				bulbs.setColorAt(i, new THREE.Color(c).multiplyScalar(1.6));
				this.halo(p, 0.55, c, 0.5);
			});
			this.group.add(bulbs);
		}

		// Luciérnagas.
		const count = room === 'campfire' ? 60 : 45;
		const positions = new Float32Array(count * 3);
		const seeds = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const radius = 2.5 + Math.random() * 6;
			seeds[i * 3] = Math.cos(angle) * radius;
			seeds[i * 3 + 1] = 0.4 + Math.random() * 2.2;
			seeds[i * 3 + 2] = Math.sin(angle) * radius;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		this.fireflies = new THREE.Points(geometry, new THREE.PointsMaterial({
			size: 0.22, map: glow(), color: 0xfff09a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
		}));
		this.fireflies.frustumCulled = false;
		this.fireflySeeds = seeds;
		this.group.add(this.fireflies);
	}

	private halo(p: THREE.Vector3, size: number, color: number, opacity: number): void {
		const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: glow(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}));
		sprite.position.copy(p);
		sprite.scale.setScalar(size);
		sprite.userData.base = opacity;
		sprite.userData.phase = Math.random() * 10;
		this.halos.push(sprite);
		this.group.add(sprite);
	}

	update(_dt: number, t: number): void {
		const f = this.fireflies;
		const seeds = this.fireflySeeds;
		if (f && seeds) {
			const pos = f.geometry.attributes.position as THREE.BufferAttribute;
			for (let i = 0; i < pos.count; i++) {
				const s = i * 1.37;
				pos.setXYZ(
					i,
					seeds[i * 3] + Math.sin(t * 0.35 + s) * 0.9,
					seeds[i * 3 + 1] + Math.sin(t * 0.8 + s * 2) * 0.35,
					seeds[i * 3 + 2] + Math.cos(t * 0.3 + s) * 0.9,
				);
			}
			pos.needsUpdate = true;
			(f.material as THREE.PointsMaterial).opacity = 0.65 + Math.sin(t * 2) * 0.2;
		}
		for (const h of this.halos) {
			(h.material as THREE.SpriteMaterial).opacity = (h.userData.base as number) * (0.85 + Math.sin(t * 1.6 + (h.userData.phase as number)) * 0.15);
		}
	}

	private clear(): void {
		for (const child of [...this.group.children]) {
			child.removeFromParent();
			const mesh = child as THREE.Mesh;
			mesh.geometry?.dispose();
			const mat = mesh.material as THREE.Material | undefined;
			mat?.dispose();
		}
		this.halos = [];
		this.fireflies = null;
		this.fireflySeeds = null;
	}

	dispose(): void {
		this.clear();
		if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
		this.group.removeFromParent();
	}
}
