import {Vector3, type Group} from 'three';
import type {PetId} from '@/world/petCatalog';
import {PetModel} from '@/world/petModel';

const GROUND_HEIGHT = .045;
const TELEPORT_DISTANCE = 5;

export class PetCompanion {
	private model: PetModel | null = null;
	private disposed = false;
	private placed = false;
	private destination = new Vector3();
	private step = new Vector3();

	constructor(
		readonly species: PetId,
		private group: Group,
		private clamp: (position: Vector3) => Vector3,
	) {
		void this.load();
	}

	private async load(): Promise<void> {
		try {
			const model = await PetModel.load(this.species);
			if (this.disposed) {
				model.dispose();
				return;
			}
			model.root.name = 'Companion_' + this.species;
			model.root.visible = false;
			this.model = model;
			this.group.add(model.root);
		} catch (error) {
			console.warn('No se pudo cargar la mascota equipada', error);
		}
	}

	reset(): void {
		this.placed = false;
		if (this.model) this.model.root.visible = false;
	}

	update(owner: Vector3, heading: number, dt: number): void {
		const model = this.model;
		if (!model) return;
		const {root} = model;
		const sin = Math.sin(heading);
		const cos = Math.cos(heading);
		this.destination.set(owner.x - 1.18 * sin + .72 * cos, 0, owner.z - 1.18 * cos - .72 * sin);
		this.clamp(this.destination).setY(GROUND_HEIGHT);

		if (!this.placed || Math.hypot(root.position.x - owner.x, root.position.z - owner.z) > TELEPORT_DISTANCE) {
			root.position.copy(this.destination);
			root.rotation.y = heading;
			this.placed = true;
			root.visible = true;
		}

		const distance = this.destination.distanceTo(root.position);
		let walking = false;
		if (distance > .16) {
			const speed = Math.min(5.1, .65 + distance * 2.2);
			this.step.copy(root.position).lerp(this.destination, Math.min(1, dt * speed / distance));
			this.clamp(this.step).setY(GROUND_HEIGHT);
			const dx = this.step.x - root.position.x;
			const dz = this.step.z - root.position.z;
			if (Math.hypot(dx, dz) > .001) {
				const turn = Math.atan2(dx, dz) - root.rotation.y;
				root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 9);
				root.position.copy(this.step);
				model.play('Walk', Math.min(2.1, .75 + speed * .24));
				walking = true;
			}
		}
		if (!walking) model.play('Idle');
		model.update(dt);
	}

	dispose(): void {
		this.disposed = true;
		this.model?.dispose();
	}
}
