/**
 * Avatares 3D: arma un personaje a partir del avatar modular (public/models/avatar_modular.glb).
 *
 * Cada pieza del GLB trae en sus extras `pelacord_slot` / `pelacord_body` / `pelacord_item`: acá se
 * muestran sólo las que corresponden al look, se recolorean los materiales (clonados por avatar) y se
 * enganchan los disfraces al hueso que dicen. Las animaciones son las del GLB (Idle, Walk, Sit, Talk,
 * Blink, Wave, Slap).
 */
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {Catalog, ColorKey, Look} from '@/world/core';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

export function loadGLB(url: string): Promise<GLTF> {
	let promise = cache.get(url);
	if (!promise) {
		promise = loader.loadAsync(url);
		cache.set(url, promise);
		promise.catch(() => cache.delete(url));
	}
	return promise;
}

const AVATAR_URL = 'models/avatar_modular.glb';
const COLOR_MATERIALS: Record<string, ColorKey> = {Skin: 'skin', Hair: 'hair', Top: 'top', Bottom: 'bottom', Shoes: 'shoes', Sole: 'sole'};
type BaseAnim = 'idle' | 'walk' | 'sit';
const CLIP: Record<BaseAnim, string> = {idle: 'Idle', walk: 'Walk', sit: 'Sit'};

/**
 * Huesos que mueve DE VERDAD cada animación.
 *
 * El exportador de glTF guarda todos los huesos en todas las animaciones (con la pose de reposo en
 * los que no se tocan). Sin este filtro, el parpadeo o la boca al hablar "devolvían" el cuerpo a
 * estar parado: sentado, cada parpadeo te paraba un instante y te volvía a sentar.
 */
const CLIP_BONES: Record<string, string[] | null> = {
	Idle: null,
	Walk: null,
	Sit: null,
	Blink: ['eye_L', 'eye_R'],
	Talk: ['mouth', 'head'],
	Wave: ['arm_R', 'arm_L', 'head'],
	Slap: ['arm_R', 'spine', 'head'],
};
const clipCache = new Map<THREE.AnimationClip, THREE.AnimationClip>();

function onlyBones(clip: THREE.AnimationClip): THREE.AnimationClip {
	const bones = CLIP_BONES[clip.name];
	if (!bones) return clip;
	let filtered = clipCache.get(clip);
	if (!filtered) {
		filtered = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((track) => bones.includes(track.name.split('.')[0])));
		clipCache.set(clip, filtered);
	}
	return filtered;
}

function hidesOf(catalog: Catalog, itemId: string | null): string[] {
	if (!itemId) return [];
	const item = catalog.items.find((i) => i.id === itemId);
	if (!item?.hides) return [];
	return Array.isArray(item.hides) ? item.hides : [item.hides];
}

export class Avatar {
	readonly root = new THREE.Group();
	private model!: THREE.Object3D;
	private mixer!: THREE.AnimationMixer;
	private actions: Record<string, THREE.AnimationAction> = {};
	private base: BaseAnim = 'idle';
	private materials = new Map<string, THREE.MeshStandardMaterial>();
	private costumes: THREE.Object3D[] = [];
	private bones: Record<string, {bone: THREE.Bone; inverse: THREE.Matrix4}> = {};
	private nextBlink = 2 + Math.random() * 3;
	private talking = false;
	private lookKey = '';
	private ready: Promise<void>;
	private disposed = false;

	constructor(private catalog: Catalog, look: Look) {
		this.ready = this.init(look);
	}

	whenReady(): Promise<void> {
		return this.ready;
	}

