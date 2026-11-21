/**
 * Mascotas salvajes: son RARAS. Cada una vive en un lugar (el oso en el campamento, la tortuga en el
 * muelle, el zorro en la ciudad), aparece de vez en cuando, da unas vueltas y, si nadie la atrapa en
 * 15 segundos, se va.
 */
import * as THREE from 'three';
import {worldSounds} from '@/world/worldSounds';
import {loadGLB} from '@/world/avatars';
import type {RoomId} from '@/world/core';
import {PETS, type PetId} from '@/world/petCatalog';
import {PetModel} from '@/world/petModel';

export const CAPTURE_RANGE = 2.15;
const FLIGHT_TIME = .43;
const CAPTURE_TIME = 1.08;
/** Cuánto se queda si nadie la atrapa. */
const STAY_MS = 15_000;
/** Cada cuánto se tira la "moneda" para ver si aparece, y con qué probabilidad. */
const ROLL_MS = 20_000;
const CHANCE = 0.14;
/** Después de irse o de que la atrapen, tarda al menos esto en poder volver. */
const COOLDOWN_MS = 70_000;

const HABITATS: Partial<Record<RoomId, {id: string; species: PetId; speed: number; route: Array<[number, number]>}>> = {
	campfire: {id: 'camp-nuez', species: 'nuez', speed: .7, route: [[3.3, 1.4], [2.2, 3.1], [0.3, 3.7], [-1.9, 3.2], [-0.4, 2.4]]},
	port: {id: 'pier-brote', species: 'brote', speed: .42, route: [[-1.5, 0.3], [-1.0, 1.6], [-1.9, 2.7], [-1.3, 1.1]]},
	city: {id: 'plaza-bruma', species: 'bruma', speed: 1.0, route: [[-3.3, -2.6], [-5.8, -1.7], [-5.5, 1.4], [-3.0, 2.4]]},
};

interface Pet {
	id: string;
	species: PetId;
	speed: number;
	model: PetModel;
	route: THREE.Vector3[];
	next: number;
	wait: number;
	/** Hasta cuándo se queda (después se va achicándose). */
	leaveAt: number;
	leaving: number;
	appearing: number;
}

interface Capture {
	pet: Pet;
	orb: THREE.Object3D;
	pulse: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
	start: THREE.Vector3;
	end: THREE.Vector3;
	time: number;
}

export class CityPets {
	readonly root = new THREE.Group();
	private pets: Pet[] = [];
	private capture: Capture | null = null;
	private sphere: THREE.Object3D | null = null;
	private epoch = 0;
	private room: RoomId | null = null;
	private nextRoll = 0;
	private cooldownUntil = new Map<string, number>();
	private sparkles: THREE.Points | null = null;
	private sparkleLife = 0;
	private pulseGeometry = new THREE.RingGeometry(.88, 1, 40);
	private pulseMaterial = new THREE.MeshBasicMaterial({color: 0xb7f8e5, transparent: true, depthWrite: false});
	/** Avisa cuando aparece una (para mostrar "¡Apareció…!"). */
	onAppear: ((name: string) => void) | null = null;

	/** Entra a un lugar: si es el hábitat de alguna, puede aparecer (de vez en cuando). */
	async enterRoom(room: RoomId): Promise<void> {
		this.clear();
		const epoch = this.epoch;
		this.room = room;
		// La primera tirada llega rápido (para que a veces la veas al entrar), después cada ROLL_MS.
		this.nextRoll = performance.now() + 6_000 + Math.random() * 6_000;
		if (!HABITATS[room]) return;
		const gltf = await loadGLB('models/capture_sphere.glb').catch(() => null);
		if (this.epoch === epoch && gltf) this.sphere = gltf.scene;
	}

	/** Compatibilidad: la ciudad. */
	enterCity(): Promise<void> {
		return this.enterRoom('city');
	}

