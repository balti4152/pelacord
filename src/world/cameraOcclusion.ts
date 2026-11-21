import * as THREE from 'three';

const OCCLUDED_OPACITY = .13;
const SAMPLE_INTERVAL = .075;
const LANDSCAPE = /^(Ground|Floor|Plaza|Street|SidePath|Trail|Rug|Stars|Moon|Cloudbank|Park hill|Water)/i;

interface Occluder {
	meshes: THREE.Mesh[];
	box: THREE.Box3;
}

interface Fade {
	opacity: number;
	blocking: boolean;
	originals: Array<{mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; shadow: boolean}>;
	materials: Map<THREE.Material, THREE.Material>;
}

/** Fades the small set of level meshes that are actually between the camera and the player. */
export class CameraOcclusion {
	private rooms: Occluder[] = [];
	private furniture: Occluder[] = [];
	private fading = new Map<Occluder, Fade>();
	private sampleTime = 0;
	private caster = new THREE.Raycaster();
	private direction = new THREE.Vector3();
	private intersection = new THREE.Vector3();
	private hits: THREE.Intersection[] = [];
	private sightlines = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

	setRoom(objects: THREE.Object3D[]): void {
		for (const occluder of this.rooms) this.restore(occluder);
		this.rooms = this.index(objects);
		this.sampleTime = 0;
	}

	setFurniture(objects: THREE.Object3D[]): void {
		for (const occluder of this.furniture) this.restore(occluder);
		this.furniture = this.index(objects);
		this.sampleTime = 0;
	}

	private index(objects: THREE.Object3D[]): Occluder[] {
		const results: Occluder[] = [];
		for (const object of objects) {
			if (LANDSCAPE.test(object.name) || object.getObjectByName('Screen')) continue;
			object.updateWorldMatrix(true, true);
			const meshes: THREE.Mesh[] = [];
			const box = new THREE.Box3();
			object.traverseVisible((child) => {
				const mesh = child as THREE.Mesh;
				if (!mesh.isMesh || LANDSCAPE.test(child.name)) return;
				box.expandByObject(mesh);
				meshes.push(mesh);
			});
			if (meshes.length && box.max.y - box.min.y > .24) results.push({meshes, box});
		}
		return results;
	}

	update(camera: THREE.Vector3, player: THREE.Vector3 | null, dt: number): void {
		this.sampleTime -= dt;
		if (!player || this.sampleTime <= 0) {
			this.sampleTime = SAMPLE_INTERVAL;
			for (const fade of this.fading.values()) fade.blocking = false;
			if (player) this.sample(camera, player);
		}

		for (const [occluder, fade] of this.fading) {
			const target = fade.blocking ? OCCLUDED_OPACITY : 1;
			const speed = fade.blocking ? 21 : 9;
			fade.opacity = THREE.MathUtils.damp(fade.opacity, target, speed, dt);
			if (!fade.blocking && fade.opacity > .995) {
				this.restore(occluder);
				continue;
			}
			for (const [original, copy] of fade.materials) {
				copy.opacity = original.opacity * fade.opacity;
				copy.alphaTest = original.alphaTest * fade.opacity;
			}
		}
	}

	private sample(camera: THREE.Vector3, player: THREE.Vector3): void {
		this.direction.subVectors(camera, player).setY(0).normalize();
		const sx = this.direction.z * .19;
		const sz = -this.direction.x * .19;
		this.sightlines[0].copy(player).setY(player.y + 1.27);
		this.sightlines[1].copy(player).setY(player.y + .73);
		this.sightlines[2].set(player.x + sx, player.y + .96, player.z + sz);
		this.sightlines[3].set(player.x - sx, player.y + .96, player.z - sz);

		for (const point of this.sightlines) {
			this.direction.subVectors(point, camera);
			const distance = this.direction.length();
			if (distance < .25) continue;
			this.caster.set(camera, this.direction.multiplyScalar(1 / distance));
			this.caster.near = .015;
			this.caster.far = distance - .11;
			for (const occluder of [...this.rooms, ...this.furniture]) {
				if (this.fading.get(occluder)?.blocking) continue;
				if (occluder.box.containsPoint(camera)) {
					this.startFade(occluder);
					continue;
				}
				const pointInBox = this.caster.ray.intersectBox(occluder.box, this.intersection);
				if (!pointInBox || pointInBox.distanceToSquared(camera) >= this.caster.far ** 2) continue;
				this.hits.length = 0;
				this.caster.intersectObjects(occluder.meshes, false, this.hits);
				if (this.hits.length) this.startFade(occluder);
			}
		}
	}

	private startFade(occluder: Occluder): void {
		const active = this.fading.get(occluder);
		if (active) {
			active.blocking = true;
			return;
		}
		const fade: Fade = {opacity: 1, blocking: true, originals: [], materials: new Map()};
		const ghostMaterial = (original: THREE.Material) => {
			let copy = fade.materials.get(original);
			if (!copy) {
				copy = original.clone();
				copy.transparent = true;
				copy.depthWrite = false;
				fade.materials.set(original, copy);
			}
			return copy;
		};
		for (const mesh of occluder.meshes) {
			const material = mesh.material;
			fade.originals.push({mesh, material, shadow: mesh.castShadow});
			mesh.material = Array.isArray(material) ? material.map(ghostMaterial) : ghostMaterial(material);
			mesh.castShadow = false;
		}
		this.fading.set(occluder, fade);
	}

	private restore(occluder: Occluder): void {
		const fade = this.fading.get(occluder);
		if (!fade) return;
		for (const {mesh, material, shadow} of fade.originals) {
			mesh.material = material;
			mesh.castShadow = shadow;
		}
		for (const material of fade.materials.values()) material.dispose();
		this.fading.delete(occluder);
	}

	clear(): void {
		for (const occluder of this.fading.keys()) this.restore(occluder);
		this.furniture = [];
		this.rooms = [];
		this.sampleTime = 0;
	}
}
