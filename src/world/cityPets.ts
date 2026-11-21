import * as THREE from 'three';
import {loadGLB} from '@/world/avatars';
import {PETS, type PetId} from '@/world/petCatalog';
import {PetModel} from '@/world/petModel';

export const CAPTURE_RANGE = 2.15;
const FLIGHT_TIME = .43;
const CAPTURE_TIME = 1.08;
const RESPAWN_MS = 35_000;
const SPAWNS = [
	{id: 'plaza-nuez', species: 'nuez', speed: .73, route: [[1.6, -4.6], [3.8, -5.1], [4.2, -3.5], [2.9, -3.4]]},
	{id: 'plaza-bruma', species: 'bruma', speed: 1.0, route: [[-3.3, -2.6], [-5.8, -1.7], [-5.5, 1.4], [-3.0, 2.4]]},
	{id: 'plaza-brote', species: 'brote', speed: .48, route: [[4.55, 1.15], [4.55, 2.35], [5.55, 2.25], [5.45, .55]]},
	{id: 'garden-brote', species: 'brote', speed: .48, route: [[-6.8, -5.4], [-8.4, -6.5], [-5.6, -8.3], [-4.4, -7.1]]},
	{id: 'street-nuez', species: 'nuez', speed: .73, route: [[7.1, 3.5], [9.8, 3.8], [11, 2.2], [8.4, 1.9]]},
] as const satisfies ReadonlyArray<{id: string; species: PetId; speed: number; route: ReadonlyArray<readonly [number, number]>}>;

interface Pet {
	id: string;
	species: PetId;
	speed: number;
	model: PetModel;
	route: THREE.Vector3[];
	next: number;
	wait: number;
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
	private respawnAt = new Map<string, number>();
	private epoch = 0;
	private pulseGeometry = new THREE.RingGeometry(.88, 1, 40);
	private pulseMaterial = new THREE.MeshBasicMaterial({color: 0xb7f8e5, transparent: true, depthWrite: false});

	async enterCity(): Promise<void> {
		const epoch = ++this.epoch;
		const sphere = loadGLB('models/capture_sphere.glb').then((gltf) => {
			if (this.epoch === epoch) this.sphere = gltf.scene;
		});
		const spawns = SPAWNS.map(async ({id, species, speed, route}, index) => {
			const model = await PetModel.load(species);
			if (epoch !== this.epoch) {
				model.dispose();
				return;
			}
			const points = route.map(([x, z]) => new THREE.Vector3(x, .045, z));
			model.root.position.copy(points[0]);
			const pet = {id, species, speed, model, route: points, next: 1, wait: 2 + index * .63};
			model.root.visible = !this.respawnAt.has(id);
			this.pets.push(pet);
			this.root.add(model.root);
		});
		await Promise.allSettled([sphere, ...spawns]);
	}

	targets(): Array<{id: string; name: string; position: THREE.Vector3}> {
		if (!this.sphere || this.capture) return [];
		return this.pets.filter((pet) => pet.model.root.visible).map((pet) => ({
			id: pet.id, name: PETS[pet.species].name, position: pet.model.root.position,
		}));
	}

	tryCapture(id: string, from: THREE.Vector3, commit: (species: PetId) => boolean): PetId | null {
		const pet = this.pets.find((candidate) => candidate.id === id && candidate.model.root.visible);
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
		this.respawnAt.set(pet.id, performance.now() + RESPAWN_MS);
		this.capture = {pet, orb, pulse, start, end, time: 0};
		pet.model.play('Startled');
		return pet.species;
	}

	update(dt: number): void {
		const now = performance.now();
		for (const pet of this.pets) {
			if (this.capture?.pet === pet) {
				pet.model.update(dt);
				continue;
			}
			if (!pet.model.root.visible) {
				if (now < (this.respawnAt.get(pet.id) ?? 0)) continue;
				this.respawnAt.delete(pet.id);
				pet.model.root.visible = true;
				pet.model.root.position.copy(pet.route[0]);
				pet.model.root.scale.setScalar(pet.model.scale);
				pet.next = 1;
				pet.wait = 2.2;
			}
			pet.wait -= dt;
			if (pet.wait <= 0) {
				const target = pet.route[pet.next];
				const dx = target.x - pet.model.root.position.x;
				const dz = target.z - pet.model.root.position.z;
				const distance = Math.hypot(dx, dz);
				if (distance < .07) {
					pet.next = (pet.next + 1) % pet.route.length;
					pet.wait = 1.3 + Math.random() * 2.2;
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
		this.updateCapture(dt);
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
			pet.model.root.visible = false;
			pet.model.play('Idle');
			orb.removeFromParent();
			pulse.removeFromParent();
			this.capture = null;
		}
	}

	clear(): void {
		this.epoch += 1;
		for (const {model} of this.pets) model.dispose();
		this.pets = [];
		this.capture = null;
		this.sphere = null;
		this.root.clear();
	}

	dispose(): void {
		this.clear();
		this.pulseMaterial.dispose();
		this.pulseGeometry.dispose();
	}
}
