import * as THREE from 'three';
import {loadGLB} from '@/world/avatars';
import type {CatalogItem} from '@/world/core';
import {type MountId, readMountColor} from '@/world/mountCatalog';
import {MountTrail} from '@/world/mountTrail';
import type {RiderTargets} from '@/world/riderPose';

const RIDE = {
	mount_bike: {anim: 'rideBike', wheel: .282},
	mount_car: {anim: 'rideCar', wheel: .171},
	mount_broom: {anim: 'rideBroom', wheel: 0},
} as const;
const PEDAL_RADIUS = .245;
const TAU = Math.PI * 2;

export class ActorMount {
	readonly root = new THREE.Group();
	readonly fit;
	readonly targets: RiderTargets = {
		grips: [new THREE.Vector3(), new THREE.Vector3()],
		feet: [new THREE.Vector3(), new THREE.Vector3()],
	};
	private anchors = new Map<string, THREE.Object3D>();
	private wheels: THREE.Object3D[] = [];
	private crank?: THREE.Object3D;
	private paint = new Map<THREE.Material, THREE.MeshStandardMaterial>();
	private trail?: MountTrail;
	private previous = new THREE.Vector3();
	private phase = 0;
	private color = '';
	private ready = false;
	private disposed = false;

	constructor(readonly id: MountId, private item: CatalogItem, private parent: THREE.Group, color?: string) {
		this.fit = RIDE[id];
		this.root.visible = false;
		this.root.name = id;
		parent.add(this.root);
		this.setColor(color);
		if (item.glb) void this.load(item.glb);
	}

	private async load(url: string): Promise<void> {
		try {
			const {scene} = await loadGLB(url);
			if (this.disposed) return;
			const model = scene.clone(true);
			const recolor = this.item.recolor;
			model.traverse((node) => {
				const anchor = node.userData.pelacord_mount_anchor;
				if (typeof anchor === 'string') {
					this.anchors.set(anchor, node);
					if (anchor.startsWith('Wheel_')) this.wheels.push(node);
					if (anchor === 'Crank') this.crank = node;
				}
				const mesh = node as THREE.Mesh;
				if (!mesh.isMesh) return;
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				if (!Array.isArray(recolor)) return;
				const tint = (source: THREE.Material) => {
					if (!recolor.includes(source.name) || !(source as THREE.MeshStandardMaterial).isMeshStandardMaterial) return source;
					let material = this.paint.get(source);
					if (!material) {
						material = (source as THREE.MeshStandardMaterial).clone();
						material.color.set(this.color);
						this.paint.set(source, material);
					}
					return material;
				};
				mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
			});
			this.root.add(model);
			if (this.id === 'mount_broom') this.trail = new MountTrail(this.parent, this.color);
			this.ready = this.anchors.has('RideSeat');
		} catch (error) {
			console.warn('No se pudo cargar la montura', url, error);
		}
	}

	setColor(color?: string): void {
		const next = readMountColor(color) ?? this.item.defaultColor ?? '#ad7dff';
		if (next === this.color) return;
		this.color = next;
		for (const material of this.paint.values()) material.color.set(next);
		this.trail?.setColor(next);
	}

	reset(): void {
		this.root.visible = false;
		this.trail?.reset();
	}

	update(pos: THREE.Vector3, heading: number, active: boolean, dt: number): boolean {
		if (!active || !this.ready) {
			if (this.root.visible) this.reset();
			return false;
		}
		let distance = this.root.visible ? Math.hypot(pos.x - this.previous.x, pos.z - this.previous.z) : 0;
		if (distance > 1.45) {
			this.trail?.reset();
			distance = 0;
		}
		this.previous.copy(pos);
		this.root.visible = true;
		this.root.position.copy(pos);
		this.root.rotation.y = heading;
		for (const wheel of this.wheels) wheel.rotation.x = (wheel.rotation.x + distance / this.fit.wheel) % TAU;
		if (this.crank) {
			const angle = (this.crank.rotation.x + distance / PEDAL_RADIUS) % TAU;
			this.crank.rotation.x = angle;
			for (const name of ['Pedal_L', 'Pedal_R']) {
				const pedal = this.anchors.get(name);
				if (pedal) pedal.rotation.x = -angle;
			}
		}
		if (this.trail) {
			this.phase += dt;
			this.root.position.y += .165 + Math.sin(this.phase * 3.6) * .027;
			this.trail.update(this.root.position, heading, distance > Math.max(.00001, dt * .08), dt);
		}
		return true;
	}

	placeRider(position: THREE.Vector3): void {
		this.anchors.get('RideSeat')?.getWorldPosition(position);
		for (const [i, side] of ['L', 'R'].entries()) {
			this.anchors.get(`Grip_${side}`)?.getWorldPosition(this.targets.grips[i]);
			const pedal = this.anchors.get(`Pedal_${side}`);
			if (pedal) {
				pedal.getWorldPosition(this.targets.feet[i]);
				this.targets.feet[i].y += .029;
			} else {
				this.anchors.get(`Foot_${side}`)?.getWorldPosition(this.targets.feet[i]);
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		this.root.removeFromParent();
		this.trail?.dispose();
		for (const material of this.paint.values()) material.dispose();
	}
}
