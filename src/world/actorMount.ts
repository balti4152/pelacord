import * as THREE from 'three';
import {loadGLB} from '@/world/avatars';
import type {CatalogItem} from '@/world/core';
import {type MountId, readMountColor} from '@/world/mountCatalog';
import {MountTrail} from '@/world/mountTrail';

const RIDE = {
	mount_bike: {anim: 'rideBike', height: .733, setback: -.23, wheel: .282},
	mount_car: {anim: 'rideCar', height: .414, setback: -.20, wheel: .171},
	mount_broom: {anim: 'rideBroom', height: .267, setback: -.035, wheel: 0},
} as const;
const PEDAL_RADIUS = .245;

export class ActorMount {
	readonly root = new THREE.Group();
	readonly fit;
	hover = 0;
	pedal = 0;
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
				if (/^Wheel_(?:Front|Rear|[0-3])$/.test(node.name)) this.wheels.push(node);
				if (node.name === 'Crank') this.crank = node;
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
			this.ready = true;
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
		for (const wheel of this.wheels) wheel.rotation.x = (wheel.rotation.x + distance / this.fit.wheel) % (Math.PI * 2);
		if (this.crank) {
			this.crank.rotation.x = (this.crank.rotation.x + distance / PEDAL_RADIUS) % (Math.PI * 2);
			this.pedal = this.crank.rotation.x / (Math.PI * 2);
		}
		if (this.trail) {
			this.phase += dt;
			this.hover = .165 + Math.sin(this.phase * 3.6) * .027;
			this.root.position.y += this.hover;
			this.trail.update(this.root.position, heading, distance > .007, dt);
		}
		return true;
	}

	dispose(): void {
		this.disposed = true;
		this.root.removeFromParent();
		this.trail?.dispose();
		for (const material of this.paint.values()) material.dispose();
	}
}
