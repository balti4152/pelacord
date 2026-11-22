import * as THREE from 'three';
import {poseClip, type Pose, type Rest} from '@/world/danceClips';

export type RideAnim = 'rideBike' | 'rideCar' | 'rideBroom';
export interface RiderTargets {
	grips: [THREE.Vector3, THREE.Vector3];
	feet: [THREE.Vector3, THREE.Vector3];
}

const POSES: Record<RideAnim, Pose> = {
	rideBike: {
		hips: {loc: [0, -.311, 0]},
		spine: {rot: [35, 0, 0]},
		head: {rot: [-29, 0, 0]},
		arm_L: {rot: [-52, 0, 12]}, arm_R: {rot: [-52, 0, -12]},
		elbow_L: {rot: [-34, 0, 0]}, elbow_R: {rot: [-34, 0, 0]},
		leg_L: {rot: [-24, 0, -12]}, leg_R: {rot: [-24, 0, 12]},
		knee_L: {rot: [38, 0, 0]}, knee_R: {rot: [38, 0, 0]},
	},
	rideCar: {
		hips: {loc: [0, -.31, 0]},
		arm_L: {rot: [-40, 0, 7]}, arm_R: {rot: [-40, 0, -7]},
		elbow_L: {rot: [-43, 0, 0]}, elbow_R: {rot: [-43, 0, 0]},
		leg_L: {rot: [-94, 0, -7]}, leg_R: {rot: [-94, 0, 7]},
		knee_L: {rot: [46, 0, 0]}, knee_R: {rot: [46, 0, 0]},
	},
	rideBroom: {
		hips: {loc: [0, -.282, 0]},
		spine: {rot: [48, 0, 0]},
		head: {rot: [-40, 0, 0]},
		arm_L: {rot: [-22, 0, 17]}, arm_R: {rot: [-29, 0, -17]},
		elbow_L: {rot: [-25, 0, 0]}, elbow_R: {rot: [-20, 0, 0]},
		leg_L: {rot: [-23, 0, -26]}, leg_R: {rot: [-23, 0, 26]},
		knee_L: {rot: [39, 0, 0]}, knee_R: {rot: [39, 0, 0]},
	},
};

export function buildMountClips(rest: Rest): THREE.AnimationClip[] {
	return (Object.keys(POSES) as RideAnim[]).map((id) => {
		const name = id[0].toUpperCase() + id.slice(1);
		return poseClip(name, rest, [[1, POSES[id]], [25, POSES[id]]]);
	});
}

interface Limb {
	upper: THREE.Bone;
	lower: THREE.Bone;
	contact: THREE.Vector3;
}

const SIDES = ['L', 'R'] as const;
const KNEE_DIRECTION: Record<RideAnim, [number, number]> = {
	rideBike: [.06, 1], rideCar: [1, .05], rideBroom: [-.06, 1],
};

/** Guides the elbows and knees while keeping palms and shoes attached to Blender anchors. */
export class RiderRig {
	private arms: Array<Limb | undefined>;
	private legs: Array<Limb | undefined>;
	private start = new THREE.Vector3();
	private middle = new THREE.Vector3();
	private end = new THREE.Vector3();
	private pole = new THREE.Vector3();
	private along = new THREE.Vector3();
	private bend = new THREE.Vector3();
	private currentDirection = new THREE.Vector3();
	private goalDirection = new THREE.Vector3();
	private world = new THREE.Quaternion();
	private parentRotation = new THREE.Quaternion();
	private rotation = new THREE.Quaternion();

	constructor(private root: THREE.Object3D, bones: Record<string, {bone: THREE.Bone}>) {
		this.arms = SIDES.map((side, i) => {
			const upper = bones[`arm_${side}`]?.bone;
			const lower = bones[`elbow_${side}`]?.bone;
			return upper && lower ? {upper, lower, contact: new THREE.Vector3(i ? .027 : -.027, .225, .008)} : undefined;
		});
		this.legs = SIDES.map((side, i) => {
			const upper = bones[`leg_${side}`]?.bone;
			const lower = bones[`knee_${side}`]?.bone;
			return upper && lower ? {upper, lower, contact: new THREE.Vector3(i ? .002 : -.002, .175, -.022)} : undefined;
		});
	}

	apply(anim: RideAnim, targets: RiderTargets): void {
		const [bendY, bendZ] = KNEE_DIRECTION[anim];
		for (let i = 0; i < SIDES.length; i++) {
			const mirror = i ? -1 : 1;
			const arm = this.arms[i];
			if (arm) this.solve(arm, targets.grips[i], this.pole.set(mirror * .62, -1, -.18).applyQuaternion(this.root.quaternion));
			const leg = this.legs[i];
			if (leg) this.solve(leg, targets.feet[i], this.pole.set(mirror * (anim === 'rideBroom' ? .85 : .14), bendY, bendZ).applyQuaternion(this.root.quaternion));
		}
	}

	private solve({upper, lower, contact}: Limb, target: THREE.Vector3, pole: THREE.Vector3): void {
		upper.getWorldPosition(this.start);
		lower.getWorldPosition(this.middle);
		lower.localToWorld(this.end.copy(contact));
		const upperLength = this.start.distanceTo(this.middle);
		const lowerLength = this.middle.distanceTo(this.end);
		this.along.copy(target).sub(this.start);
		const distance = this.along.length();
		if (distance < .001 || upperLength < .001 || lowerLength < .001) return;
		this.along.divideScalar(distance);
		const reach = THREE.MathUtils.clamp(distance, Math.abs(upperLength - lowerLength) + .001, upperLength + lowerLength - .001);
		// Intersection of the two limb radii, on the preferred side of the shoulder-to-grip axis.
		const projection = (upperLength ** 2 - lowerLength ** 2 + reach ** 2) / (2 * reach);
		const height = Math.sqrt(Math.max(0, upperLength ** 2 - projection ** 2));
		this.bend.copy(pole).addScaledVector(this.along, -pole.dot(this.along)).normalize();
		this.goalDirection.copy(this.along).multiplyScalar(projection).addScaledVector(this.bend, height).normalize();
		this.currentDirection.copy(this.middle).sub(this.start).normalize();
		this.turnBone(upper);

		lower.getWorldPosition(this.middle);
		lower.localToWorld(this.end.copy(contact));
		this.currentDirection.copy(this.end).sub(this.middle).normalize();
		this.goalDirection.copy(this.start).addScaledVector(this.along, reach).sub(this.middle).normalize();
		this.turnBone(lower);
	}

	private turnBone(bone: THREE.Bone): void {
		if (!bone.parent) return;
		bone.getWorldQuaternion(this.world);
		bone.parent.getWorldQuaternion(this.parentRotation).invert();
		this.rotation.setFromUnitVectors(this.currentDirection, this.goalDirection);
		bone.quaternion.copy(this.parentRotation).multiply(this.rotation).multiply(this.world);
	}
}
