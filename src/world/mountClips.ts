import {poseClip, type Pose, type Rest} from '@/world/danceClips';

const car: Pose = {
	hips: {loc: [0, -.32, 0]},
	arm_L: {rot: [-67, 0, 15]},
	arm_R: {rot: [-67, 0, -15]},
	elbow_L: {rot: [-20, 0, 0]},
	elbow_R: {rot: [-20, 0, 0]},
	leg_L: {rot: [-91, 0, -4]},
	leg_R: {rot: [-91, 0, 4]},
	knee_L: {rot: [60, 0, 0]},
	knee_R: {rot: [60, 0, 0]},
};

const broom: Pose = {
	hips: {loc: [0, -.30, 0]},
	spine: {rot: [11, 0, 0]},
	head: {rot: [-8, 0, 0]},
	arm_L: {rot: [-54, 0, 18]},
	arm_R: {rot: [-64, 0, -16]},
	elbow_L: {rot: [-25, 0, 0]},
	elbow_R: {rot: [-23, 0, 0]},
	leg_L: {rot: [-60, 0, -24]},
	leg_R: {rot: [-60, 0, 24]},
	knee_L: {rot: [76, 0, 0]},
	knee_R: {rot: [76, 0, 0]},
};

export function buildMountClips(rest: Rest) {
	const bike: Array<[number, Pose]> = Array.from({length: 13}, (_, i) => {
		const angle = i * Math.PI / 6 + .86;
		const rise = Math.sin(angle);
		return [1 + i * 2, {
			hips: {loc: [0, -.29, 0]},
			spine: {rot: [12, 0, 0]},
			head: {rot: [-9, 0, 0]},
			arm_L: {rot: [-60, 0, -5]},
			arm_R: {rot: [-60, 0, 5]},
			elbow_L: {rot: [-18, 0, 0]},
			elbow_R: {rot: [-18, 0, 0]},
			leg_L: {rot: [-36 - 14 * rise, 0, -10]},
			leg_R: {rot: [-36 + 14 * rise, 0, 10]},
			knee_L: {rot: [45 + 21 * rise, 0, 0]},
			knee_R: {rot: [45 - 21 * rise, 0, 0]},
		}];
	});
	return [
		poseClip('RideBike', rest, bike),
		poseClip('RideCar', rest, [[1, car], [25, car]]),
		poseClip('RideBroom', rest, [[1, broom], [25, broom]]),
	];
}