	private async spawn(): Promise<void> {
		const habitat = this.room ? HABITATS[this.room] : undefined;
		if (!habitat || this.pets.length) return;
		const epoch = this.epoch;
		const model = await PetModel.load(habitat.species);
		if (epoch !== this.epoch || this.pets.length) {
			model.dispose();
			return;
		}
		const points = habitat.route.map(([x, z]) => new THREE.Vector3(x, .045, z));
		const start = Math.floor(Math.random() * points.length);
		model.root.position.copy(points[start]);
		model.root.scale.setScalar(0.001);
		const pet: Pet = {
			id: habitat.id, species: habitat.species, speed: habitat.speed, model, route: points, next: (start + 1) % points.length,
			wait: 1.2, leaveAt: performance.now() + STAY_MS, leaving: 0, appearing: 0.001,
		};
		this.pets.push(pet);
		this.root.add(model.root);
		this.burst(points[start]);
		this.onAppear?.(PETS[habitat.species].name);
	}

	/** Brillitos cuando aparece o se va. */
	private burst(at: THREE.Vector3): void {
		this.sparkles?.removeFromParent();
		const count = 26;
		const positions = new Float32Array(count * 3);
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.userData.seeds = Array.from({length: count}, () => [Math.random() * Math.PI * 2, 0.4 + Math.random() * 0.7, 0.3 + Math.random()]);
		const points = new THREE.Points(geometry, new THREE.PointsMaterial({color: 0xfff3a8, size: 0.09, transparent: true, depthWrite: false, toneMapped: false}));
		points.position.copy(at);
		this.root.add(points);
		this.sparkles = points;
		this.sparkleLife = 0;
	}

	targets(): Array<{id: string; name: string; position: THREE.Vector3}> {
		if (!this.sphere || this.capture) return [];
		return this.pets.filter((pet) => pet.model.root.visible && !pet.leaving).map((pet) => ({
			id: pet.id, name: PETS[pet.species].name, position: pet.model.root.position,
		}));
	}

	tryCapture(id: string, from: THREE.Vector3, commit: (species: PetId) => boolean): PetId | null {
		const pet = this.pets.find((candidate) => candidate.id === id && candidate.model.root.visible && !candidate.leaving);
		const source = this.sphere;
		if (!pet || !source || this.capture || pet.model.root.position.distanceTo(from) > CAPTURE_RANGE || !commit(pet.species)) return null;
		const orb = source.clone(true);
		const start = from.clone().add(new THREE.Vector3(0, .64, 0));
		const end = pet.model.root.position.clone().add(new THREE.Vector3(0, .29, 0));
		orb.position.copy(start);
		const pulse = new THREE.Mesh(this.pulseGeometry, this.pulseMaterial);
		pulse.rotation.x = -Math.PI / 2;
		pulse.position.copy(pet.model.root.position).setY(.075);
		pulse.visible = false;
		this.root.add(orb, pulse);
		this.cooldownUntil.set(pet.id, performance.now() + COOLDOWN_MS);
		this.capture = {pet, orb, pulse, start, end, time: 0};
		worldSounds.play('throw');
		pet.model.play('Startled');
		return pet.species;
	}

