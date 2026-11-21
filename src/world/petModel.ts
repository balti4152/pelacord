import * as THREE from 'three';
import {clone as cloneSkinned} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {loadGLB} from '@/world/avatars';
import type {PetId} from '@/world/petCatalog';

export class PetModel {
	private action: THREE.AnimationAction | undefined;

	private constructor(
		readonly root: THREE.Object3D,
		readonly scale: number,
		private mixer: THREE.AnimationMixer,
		private actions: Record<string, THREE.AnimationAction>,
	) {
		this.play('Idle');
	}

	static async load(species: PetId): Promise<PetModel> {
		const gltf = await loadGLB(`models/pet_${species}.glb`);
		const root = cloneSkinned(gltf.scene);
		const scale = species === 'brote' ? 1.16 : 1.05;
		root.scale.setScalar(scale);
		root.traverse((obj) => { if ((obj as THREE.Mesh).isMesh) obj.castShadow = true; });
		const mixer = new THREE.AnimationMixer(root);
		const actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
		actions.Startled?.setLoop(THREE.LoopOnce, 1);
		return new PetModel(root, scale, mixer, actions);
	}

	play(name: 'Idle' | 'Walk' | 'Startled', speed = 1): void {
		const action = this.actions[name];
		if (!action) return;
		action.setEffectiveTimeScale(speed);
		if (action === this.action) return;
		this.action?.fadeOut(.18);
		action.reset().setEffectiveTimeScale(speed).fadeIn(.18).play();
		this.action = action;
	}

	update(dt: number): void {
		this.mixer.update(dt);
	}

	dispose(): void {
		this.mixer.stopAllAction();
		this.mixer.uncacheRoot(this.root);
		this.root.removeFromParent();
	}
}
