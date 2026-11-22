import {loadFurnitureModel} from '@/world/outdoorDecor';
import * as THREE from 'three';
import {COLOR_MATERIALS, loadGLB} from '@/world/avatars';
import type {CatalogItem, Look} from '@/world/core';
import {furnitureColor as furnitureMaterialColor} from '@/world/furnitureColors';

export const PRODUCT_PREVIEW_SIZE = 144;
const FRAME_INTERVAL = 66;
const FRAMES_PER_TICK = 3;

interface Preview {
	target: CanvasRenderingContext2D;
	model: THREE.Group | null;
	visible: boolean;
	lastFrame: number;
	focus: PreviewFocus;
	angleTime: number;
	painted(): void;
}

type PreviewFocus = 'face' | 'hair' | 'bottom' | 'item';

function focusFor(item: CatalogItem, avatarUrl: string): PreviewFocus {
	if (item.slot === 'hair' || item.slot === 'bottom') return item.slot;
	if (item.slot === 'hat' && item.glb === avatarUrl) return 'hair';
	return ['eyes', 'brows', 'mouth', 'cheeks', 'facewear'].includes(item.slot) ? 'face' : 'item';
}

function matchesBody(node: THREE.Object3D, body: Look['body']): boolean {
	const type = node.userData.pelacord_body;
	return !type || type === 'any' || type === body;
}

const lowerBodyCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function lowerBodyGeometry(body: THREE.SkinnedMesh): THREE.BufferGeometry {
	const source = body.geometry;
	const cached = lowerBodyCache.get(source);
	if (cached) return cached;
	const index = source.index;
	const joints = source.getAttribute('skinIndex');
	const weights = source.getAttribute('skinWeight');
	if (!index || !joints || !weights) return source;

	const arms = new Set<number>();
	body.skeleton.bones.forEach((bone, i) => {
		if (/^(arm|elbow)_/.test(bone.name)) arms.add(i);
	});
	const isArm = (vertex: number) => {
		let weight = 0;
		for (let i = 0; i < 4; i++) {
			if (arms.has(joints.getComponent(vertex, i))) weight += weights.getComponent(vertex, i);
		}
		return weight > .5;
	};
	const triangles: number[] = [];
	for (let i = 0; i < index.count; i += 3) {
		const a = index.getX(i);
		const b = index.getX(i + 1);
		const c = index.getX(i + 2);
		if (!isArm(a) && !isArm(b) && !isArm(c)) triangles.push(a, b, c);
	}
	const geometry = new THREE.BufferGeometry();
	for (const attribute of ['position', 'normal', 'uv']) {
		const data = source.getAttribute(attribute);
		if (data) geometry.setAttribute(attribute, data);
	}
	geometry.setIndex(triangles);
	lowerBodyCache.set(source, geometry);
	return geometry;
}

