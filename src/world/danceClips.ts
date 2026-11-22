/**
 * Bailes armados con código (mismas convenciones que scripts/blender/avatar.py): cada pose es la
 * rotación de Blender del hueso (grados, Euler XYZ = orden 'ZYX' de three) sobre su pose de reposo.
 *
 * - Hips ("Caderazo"): manos en la cara, rodillas flexionadas y la cadera dando vueltas.
 * - Disco: un brazo apunta arriba y cruza abajo, la otra mano en la cintura.
 * - Pogo: saltitos con los puños arriba, alternados.
 * - Sway ("Recital"): los dos brazos arriba, meciéndose de lado a lado.
 *
 * Además, `spreadArms` separa un poco los brazos del cuerpo y de la cabeza en todas las animaciones
 * (los brazos del muñeco quedaban pegados y se metían en el cuerpo).
 */
import * as THREE from 'three';

type Rot = [number, number, number];
/** `aim`: hacia dónde apunta el hueso (hombro -> codo), en el espacio del muñeco: +X su izquierda, +Y arriba, +Z adelante. */
export type Pose = Partial<Record<string, {rot?: Rot; loc?: Rot; scale?: Rot; aim?: Rot}>>;
/** Reposo de cada hueso; `pw` = giro del padre en el mundo (para apuntar los brazos). */
export type Rest = Record<string, {q: THREE.Quaternion; p: THREE.Vector3; pw?: THREE.Quaternion}>;

const UP = new THREE.Vector3(0, 1, 0);
function aimQuat(r: Rest[string], dir: Rot): THREE.Quaternion {
	const v = new THREE.Vector3(...dir).normalize().applyQuaternion((r.pw ?? new THREE.Quaternion()).clone().invert()).applyQuaternion(r.q.clone().invert());
	return r.q.clone().multiply(new THREE.Quaternion().setFromUnitVectors(UP, v));
}

const FPS = 24;
const D = THREE.MathUtils.degToRad;
const BONES = ['hips', 'spine', 'head', 'arm_L', 'arm_R', 'elbow_L', 'elbow_R', 'leg_L', 'leg_R', 'knee_L', 'knee_R'];

function quat(rest: THREE.Quaternion, rot: Rot): THREE.Quaternion {
	return rest.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(D(rot[0]), D(rot[1]), D(rot[2]), 'ZYX')));
}

/**
 * Arma un clip en loop a partir de poses por cuadro (24 fps). Los huesos sin pose quedan en reposo.
 * `planted`: las piernas se contra-rotan con la cadera, así los pies quedan quietos en el piso.
 */
function clip(name: string, rest: Rest, keys: Array<[number, Pose]>, planted = false): THREE.AnimationClip {
	const tracks: THREE.KeyframeTrack[] = [];
	const last = keys[keys.length - 1][0];
	for (const bone of BONES) {
		const r = rest[bone];
		if (!r) continue;
		const times: number[] = [];
		const q: number[] = [];
		const p: number[] = [];
		let hasLoc = false;
		const sc: number[] = [];
		let hasScale = false;
		for (const [frame, pose] of keys) {
			const k = pose[bone];
			times.push((frame - 1) / FPS);
			const local = k?.aim ? aimQuat(r, k.aim) : quat(r.q, k?.rot ?? [0, 0, 0]);
			// Pierna hija de la cadera: se le saca el giro de la cadera (queda igual en el mundo).
			if (planted && (bone === 'leg_L' || bone === 'leg_R') && pose.hips?.rot) {
				const h = pose.hips.rot;
				local.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(D(h[0]), D(h[1]), D(h[2]), 'ZYX')).invert());
			}
			local.toArray(q, q.length);
			const s = k?.scale ?? [1, 1, 1];
			if (k?.scale) hasScale = true;
			sc.push(...s);
			const loc = k?.loc ?? [0, 0, 0];
			if (k?.loc) hasLoc = true;
			r.p.clone().add(new THREE.Vector3(...loc).applyQuaternion(r.q)).toArray(p, p.length);
		}
		tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, q));
		if (hasLoc) tracks.push(new THREE.VectorKeyframeTrack(`${bone}.position`, times, p));
		if (hasScale) tracks.push(new THREE.VectorKeyframeTrack(`${bone}.scale`, times, sc));
	}
	return new THREE.AnimationClip(name, (last - 1) / FPS, tracks);
}

