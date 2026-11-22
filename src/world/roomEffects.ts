import * as THREE from 'three';
import {SPIN_MS, SYMBOLS, rouletteFrame, slotStop, slotSymbolUrl, type Spin} from '@/world/casino';
import type {RoomId} from '@/world/core';

const PARTY_COLORS = [0xff60b6, 0x65d9ff, 0xab8aff, 0xffb85c, 0x7df8b4];
const SLOTS_START = [0, 3, 4, 2, 5];
const UP = new THREE.Vector3(0, 1, 0);
const COLOR_BLOBS = 8;
/** Azar fijo (igual para todos los que miran la misma sala). */
const hash = (n: number): number => {
	const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return x - Math.floor(x);
};

export class RoomEffects {
	private readonly group = new THREE.Group();
	private readonly cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), new THREE.MeshBasicMaterial({color: 0xb5adbd}));
	private readonly dots = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 8), new THREE.MeshBasicMaterial({
		transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
	}), 50);
	private readonly spots = [new THREE.SpotLight(PARTY_COLORS[0], 0, 9, 0.56, 0.76), new THREE.SpotLight(PARTY_COLORS[1], 0, 9, 0.49, 0.78)];
	private readonly pose = new THREE.Object3D();
	private readonly color = new THREE.Color();
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	private readonly burstPositions = new Float32Array(45 * 3);
	private readonly burst = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({color: 0xffce62, size: 0.075, transparent: true, depthWrite: false}));
	private room: RoomId | null = null;
	private ball: THREE.Object3D | undefined;
	/** La base del techo de donde cuelga la bola (se esconde con ella). */
	private ballMount: THREE.Object3D | undefined;
	private ballY = 0;
	private anchor = new THREE.Vector3();
	private factor = 0;
	private party = 0;
	private localLights: Array<{light: THREE.Light; intensity: number}> = [];
	private shades: Array<{mesh: THREE.Mesh; original: THREE.Material; material: THREE.MeshStandardMaterial; intensity: number}> = [];
	private reelCanvases: Array<{canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh; original: THREE.Material; material: THREE.MeshBasicMaterial; shown: number}> = [];
	private rotor: THREE.Object3D | undefined;
	private machines: THREE.Object3D[] = [];
	private spinMachine = 1;
	private marble: THREE.Object3D | undefined;
	private marbleHeight = 0;
	private readonly symbols = new Map<number, HTMLImageElement>();
	private spin: Spin | null = null;
	private spinAt = 0;
	private spinAngle = 0;
	private burstAt = -Infinity;
	private baseSun = 0;
	private baseFill = 0;

	constructor(scene: THREE.Scene, private readonly sun: THREE.DirectionalLight, private readonly fill: THREE.HemisphereLight) {
		this.group.add(this.cable, this.dots, this.burst);
		this.dots.frustumCulled = this.burst.frustumCulled = false;
		this.burst.geometry.setAttribute('position', new THREE.BufferAttribute(this.burstPositions, 3));
		for (const spot of this.spots) this.group.add(spot, spot.target);
		scene.add(this.group);
		this.group.visible = false;
	}

	enter(room: RoomId, root: THREE.Object3D): void {
		this.clear();
		this.room = room;
		this.baseSun = this.sun.intensity;
		this.baseFill = this.fill.intensity;
		const house = room.startsWith('house:');
		this.group.visible = house || room === 'casino' || room === 'cinema';
		if (house || room === 'cinema') {
			this.ball = root.getObjectByName('DiscoBall');
			this.ballMount = root.getObjectByName('Disco_ceiling_anchor') ?? root.getObjectByName('Disco ceiling anchor');
			this.ballY = this.ball?.position.y ?? 0;
			root.getObjectByName('DiscoAnchor')?.getWorldPosition(this.anchor);
			root.traverse((obj) => {
				const light = obj as THREE.Light;
				if (light.isLight) this.localLights.push({light, intensity: light.intensity});
				const mesh = obj as THREE.Mesh;
				const original = mesh.material as THREE.MeshStandardMaterial | undefined;
				if (!mesh.isMesh || !original?.isMeshStandardMaterial || !/^SconceGlow/.test(original.name)) return;
				const material = original.clone();
				mesh.material = material;
				this.shades.push({mesh, original, material, intensity: material.emissiveIntensity});
			});
		}
		if (room === 'casino') {
			this.rotor = root.getObjectByName('CasinoWheelRotor');
			this.marble = root.getObjectByName('CasinoWheelBall');
			this.marbleHeight = this.marble?.position.y ?? 0;
			const reels: THREE.Mesh[] = [];
			root.traverse((o) => {
				const match = /^SlotsReel_(\d)_(\d)$/.exec(o.name);
				if (match && (o as THREE.Mesh).isMesh) reels[Number(match[1]) * 3 + Number(match[2])] = o as THREE.Mesh;
			});
			this.machines = [0, 1, 2].map((i) => root.getObjectByName('SlotMachine_' + i)).filter((m): m is THREE.Object3D => Boolean(m));
			reels.forEach((mesh, index) => {
				const value = SLOTS_START[index % SLOTS_START.length] + Math.floor(index / 3) * 2;
				if (!mesh?.isMesh || Array.isArray(mesh.material)) return;
				const canvas = document.createElement('canvas');
				canvas.width = canvas.height = 128;
				const texture = new THREE.CanvasTexture(canvas);
				texture.colorSpace = THREE.SRGBColorSpace;
				texture.flipY = Boolean(mesh.userData.flipY);
				const material = new THREE.MeshBasicMaterial({map: texture, side: THREE.DoubleSide});
				this.reelCanvases.push({canvas, texture, mesh, original: mesh.material, material, shown: -1});
				mesh.material = material;
				this.paintReel(index, value % SYMBOLS.length);
			});
		}
		this.cable.visible = false;
		if (this.ball) this.ball.visible = false;
		if (this.ballMount) this.ballMount.visible = false;
		this.dots.visible = this.burst.visible = false;
	}

	private paintReel(index: number, value: number): void {
		const reel = this.reelCanvases[index];
		if (!reel || reel.shown === value) return;
		reel.shown = value;
		const symbol = SYMBOLS[value];
		const ctx = reel.canvas.getContext('2d')!;
		ctx.fillStyle = '#2a1425';
		ctx.fillRect(0, 0, 128, 128);
		ctx.fillStyle = symbol.color;
		ctx.fillRect(0, 3, 128, 9);
		ctx.fillRect(0, 116, 128, 9);
		let art = this.symbols.get(value);
		if (!art) {
			art = new Image();
			this.symbols.set(value, art);
			art.addEventListener('load', () => {
				for (const [i, active] of this.reelCanvases.entries()) {
					if (active.shown !== value) continue;
					active.shown = -1;
					this.paintReel(i, value);
				}
			}, {once: true});
			art.src = slotSymbolUrl(value);
		}
		if (art.complete && art.naturalWidth) ctx.drawImage(art, 8, 8, 112, 112);
		reel.texture.needsUpdate = true;
	}

	play(spin: Spin, machine = 1): void {
		if (this.room !== 'casino') return;
		this.spin = spin;
		this.spinMachine = machine;
		this.spinAt = performance.now();
		this.burstAt = -Infinity;
		this.spinAngle = this.marble && this.rotor ? Math.atan2(this.marble.position.x - this.rotor.position.x, this.marble.position.z - this.rotor.position.z) : 0;
	}

	/**
	 * Modo joda (se prende desde la tele): con música, la sala queda casi a oscuras, baja la bola de
	 * boliche girando lento y tira puntitos BLANCOS que recorren el piso y la pared; aparte, luces de
	 * colores se prenden y se apagan en lugares al azar. Sin música (o sin modo joda) la bola se esconde.
	 */
	tick(dt: number, t: number, music: boolean, screening: boolean, partyMode = false): void {
		if (this.room === 'casino') this.updateCasino(performance.now());
		const house = Boolean(this.room?.startsWith('house:'));
		if (!house && this.room !== 'cinema') return;
		const party = music && partyMode;
		const target = party || (!house && screening) ? 1 : 0;
		const ease = 1 - Math.exp(-2.6 * dt);
		this.factor = THREE.MathUtils.lerp(this.factor, target, ease);
		this.party = THREE.MathUtils.lerp(this.party, party ? 1 : 0, ease);
		const dim = this.factor;
		// Al mínimo: se ve algo, pero lo que manda son las luces.
		this.sun.intensity = this.baseSun * (1 - dim * (house ? 0.9 : 0.96));
		this.fill.intensity = this.baseFill * (1 - dim * (house ? 0.78 : 0.88));
		for (const {light, intensity} of this.localLights) light.intensity = intensity * (1 - dim * (house ? 0.92 : 0.97));
		for (const {material, intensity} of this.shades) material.emissiveIntensity = intensity * (1 - dim * 0.95);
		const source = new THREE.Vector3(0, 3.75, 0.2);
		const p = this.party;
		if (this.ball) {
			// Escondida en el techo cuando no hay joda; baja girando despacito cuando arranca.
			this.ball.visible = p > 0.02;
			if (this.ballMount) this.ballMount.visible = this.ball.visible;
			this.ball.position.y = this.ballY + 0.9 - 2.15 * p;
			if (!this.reducedMotion) this.ball.rotation.y += dt * 0.22;
			this.ball.getWorldPosition(source);
			const link = this.anchor.clone().sub(source);
			this.cable.visible = house && this.ball.visible;
			this.cable.position.copy(source).addScaledVector(link, 0.5);
			this.cable.scale.y = Math.max(0.001, link.length());
			this.cable.quaternion.setFromUnitVectors(UP, link.normalize());
		}
		const level = p * (house ? 1 : 0.68);
		this.dots.visible = level > 0.015;
		if (!this.dots.visible) {
			for (const spot of this.spots) spot.intensity = 0;
			return;
		}
		const time = this.reducedMotion ? 0 : t;
		const floorY = house ? 0.06 : 0.025;
		const wallZ = house ? 3.9 : 5.2;
		// Luces de colores: cada una se prende en un lugar al azar, dura un rato y se apaga.
		this.spots.forEach((spot, i) => {
			const cycle = 2.6 + i * 0.7;
			const k = Math.floor((time + i * 1.3) / cycle);
			const phase = ((time + i * 1.3) / cycle) % 1;
			const r1 = hash(k * 7 + i * 13);
			const r2 = hash(k * 11 + i * 29);
			spot.position.copy(source).setY(source.y + 0.2);
			spot.target.position.set((r1 - 0.5) * 6.4, 0, (r2 - 0.5) * 5.6);
			spot.color.setHex(PARTY_COLORS[Math.floor(hash(k * 3 + i) * PARTY_COLORS.length)]);
			spot.intensity = level * 16 * Math.sin(Math.PI * phase);
		});
		this.dots.material.opacity = Math.min(1, level * 0.95);
		for (let i = 0; i < this.dots.count; i++) {
			if (i < COLOR_BLOBS) {
				// Manchas de color que aparecen y desaparecen en lugares al azar.
				const cycle = 1.8 + (i % 3) * 0.6;
				const k = Math.floor((time + i * 0.9) / cycle);
				const phase = ((time + i * 0.9) / cycle) % 1;
				const life = Math.max(0, Math.sin(Math.PI * phase));
				this.pose.position.set((hash(k * 17 + i) - 0.5) * 7.4, floorY + 0.002, (hash(k * 23 + i * 5) - 0.5) * 6.6);
				this.pose.rotation.set(-Math.PI / 2, 0, 0);
				this.pose.scale.setScalar(0.55 * life + 0.0001);
				this.dots.setColorAt(i, this.color.setHex(PARTY_COLORS[Math.floor(hash(k * 5 + i * 3) * PARTY_COLORS.length)]));
			} else {
				// Los reflejos blancos de la bola: giran lento alrededor de ella.
				const phase = i * 2.39996 + time * 0.16;
				const pulse = 0.8 + 0.2 * Math.sin(i * 1.7 + time * 0.9);
				const r = 0.7 + ((i * 7) % 19) * 0.17;
				if (i < 34) {
					this.pose.position.set(source.x + Math.cos(phase) * r, floorY, source.z + Math.sin(phase) * r * 0.9);
					this.pose.rotation.set(-Math.PI / 2, 0, phase);
				} else {
					this.pose.position.set(source.x + Math.cos(phase) * 3.8, 1.65 + Math.sin(phase * 1.7) * 0.95, wallZ);
					this.pose.rotation.set(0, 0, phase);
				}
				this.pose.scale.setScalar((0.06 + (i % 4) * 0.014) * pulse);
				this.dots.setColorAt(i, this.color.setHex(0xffffff));
			}
			this.pose.updateMatrix();
			this.dots.setMatrixAt(i, this.pose.matrix);
		}
		this.dots.instanceMatrix.needsUpdate = true;
		if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
	}

	private updateCasino(now: number): void {
		// Lamparitas de las máquinas: van corriendo (más rápido en la que está girando).
		this.machines.forEach((machine, m) => {
			const bulbs = machine.userData.bulbs as THREE.Mesh[] | undefined;
			if (!bulbs) return;
			const fast = this.spin?.kind === 'slots' && this.spinMachine === m;
			const step = Math.floor(now / (fast ? 90 : 420));
			bulbs.forEach((bulb, i) => {
				(bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = (i + step + m) % 3 === 0 ? 2.4 : 0.5;
			});
		});
		if (this.spin) {
			const spin = this.spin;
			const raw = Math.min(1, (now - this.spinAt) / SPIN_MS[spin.kind]);
			if (spin.kind === 'roulette' && this.rotor && this.marble) {
				const frame = rouletteFrame(spin.number, this.spinAngle, raw, this.reducedMotion);
				this.rotor.rotation.y = frame.rotor;
				this.marble.position.x = this.rotor.position.x + Math.sin(frame.angle) * frame.radius;
				this.marble.position.z = this.rotor.position.z + Math.cos(frame.angle) * frame.radius;
				this.marble.position.y = this.marbleHeight + frame.hop;
			} else if (spin.kind === 'slots') {
				spin.reels.slice(0, 3).forEach((value, i) => this.paintReel(this.spinMachine * 3 + i, now - this.spinAt >= slotStop(i) || this.reducedMotion ? value[1] : (i * 2 + Math.floor(raw * 22)) % SYMBOLS.length));
				// La palanca baja y vuelve.
				const lever = this.machines[this.spinMachine]?.getObjectByName('SlotLever_' + this.spinMachine);
				if (lever) lever.rotation.x = -Math.sin(Math.min(1, raw * 4) * Math.PI) * 0.9;
			}
			if (raw >= 1) {
				if (spin.payout > 0 && !this.reducedMotion) {
					this.burstAt = now;
					this.burst.position.set(spin.kind === 'slots' ? (this.machines[this.spinMachine]?.position.x ?? 4.65) : 0, 1.7, 2.1);
				}
				this.spin = null;
			}
		}
		const age = (now - this.burstAt) / 1000;
		this.burst.visible = age < 1.3;
		if (this.burst.visible) {
			for (let i = 0; i < this.burstPositions.length / 3; i++) {
				const angle = i * 2.39996;
				const r = age * (0.8 + (i % 8) * 0.2);
				this.burstPositions[i * 3] = Math.cos(angle) * r;
				this.burstPositions[i * 3 + 1] = age * (1.95 + (i % 5) * 0.23) - age * age * 2.5;
				this.burstPositions[i * 3 + 2] = Math.sin(angle) * r;
			}
			this.burst.geometry.attributes.position.needsUpdate = true;
			this.burst.material.opacity = 1 - age / 1.3;
		}
	}

	clear(): void {
		this.room = null;
		this.ball = this.ballMount = this.rotor = this.marble = undefined;
		this.machines = [];
		this.spin = null;
		this.burstAt = -Infinity;
		this.factor = 0;
		this.party = 0;
		for (const spot of this.spots) spot.intensity = 0;
		this.group.visible = false;
		this.localLights = [];
		for (const {mesh, original, material} of this.shades) { mesh.material = original; material.dispose(); }
		for (const {mesh, original, material, texture} of this.reelCanvases) {
			mesh.material = original;
			texture.dispose();
			material.dispose();
		}
		this.shades = [];
		this.reelCanvases = [];
	}

	dispose(): void {
		this.clear();
		for (const object of [this.cable, this.dots, this.burst]) {
			object.geometry.dispose();
			object.material.dispose();
		}
		this.group.removeFromParent();
	}
}