async function buildProduct(item: CatalogItem, avatarUrl: string, look: Look, focus: PreviewFocus, furnitureColor?: string): Promise<THREE.Group> {
	const standalone = Boolean(item.glb && item.glb !== avatarUrl);
	const url = standalone ? item.glb : avatarUrl;
	if (!url) throw new Error('Artículo sin modelo');
	const model = await loadFurnitureModel(url, loadGLB);
	if (!model) throw new Error('Artículo sin modelo');
	const {scene} = model;
	scene.updateMatrixWorld(true);
	const product = new THREE.Group();
	const parts: THREE.Object3D[] = [];
	const context: THREE.Object3D[] = [];
	const portrait = focus === 'face' || focus === 'hair';
	let body: THREE.Object3D | undefined;
	if (standalone) {
		parts.push(scene);
	} else {
		const featured = new Set<string | null>();
		if (portrait) {
			for (const slot of ['eyes', 'mouth', 'brows', 'cheeks'] as const) {
				if (slot !== item.slot) featured.add(look[slot]);
			}
		} else if (focus === 'bottom') {
			featured.add(look.shoes);
		}
		scene.traverse((node) => {
			if (!matchesBody(node, look.body)) return;
			const {pelacord_item: id, pelacord_slot: slot} = node.userData;
			if (id === item.id) parts.push(node);
			else if (id && featured.has(id)) context.push(node);
			else if (slot === 'body' && focus !== 'item') body = node;
		});
	}
	if (!parts.length) throw new Error('Artículo sin geometría visible');

	const target = new THREE.Box3();
	for (const part of parts) target.expandByObject(part);
	const framing = target.clone();
	for (const part of context) framing.expandByObject(part);
	let cut: number | undefined;
	if (body && portrait) {
		const head = new THREE.Box3().setFromObject(body);
		cut = scene.getObjectByName('head')?.getWorldPosition(new THREE.Vector3()).y
			?? THREE.MathUtils.lerp(head.min.y, head.max.y, .56);
		head.min.y = cut;
		framing.union(head);
	} else if (focus === 'bottom') {
		cut = target.max.y + .028;
		framing.max.y = cut;
	}
	const bounds = framing.getBoundingSphere(new THREE.Sphere());
	if (!(bounds.radius > 0)) throw new Error('Artículo sin geometría visible');
	const size = framing.getSize(new THREE.Vector3());
	const scale = portrait ? 1.86 / Math.max(size.y, Math.hypot(size.x, size.z * .55)) : .98 / bounds.radius;
	const plane = cut === undefined ? undefined : new THREE.Plane(
		new THREE.Vector3(0, portrait ? 1 : -1, 0), (bounds.center.y - cut) * scale * (portrait ? 1 : -1),
	);

	const paints = new Map<THREE.Material, THREE.Material>();
	const croppedPaints = new Map<THREE.Material, THREE.Material>();
	const clonePart = (part: THREE.Object3D, cropped: boolean) => {
		const cache = cropped ? croppedPaints : paints;
		const paint = (material: THREE.Material) => {
			let copy = cache.get(material);
			if (!copy) {
				const tinted = material.clone() as THREE.MeshStandardMaterial;
				const key = COLOR_MATERIALS[material.name];
				if (tinted.color && !standalone && key) tinted.color.set(look.colors[key]);
				if (tinted.color && furnitureColor && Array.isArray(item.recolor) && item.recolor.includes(material.name)) {
					tinted.color.copy(furnitureMaterialColor(furnitureColor, material.name === 'BaseLight'));
				}
				if (cropped && plane) tinted.clippingPlanes = [plane];
				copy = tinted;
				cache.set(material, copy);
			}
			return copy;
		};
		part.traverseVisible((node) => {
			if (!(node as THREE.Mesh).isMesh) return;
			const source = node as THREE.SkinnedMesh;
			// La ropa y el cuerpo del GLB comparten la pose neutra.
			const geometry = focus === 'bottom' && part === body && source.isSkinnedMesh
				? lowerBodyGeometry(source) : source.geometry;
			const mesh = new THREE.Mesh(geometry, Array.isArray(source.material) ? source.material.map(paint) : paint(source.material));
			mesh.matrixAutoUpdate = false;
			mesh.matrix.copy(source.matrixWorld);
			product.add(mesh);
		});
	};
	for (const part of [...parts, ...context]) clonePart(part, focus === 'bottom');
	if (body) clonePart(body, true);

	product.scale.setScalar(scale);
	product.position.copy(bounds.center).multiplyScalar(-scale);
	const pivot = new THREE.Group();
	pivot.add(product);
	return pivot;
}

function disposeProduct(model: THREE.Group): void {
	const materials = new Set<THREE.Material>();
	model.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (!mesh.isMesh) return;
		for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
	});
	for (const material of materials) material.dispose();
}

class ProductPreviewRenderer {
	private renderer: THREE.WebGLRenderer | null = null;
	private failed = false;
	private scene = new THREE.Scene();
	private camera = new THREE.OrthographicCamera(-1.08, 1.08, 1.08, -1.08, .1, 30);
	private previews = new Set<Preview>();
	private frame = 0;
	private cursor = 0;
	private idleTimer = 0;
	private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

	constructor() {
		this.scene.add(new THREE.HemisphereLight(0xfff7e7, 0xc3b1ee, 2.15));
		const key = new THREE.DirectionalLight(0xffeed8, 2.35);
		key.position.set(-2, 3, 4);
		this.scene.add(key);
		this.reducedMotion.addEventListener('change', this.refreshMotion);
	}

