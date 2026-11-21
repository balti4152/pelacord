import * as THREE from 'three';
import {SPIN_MS, SYMBOLS, rouletteFrame, slotStop, slotSymbolUrl, type Spin} from '@/world/casino';
import type {RoomId} from '@/world/core';

const PARTY_COLORS = [0xff60b6, 0x65d9ff, 0xab8aff, 0xffb85c, 0x7df8b4];
const SLOTS_START = [0, 3, 4, 2, 5];
const UP = new THREE.Vector3(0, 1, 0);

export class RoomEffects {
	private readonly group = new THREE.Group();
	private readonly cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), new THREE.MeshBasicMaterial({color: 0xb5adbd}));
	private readonly dots = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 8), new THREE.MeshBasicMaterial({
		transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
	}), 42);
	private readonly spots = [new THREE.SpotLight(PARTY_COLORS[0], 0, 9, 0.56, 0.76), new THREE.SpotLight(PARTY_COLORS[1], 0, 9, 0.49, 0.78)];
	private readonly pose = new THREE.Object3D();
	private readonly color = new THREE.Color();
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	private readonly burstPositions = new Float32Array(45 * 3);
	private readonly burst = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({color: 0xffce62, size: 0.075, transparent: true, depthWrite: false}));
	private room: RoomId | null = null;
	private ball: THREE.Object3D | undefined;
	private ballY = 0;
	private anchor = new THREE.Vector3();
	private factor = 0;
	private party = 0;
	private localLights: Array<{light: THREE.Light; intensity: number}> = [];
	private shades: Array<{mesh: THREE.Mesh; original: THREE.Material; material: THREE.MeshStandardMaterial; intensity: number}> = [];
	private reelCanvases: Array<{canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh; original: THREE.Material; material: THREE.MeshBasicMaterial; shown: number}> = [];
	private rotor: THREE.Object3D | undefined;
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
			SLOTS_START.forEach((value, index) => {
				const mesh = root.getObjectByName('SlotsReel_' + index) as THREE.Mesh | undefined;
				if (!mesh?.isMesh || Array.isArray(mesh.material)) return;
				const canvas = document.createElement('canvas');
				canvas.width = canvas.height = 128;
				const texture = new THREE.CanvasTexture(canvas);
				texture.colorSpace = THREE.SRGBColorSpace;
				texture.flipY = false;
				const material = new THREE.MeshBasicMaterial({map: texture, side: THREE.DoubleSide});
				this.reelCanvases.push({canvas, texture, mesh, original: mesh.material, material, shown: -1});
				mesh.material = material;
				this.paintReel(index, value);
			});
		}
		this.cable.visible = house && Boolean(this.ball);
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

	play(spin: Spin): void {
		if (this.room !== 'casino') return;
		this.spin = spin;
		this.spinAt = performance.now();
		this.burstAt = -Infinity;
		this.spinAngle = this.marble && this.rotor ? Math.atan2(this.marble.position.x - this.rotor.position.x, this.marble.position.z - this.rotor.position.z) : 0;
	}

	tick(dt: number, t: number, music: boolean, screening: boolean): void {
		if (this.room === 'casino') this.updateCasino(performance.now());
		const house = Boolean(this.room?.startsWith('house:'));
		if (!house && this.room !== 'cinema') return;
		const target = music || (!house && screening) ? 1 : 0;
		const ease = 1 - Math.exp(-3.5 * dt);
		this.factor = THREE.MathUtils.lerp(this.factor, target, ease);
		this.party = THREE.MathUtils.lerp(this.party, music ? 1 : 0, ease);
		const dim = this.factor;
		this.sun.intensity = this.baseSun * (1 - dim * (house ? 0.68 : 0.96));
		this.fill.intensity = this.baseFill * (1 - dim * (house ? 0.46 : 0.88));
		for (const {light, intensity} of this.localLights) light.intensity = intensity * (1 - dim * (house ? 0.47 : 0.97));
		for (const {material, intensity} of this.shades) material.emissiveIntensity = intensity * (1 - dim * 0.93);
		const source = new THREE.Vector3(0, 3.75, 0.2);
		if (this.ball) {
			this.ball.position.y = this.ballY - 1.25 * dim;
			if (!this.reducedMotion) this.ball.rotation.y += dt * 0.65 * dim;
			this.ball.getWorldPosition(source);
			const link = this.anchor.clone().sub(source);
			this.cable.position.copy(source).addScaledVector(link, 0.5);
			this.cable.scale.y = link.length();
			this.cable.quaternion.setFromUnitVectors(UP, link.normalize());
		}
		const party = this.party * (house ? 1 : 0.68);
		this.dots.visible = party > 0.015;
		if (!this.dots.visible) {
			for (const spot of this.spots) spot.intensity = 0;
			return;
		}
		const time = this.reducedMotion ? 0 : t;
		this.spots.forEach((spot, i) => {
			const phase = time * 0.55 + i * Math.PI;
			spot.position.copy(source).setY(source.y + 0.2);
			spot.target.position.set(Math.cos(phase) * 2.8, 0, Math.sin(phase) * 2.1);
			spot.color.setHex(PARTY_COLORS[(Math.floor(time * 0.46) + 2 * i) % PARTY_COLORS.length]);
			spot.intensity = party * (6 + 3 * Math.sin(phase));
		});
		this.dots.material.opacity = party * 0.62;
		for (let i = 0; i < this.dots.count; i++) {
			const phase = i * 2.39996 + time * (i % 2 ? 0.32 : -0.23);
			const pulse = 0.62 + 0.38 * Math.sin(i * 1.7 + time * 1.48);
			const r = 0.75 + ((i * 7) % 19) * 0.155;
			if (i < 30) {
				this.pose.position.set(Math.cos(phase) * r, 0.022, Math.sin(phase) * r * 0.9);
				this.pose.rotation.set(-Math.PI / 2, 0, phase);
			} else {
				this.pose.position.set(Math.cos(phase) * 3.96, 1.65 + Math.sin(phase * 1.7) * 0.95, 3.62);
				this.pose.rotation.set(0, 0, phase);
			}
			this.pose.scale.setScalar((0.091 + (i % 4) * 0.021) * pulse);
			this.pose.updateMatrix();
			this.dots.setMatrixAt(i, this.pose.matrix);
			this.dots.setColorAt(i, this.color.setHex(PARTY_COLORS[i % PARTY_COLORS.length]));
		}
		this.dots.instanceMatrix.needsUpdate = true;
		if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
	}

	private updateCasino(now: number): void {
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
				spin.reels.forEach((value, i) => this.paintReel(i, now - this.spinAt >= slotStop(i) || this.reducedMotion ? value[1] : (i * 2 + Math.floor(raw * 22)) % SYMBOLS.length));
			}
			if (raw >= 1) {
				if (spin.payout > 0 && !this.reducedMotion) {
					this.burstAt = now;
					this.burst.position.set(spin.kind === 'slots' ? 4.8 : 0, 1.7, 2.1);
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
		this.ball = this.rotor = this.marble = undefined;
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