function hips(rest: Rest): THREE.AnimationClip {
	// Las manos tapando los ojos (los brazos se estiran un poco, como en los dibujitos: con la cabeza
	// grande del muñeco no llegan), los pies quietos y la cadera dando vueltas.
	const S = 1.7;
	const keys: Array<[number, Pose]> = [];
	const steps = 12;
	for (let i = 0; i <= steps; i++) {
		const a = (i / steps) * Math.PI * 2;
		const s = Math.sin(a);
		const c = Math.cos(a);
		keys.push([1 + i * 2, {
			hips: {loc: [0.004 * s, -0.016, 0.008 * c], rot: [10 * c, 0, 10 * s]},
			spine: {rot: [4 - 8 * c, 0, -10 * s]},
			head: {rot: [16 - 3 * c, 0, -2 * s]},
			arm_L: {rot: [-100, -30, -10], scale: [1, S, 1]},
			arm_R: {rot: [-100, 30, 10], scale: [1, S, 1]},
			elbow_L: {rot: [-30, 0, 0], scale: [1, S, 1]},
			elbow_R: {rot: [-30, 0, 0], scale: [1, S, 1]},
			leg_L: {rot: [-18, 0, -6]},
			leg_R: {rot: [-18, 0, 6]},
			knee_L: {rot: [36, 0, 0]},
			knee_R: {rot: [36, 0, 0]},
		}]);
	}
	return clip('Hips', rest, keys, true);
}

const mirror = (d: Rot): Rot => [-d[0], d[1], d[2]];

function disco(rest: Rest): THREE.AnimationClip {
	// Travolta: el brazo derecho apunta arriba en diagonal y después cruza abajo; la izquierda en la cintura.
	const pose = (up: boolean): Pose => ({
		hips: {loc: [up ? 0.03 : -0.03, up ? 0.012 : 0, 0], rot: [0, up ? 8 : -8, 0]},
		spine: {rot: [up ? -4 : 6, up ? -6 : 8, up ? 6 : -6]},
		head: {rot: [up ? -12 : 10, up ? -10 : 14, 0]},
		arm_R: {aim: up ? [-0.55, 0.82, 0.18] : [0.25, -0.75, 0.6]},
		elbow_R: {rot: [up ? 0 : -8, 0, 0]},
		arm_L: {aim: [0.8, -0.45, -0.25]},
		elbow_L: {rot: [-85, 0, 0]},
		leg_L: {rot: [up ? -18 : 0, 0, -5]},
		leg_R: {rot: [up ? 0 : -12, 0, 8]},
		knee_L: {rot: [up ? 22 : 4, 0, 0]},
		knee_R: {rot: [up ? 4 : 18, 0, 0]},
	});
	return clip('Disco', rest, [[1, pose(true)], [7, pose(true)], [13, pose(false)], [19, pose(false)], [25, pose(true)]]);
}

