/**
 * Ambiente de los lugares de afuera: ciclo de luz, halos cálidos, guirnaldas y luciérnagas.
 *
 * Todo es barato: los halos son sprites (sin luces reales extra, que son caras para PCs flojas).
 */
import * as THREE from 'three';
import type {RoomId} from '@/world/core';
import {OutdoorLighting} from '@/world/outdoorLighting';

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

const BULB_COLORS = [0xffd27a, 0xff9e6b, 0xfff1c9, 0xff7fae, 0x9fe3ff, 0xc6a2ff];
const CITY_BULB_COLORS = [0xffce83, 0xffe8b2, 0xfbb4bb, 0xe8ddfa, 0xc9eabf];

export class Ambience {
	private group = new THREE.Group();
	private fireflies: THREE.Points | null = null;
	private fireflySeeds: Float32Array | null = null;
	private halos: THREE.Sprite[] = [];
	private bulbs: THREE.MeshBasicMaterial | null = null;
	private lighting: OutdoorLighting;

	constructor(private scene: THREE.Scene, private sun: THREE.DirectionalLight, private fill: THREE.HemisphereLight) {
		scene.add(this.group);
		this.lighting = new OutdoorLighting(scene, sun, fill);
	}

	setup(room: RoomId, root: THREE.Object3D): void {
		this.clear();
		if (room !== 'city' && room !== 'port' && room !== 'campfire') {
			this.scene.background = new THREE.Color(0x1d1430);
			this.fill.color.set(0xd9ccff);
			this.fill.groundColor.set(0x3a2552);
			this.fill.intensity = 1.25;
			this.sun.color.set(0xfff0dd);
			this.sun.intensity = 1.5;
			this.sun.shadow.normalBias = 0;
			return;
		}
		this.lighting.enter(room, root);

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
		// Guirnaldas: entre faroles vecinos (en la ciudad forman un anillo alrededor de la plaza).
		const city = room === 'city';
		const palette = city ? CITY_BULB_COLORS : BULB_COLORS;
		const ring = lamps.sort(city
			? (a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x)
			: (a, b) => a.x - b.x || a.z - b.z);
		const points: Array<{p: THREE.Vector3; c: number}> = [];
		const pairs = ring.length > 2 && city ? ring.length : ring.length - 1;
		for (let i = 0; i < pairs; i++) {
			const a = ring[i];
			const b = ring[(i + 1) % ring.length];
			if (!a || !b || a.distanceTo(b) > 9) continue;
			const start = a.clone().add(new THREE.Vector3(0, -.15, 0));
			const end = b.clone().add(new THREE.Vector3(0, -.15, 0));
			const middle = start.clone().lerp(end, .5);
			middle.y -= city ? .88 : 1.4;
			const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
			const count = Math.max(6, Math.round(a.distanceTo(b) * (city ? 2.05 : 2.6)));
			for (let k = 1; k < count; k++) {
				const p = curve.getPoint(k / count);
				p.y -= .046;
				points.push({p, c: palette[(i * 3 + k) % palette.length]});
			}
			const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)), new THREE.LineBasicMaterial({color: city ? 0x57423d : 0x2a1e30}));
			wire.name = 'Garland cord';
			this.group.add(wire);
		}
		if (points.length) {
			this.bulbs = new THREE.MeshBasicMaterial({toneMapped: false});
			const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), this.bulbs, points.length);
			bulbs.name = 'Garland bulbs';
			const m = new THREE.Matrix4();
			points.forEach(({p, c}, i) => {
				bulbs.setMatrixAt(i, m.makeScale(1, 1.25, 1).setPosition(p));
				bulbs.setColorAt(i, new THREE.Color(c).multiplyScalar(city ? 1.18 : 1.6));
				if (!city || i % 3 === 0) this.halo(p, city ? .37 : .55, c, city ? .24 : .5);
			});
			this.group.add(bulbs);
		}
		// Luciérnagas.
		const count = city ? 26 : room === 'campfire' ? 60 : 45;
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

	update(t: number): number {
		const night = this.lighting.update();
		this.bulbs?.color.setScalar(THREE.MathUtils.lerp(.68, 1.24, night));
		const f = this.fireflies;
		const seeds = this.fireflySeeds;
		if (f) f.visible = night > .15;
		if (f?.visible && seeds) {
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
			(f.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(night, .15, .86) * (.65 + Math.sin(t * 2) * .15);
		}
		for (const h of this.halos) {
			(h.material as THREE.SpriteMaterial).opacity = (h.userData.base as number) * (.24 + night * .76)
				* (.85 + Math.sin(t * 1.6 + (h.userData.phase as number)) * .15);
		}
		return night;
	}

	private clear(): void {
		this.lighting.clear();
		for (const child of [...this.group.children]) {
			child.removeFromParent();
			const mesh = child as THREE.Mesh;
			mesh.geometry?.dispose();
			const mat = mesh.material as THREE.Material | undefined;
			mat?.dispose();
		}
		this.halos = [];
		this.bulbs = null;
		this.fireflies = null;
		this.fireflySeeds = null;
	}

	dispose(): void {
		this.clear();
		this.group.removeFromParent();
	}
}