	private async init(look: Look): Promise<void> {
		const gltf = await loadGLB(AVATAR_URL);
		if (this.disposed) return;
		this.model = cloneSkinned(gltf.scene);
		this.model.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (mesh.isMesh) {
				mesh.castShadow = true;
				mesh.frustumCulled = false;
				// Material propio por avatar (si no, recolorear a uno recoloreaba a todos).
				const source = mesh.material as THREE.MeshStandardMaterial;
				let mat = this.materials.get(source.name);
				if (!mat) {
					mat = source.clone();
					this.materials.set(source.name, mat);
				}
				mesh.material = mat;
			}
			const skinned = obj as THREE.SkinnedMesh;
			if (skinned.isSkinnedMesh && Object.keys(this.bones).length === 0) {
				skinned.skeleton.bones.forEach((bone, index) => {
					this.bones[bone.name] = {bone, inverse: skinned.skeleton.boneInverses[index].clone()};
				});
			}
		});
		this.root.add(this.model);
		this.mixer = new THREE.AnimationMixer(this.model);
		for (const source of gltf.animations) {
			const clip = onlyBones(source);
			const action = this.mixer.clipAction(clip);
			if (clip.name === 'Wave' || clip.name === 'Slap' || clip.name === 'Blink') {
				action.setLoop(THREE.LoopOnce, 1);
				action.clampWhenFinished = false;
			}
			// Sentarse es una POSE: se reproduce una vez y queda quieta. En bucle, al dar la vuelta se
			// veía un "pararse y volver a sentarse" cada segundo.
			if (clip.name === 'Sit') {
				action.setLoop(THREE.LoopOnce, 1);
				action.clampWhenFinished = true;
			}
			this.actions[clip.name] = action;
		}
		this.mixer.addEventListener('finished', (event) => {
			const action = (event as unknown as {action: THREE.AnimationAction}).action;
			if (action === this.actions.Wave || action === this.actions.Slap) action.fadeOut(0.2);
		});
		this.actions.Idle?.play();
		await this.setLook(look);
	}

	/** Cambia peinado, cara, ropa, colores y disfraces. */
	async setLook(look: Look): Promise<void> {
		const key = JSON.stringify(look);
		if (key === this.lookKey || !this.model) return;
		this.lookKey = key;
		const hidden = new Set([...hidesOf(this.catalog, look.top), ...hidesOf(this.catalog, look.costume)]);
		this.model.traverse((obj) => {
			const data = obj.userData as {pelacord_slot?: string; pelacord_body?: string; pelacord_item?: string};
			if (!data.pelacord_slot) return;
			const slot = data.pelacord_slot;
			const bodyOk = !data.pelacord_body || data.pelacord_body === 'any' || data.pelacord_body === look.body;
			if (slot === 'body') {
				obj.visible = data.pelacord_body === look.body;
				return;
			}
			const wanted = (look as unknown as Record<string, string | null>)[slot];
			obj.visible = bodyOk && wanted === data.pelacord_item && !hidden.has(slot);
		});
		for (const [name, mat] of this.materials) {
			const key2 = COLOR_MATERIALS[name];
			if (key2 && look.colors[key2]) mat.color.set(look.colors[key2]);
		}
		for (const old of this.costumes) old.removeFromParent();
		this.costumes = [];
		const extras = [look.costume, hidden.has('hat') ? null : look.hat].filter(Boolean) as string[];
		for (const itemId of extras) {
			const item = this.catalog.items.find((i) => i.id === itemId);
			if (!item?.glb) continue;
			const gltf = await loadGLB(item.glb);
			if (this.disposed || this.lookKey !== key) return;
			const costume = gltf.scene.clone(true);
			costume.traverse((obj) => {
				if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).castShadow = true;
			});
			const target = this.bones[item.attach === 'spine' ? 'spine' : 'head'];
			if (!target) continue;
			// Los disfraces están modelados en el espacio del avatar en reposo: se pasan al espacio
			// del hueso con su matriz inversa de "bind", así quedan bien aunque esté animado.
			costume.matrixAutoUpdate = true;
			costume.applyMatrix4(target.inverse);
			target.bone.add(costume);
			this.costumes.push(costume);
		}
	}

	setBase(anim: BaseAnim): void {
		if (anim === this.base || !this.actions[CLIP[anim]]) return;
		const from = this.actions[CLIP[this.base]];
		const to = this.actions[CLIP[anim]];
		to.reset().fadeIn(0.25).play();
		from?.fadeOut(0.25);
		this.base = anim;
	}

	getBase(): BaseAnim {
		return this.base;
	}

	play(name: 'Wave' | 'Slap'): void {
		const action = this.actions[name];
		if (!action) return;
		action.reset().setEffectiveWeight(1).fadeIn(0.1).play();
	}

	setTalking(on: boolean): void {
		if (on === this.talking) return;
		this.talking = on;
		const talk = this.actions.Talk;
		if (!talk) return;
		if (on) talk.reset().setEffectiveWeight(0.9).fadeIn(0.15).play();
		else talk.fadeOut(0.25);
	}

	update(dt: number): void {
		if (!this.mixer) return;
		this.nextBlink -= dt;
		if (this.nextBlink <= 0) {
			this.actions.Blink?.reset().play();
			this.nextBlink = 2.5 + Math.random() * 3.5;
		}
		this.mixer.update(dt);
	}

	dispose(): void {
		this.disposed = true;
		this.mixer?.stopAllAction();
		// Las etiquetas HTML (nombre, viñetas) no se borran solas al sacar el objeto de la escena:
		// quedaban flotando (pasaba con la vendedora al salir de la tienda).
		this.root.traverse((obj) => {
			const element = (obj as unknown as {isCSS2DObject?: boolean; element?: HTMLElement}).element;
			if ((obj as unknown as {isCSS2DObject?: boolean}).isCSS2DObject) element?.remove();
		});
		this.root.removeFromParent();
		for (const mat of this.materials.values()) mat.dispose();
	}
}