function pogo(rest: Rest): THREE.AnimationClip {
	// Saltitos con un puño arriba (alternando) y el otro brazo al costado.
	const fist: Rot = [0.35, 0.9, 0.2];
	const low: Rot = [0.75, -0.6, 0.15];
	const pose = (k: number, side: number): Pose => ({
		hips: {loc: [0, 0.13 * k - 0.03 * (1 - k), 0]},
		spine: {rot: [-4 * k, 0, 4 * side]},
		head: {rot: [-10 * k, 0, -4 * side]},
		arm_L: {aim: side > 0 ? fist : low},
		arm_R: {aim: side > 0 ? mirror(low) : mirror(fist)},
		elbow_L: {rot: [side > 0 ? -25 : -70, 0, 0]},
		elbow_R: {rot: [side > 0 ? -70 : -25, 0, 0]},
		leg_L: {rot: [-14 * k - 18 * (1 - k), 0, -6]},
		leg_R: {rot: [-14 * k - 18 * (1 - k), 0, 6]},
		knee_L: {rot: [20 * k + 34 * (1 - k), 0, 0]},
		knee_R: {rot: [20 * k + 34 * (1 - k), 0, 0]},
	});
	return clip('Pogo', rest, [[1, pose(0, 1)], [5, pose(1, 1)], [9, pose(0, 1)], [10, pose(0, -1)], [14, pose(1, -1)], [18, pose(0, -1)], [19, pose(0, 1)]]);
}

function sway(rest: Rest): THREE.AnimationClip {
	// Caballito: las muñecas cruzadas adelante como agarrando riendas, saltitos cambiando de pie y
	// la cadera rebotando (el ritmo va al doble que el paso).
	const pose = (step: number, up: number): Pose => ({
		hips: {loc: [0.02 * step, 0.05 * up - 0.025, 0], rot: [0, 6 * step, -4 * step]},
		spine: {rot: [6 - 4 * up, -4 * step, 4 * step]},
		head: {rot: [-6 * up, 8 * step, -3 * step]},
		arm_L: {aim: [-0.08, -0.25, 0.95]},
		arm_R: {aim: [0.08, -0.3, 0.95]},
		elbow_L: {rot: [-38 - 8 * up, 0, 0]},
		elbow_R: {rot: [-34 - 8 * up, 0, 0]},
		// El pie que sube va adelante y doblado; el otro, apoyado.
		leg_L: {rot: [step > 0 ? -42 : -8, 0, -5]},
		leg_R: {rot: [step > 0 ? -8 : -42, 0, 5]},
		knee_L: {rot: [step > 0 ? 62 : 14, 0, 0]},
		knee_R: {rot: [step > 0 ? 14 : 62, 0, 0]},
	});
	return clip('Sway', rest, [
		[1, pose(1, 0)], [4, pose(1, 1)], [7, pose(1, 0)],
		[10, pose(-1, 0)], [13, pose(-1, 1)], [16, pose(-1, 0)],
		[19, pose(1, 0)],
	]);
}

export {clip as poseClip};

export function buildDanceClips(rest: Rest): THREE.AnimationClip[] {
	return [hips(rest), disco(rest), pogo(rest), sway(rest)];
}

/**
 * Separa los brazos del cuerpo: abajo se abren unos grados más; arriba (pasando la horizontal) se
 * corren hacia afuera para no meterse en la cabeza. Se aplica a todas las animaciones menos las que
 * llevan las manos a la cara a propósito.
 */
export function spreadArms(source: THREE.AnimationClip, rest: Rest, degrees = 9): THREE.AnimationClip {
	if (source.name === 'Hips') return source;
	const tracks = source.tracks.map((track) => {
		const [bone, prop] = track.name.split('.');
		if ((bone !== 'arm_L' && bone !== 'arm_R') || prop !== 'quaternion' || !rest[bone]) return track;
		const side = bone === 'arm_L' ? -1 : 1;
		const restInv = rest[bone].q.clone().invert();
		const values = track.values.slice();
		const q = new THREE.Quaternion();
		const e = new THREE.Euler();
		for (let i = 0; i < values.length; i += 4) {
			q.fromArray(values, i);
			e.setFromQuaternion(restInv.clone().multiply(q), 'ZYX');
			e.z += side * D(degrees) * Math.cos(e.z);
			rest[bone].q.clone().multiply(new THREE.Quaternion().setFromEuler(e)).toArray(values, i);
		}
		return new THREE.QuaternionKeyframeTrack(track.name, Array.from(track.times), Array.from(values));
	});
	return new THREE.AnimationClip(source.name, source.duration, tracks);
}