	add(canvas: HTMLCanvasElement, item: CatalogItem, avatarUrl: string, look: Look, furnitureColor: string | undefined, painted: () => void): () => void {
		window.clearTimeout(this.idleTimer);
		const target = canvas.getContext('2d');
		if (!target) return () => undefined;
		const preview: Preview = {target, model: null, visible: false, lastFrame: -Infinity,
			focus: focusFor(item, avatarUrl), angleTime: 0, painted};
		this.previews.add(preview);
		let requested = false;
		const observer = new IntersectionObserver(([entry]) => {
			preview.visible = entry.isIntersecting;
			if (preview.visible && !requested) {
				requested = true;
				void buildProduct(item, avatarUrl, look, preview.focus, furnitureColor).then((model) => {
					if (!this.previews.has(preview)) {
						disposeProduct(model);
						return;
					}
					preview.model = model;
					this.schedule();
				}).catch(() => { /* The card keeps its fallback icon. */ });
			}
			this.schedule();
		});
		observer.observe(canvas);
		return () => {
			observer.disconnect();
			this.previews.delete(preview);
			if (preview.model) disposeProduct(preview.model);
			if (this.previews.size === 0) this.idleTimer = window.setTimeout(() => this.releaseRenderer(), 250);
		};
	}

	private refreshMotion = (): void => {
		for (const preview of this.previews) {
			preview.lastFrame = -Infinity;
			preview.angleTime = 0;
		}
		this.schedule();
	};

	private schedule(): void {
		if (!this.frame && !this.failed && [...this.previews].some((p) => p.visible && p.model
			&& (!this.reducedMotion.matches || !Number.isFinite(p.lastFrame)))) {
			this.frame = requestAnimationFrame(this.render);
		}
	}

	private render = (now: number): void => {
		this.frame = 0;
		const windowed = [...this.previews].filter((p) => p.visible && p.model);
		if (!windowed.length) return;
		if (!this.renderer) {
			try {
				this.renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});
				this.renderer.setSize(PRODUCT_PREVIEW_SIZE, PRODUCT_PREVIEW_SIZE, false);
				this.renderer.outputColorSpace = THREE.SRGBColorSpace;
				this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
				this.renderer.localClippingEnabled = true;
			} catch {
				this.failed = true;
				return;
			}
		}
		let drawn = 0;
		for (let n = 0; n < windowed.length && drawn < FRAMES_PER_TICK; n++) {
			const preview = windowed[this.cursor++ % windowed.length];
			const model = preview.model!;
			const first = !Number.isFinite(preview.lastFrame);
			const still = this.reducedMotion.matches;
			if (!first && (still || now - preview.lastFrame < FRAME_INTERVAL)) continue;
			const pose = preview.focus;
			if (!first && !still) preview.angleTime += Math.min(170, now - preview.lastFrame);
			if (pose === 'face') model.rotation.y = Math.sin(preview.angleTime * .0010) * .25;
			else if (pose === 'hair') model.rotation.y = Math.sin(.45 + preview.angleTime * .00105) * .72;
			else model.rotation.y = .34 + preview.angleTime * .00085;
			this.camera.position.set(0, pose === 'face' ? .22 : pose === 'hair' ? .55 : pose === 'bottom' ? .43 : 1.65, 5);
			this.camera.lookAt(0, 0, 0);
			this.scene.add(model);
			this.renderer.render(this.scene, this.camera);
			preview.target.clearRect(0, 0, PRODUCT_PREVIEW_SIZE, PRODUCT_PREVIEW_SIZE);
			preview.target.drawImage(this.renderer.domElement, 0, 0);
			model.removeFromParent();
			preview.lastFrame = now;
			drawn++;
			if (first) preview.painted();
		}
		this.schedule();
	};

	private releaseRenderer(): void {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.renderer?.dispose();
		this.renderer?.forceContextLoss();
		this.renderer = null;
	}
}

let previews: ProductPreviewRenderer | undefined;

export function attachProductPreview(...args: Parameters<ProductPreviewRenderer['add']>): () => void {
	previews ??= new ProductPreviewRenderer();
	return previews.add(...args);
}