	update(dt: number): void {
		const now = performance.now();
		const habitat = this.room ? HABITATS[this.room] : undefined;
		// ¿Aparece? (rara vez)
		if (habitat && !this.pets.length && !this.capture && now >= this.nextRoll) {
			this.nextRoll = now + ROLL_MS;
			if (now >= (this.cooldownUntil.get(habitat.id) ?? 0) && Math.random() < CHANCE) void this.spawn();
		}
		for (const pet of [...this.pets]) {
			if (this.capture?.pet === pet) {
				pet.model.update(dt);
				continue;
			}
			// Aparece creciendo con un rebotito; se va achicándose.
			if (pet.appearing > 0 && pet.appearing < 1) {
				pet.appearing = Math.min(1, pet.appearing + dt * 2.5);
				const k = pet.appearing;
				pet.model.root.scale.setScalar(pet.model.scale * Math.max(0.001, 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2)));
			}
			if (!pet.leaving && now >= pet.leaveAt) {
				pet.leaving = 0.001;
				pet.model.play('Startled');
				this.cooldownUntil.set(pet.id, now + COOLDOWN_MS);
			}
			if (pet.leaving) {
				pet.leaving += dt * 1.6;
				pet.model.root.scale.setScalar(pet.model.scale * Math.max(0.001, 1 - pet.leaving));
				pet.model.root.position.y = .045 + pet.leaving * 0.4;
				pet.model.update(dt);
				if (pet.leaving >= 1) {
					this.burst(pet.model.root.position.clone().setY(0.2));
					this.remove(pet);
				}
				continue;
			}
			pet.wait -= dt;
			if (pet.wait <= 0) {
				const target = pet.route[pet.next];
				const dx = target.x - pet.model.root.position.x;
				const dz = target.z - pet.model.root.position.z;
				const distance = Math.hypot(dx, dz);
				if (distance < .07) {
					pet.next = (pet.next + 1) % pet.route.length;
					pet.wait = 1.0 + Math.random() * 1.8;
					pet.model.play('Idle');
				} else {
					const turn = Math.atan2(dx, dz) - pet.model.root.rotation.y;
					pet.model.root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 6.5);
					pet.model.root.position.lerp(target, Math.min(1, dt * pet.speed / distance));
					pet.model.play('Walk');
				}
			}
			pet.model.update(dt);
		}
		this.updateSparkles(dt);
		this.updateCapture(dt);
	}

	private updateSparkles(dt: number): void {
		const s = this.sparkles;
		if (!s) return;
		this.sparkleLife += dt;
		const pos = s.geometry.attributes.position as THREE.BufferAttribute;
		const seeds = s.geometry.userData.seeds as number[][];
		for (let i = 0; i < pos.count; i++) {
			const [a, r, up] = seeds[i];
			const t = this.sparkleLife;
			pos.setXYZ(i, Math.cos(a) * r * t * 1.6, up * t * 1.8 - t * t * 0.9, Math.sin(a) * r * t * 1.6);
		}
		pos.needsUpdate = true;
		(s.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - this.sparkleLife / 1.1);
		if (this.sparkleLife > 1.1) {
			s.removeFromParent();
			s.geometry.dispose();
			this.sparkles = null;
		}
	}

	private remove(pet: Pet): void {
		pet.model.root.removeFromParent();
		pet.model.dispose();
		this.pets = this.pets.filter((p) => p !== pet);
	}

	private updateCapture(dt: number): void {
		const capture = this.capture;
		if (!capture) return;
		const {pet, orb, pulse, start, end} = capture;
		capture.time += dt;
		const travel = Math.min(1, capture.time / FLIGHT_TIME);
		orb.position.lerpVectors(start, end, travel);
		orb.position.y += Math.sin(travel * Math.PI) * .53;
		orb.rotation.x = travel * Math.PI * 2;
		const impact = Math.max(0, (capture.time - FLIGHT_TIME) / (CAPTURE_TIME - FLIGHT_TIME));
		if (impact > 0) {
			const shrinking = Math.min(1, impact * 2.2);
			pet.model.root.scale.setScalar(pet.model.scale * Math.max(.001, 1 - shrinking));
			pet.model.root.visible = shrinking < 1;
			pulse.visible = true;
			pulse.scale.setScalar(.15 + impact * 1.02);
			this.pulseMaterial.opacity = .9 * (1 - Math.min(1, impact));
			orb.rotation.z = Math.sin(impact * Math.PI * 6) * (1 - Math.min(1, impact)) * .62;
			orb.scale.setScalar(Math.min(1, Math.max(.001, (1 - impact) * 3)));
		}
		if (capture.time >= CAPTURE_TIME) {
			worldSounds.play('reward', .9);
			orb.removeFromParent();
			pulse.removeFromParent();
			this.capture = null;
			this.remove(pet);
		}
	}

	clear(): void {
		this.epoch += 1;
		for (const {model} of this.pets) model.dispose();
		this.pets = [];
		this.capture = null;
		this.sphere = null;
		this.sparkles = null;
		this.root.clear();
	}

	dispose(): void {
		this.clear();
		this.pulseMaterial.dispose();
		this.pulseGeometry.dispose();
	}
}
