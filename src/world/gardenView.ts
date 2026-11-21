import * as THREE from 'three';
import {loadGLB} from '@/world/avatars';
import {CROPS, LOTS, growth, plotPosition, type FarmAction, type FarmLand, type Plot} from '@/world/farmData';

const FILLS = {lot: 0xe2f59d, target: 0xffe9a7, water: 0x8ee8ff};
const HIDDEN_AGE = 1.05;
const FULL_LOT = LOTS[LOTS.length - 1];
const TEMPLATE_CAPACITY = (FULL_LOT.right - FULL_LOT.left + 1) * (FULL_LOT.back - FULL_LOT.front + 1);
type PlotMesh = {instances: THREE.InstancedMesh; transform: THREE.Matrix4};

function outline(color: number): THREE.LineLoop {
	const points = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
	const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
	return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.85}));
}

function plantModel(plot: Plot, now: number): string | undefined {
	if (!plot.crop) return;
	const ratio = growth(plot, now);
	const stage = ratio >= 1 ? 'Ripe' : ratio >= 0.42 ? 'Growing' : 'Seedling';
	return CROPS[plot.crop].model + '_' + stage;
}

export class GardenView {
	readonly root = new THREE.Group();
	private readonly extent = outline(FILLS.lot);
	private readonly cursor = outline(FILLS.target);
	private readonly plants = new THREE.Group();
	private readonly models = new Map<string, THREE.Object3D>();
	private shown = new Map<string, {visual: string}>();
	private readonly batches = new Map<string, PlotMesh[]>();
	private land: FarmLand | null = null;
	private loading = false;
	private disposed = false;
	private scan = 0;
	private readonly tool = new THREE.Group();
	private readonly drops = new Float32Array(18 * 3);
	private readonly spray = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({color: FILLS.water, size: 0.065, transparent: true, opacity: 0.84}));
	private animationAge = HIDDEN_AGE;
	private sprayOn = false;

	constructor() {
		this.spray.geometry.setAttribute('position', new THREE.BufferAttribute(this.drops, 3));
		this.spray.frustumCulled = false;
		this.root.add(this.plants, this.extent, this.cursor, this.tool, this.spray);
		this.root.visible = this.cursor.visible = this.spray.visible = false;
	}

	set(land: FarmLand | null): void {
		this.land = land;
		this.root.visible = Boolean(land);
		if (!land) {
			this.cursor.visible = false;
			this.tool.clear();
			this.spray.visible = false;
			this.animationAge = HIDDEN_AGE;
		} else {
			const {left, right, front, back} = LOTS[land.level];
			this.extent.position.set((left + right) / 2, 0.035, (front + back) / 2);
			this.extent.scale.set(right - left + 1, 1, back - front + 1);
			if (!this.models.size && !this.loading) {
				this.loading = true;
				void loadGLB('models/farm_assets.glb').then((gltf) => {
					if (this.disposed) return;
					gltf.scene.updateMatrixWorld(true);
					gltf.scene.traverse((obj) => {
						if (typeof obj.userData.farm_model === 'string') this.models.set(obj.userData.farm_model, obj);
					});
					this.sync();
				}).catch((error: unknown) => console.warn('Modelos de la huerta', error)).finally(() => { this.loading = false; });
			}
		}
		this.sync();
	}

	point(x?: number, z?: number, allowed = true): void {
		this.cursor.visible = x !== undefined && z !== undefined && Boolean(this.land);
		if (!this.cursor.visible) return;
		this.cursor.position.set(x!, 0.12, z!);
		(this.cursor.material as THREE.LineBasicMaterial).color.setHex(allowed ? FILLS.target : 0xffa18d);
	}

	animate(action: FarmAction, x: number, z: number): void {
		this.tool.clear();
		this.animationAge = 0;
		const tool = this.models.get(action === 'hoe' ? 'Hoe' : action === 'can' ? 'WateringCan' : '');
		if (tool) this.tool.add(tool.clone(true));
		this.tool.position.set(x + 0.17, 0, z - 0.16);
		this.spray.position.set(x, 0, z);
		this.sprayOn = action === 'can' || action === 'sprinkler';
	}

	tick(dt: number): void {
		if (!this.land) return;
		this.scan += dt;
		if (this.scan >= 0.7) {
			this.scan = 0;
			this.sync();
		}
		this.animationAge += dt;
		const p = Math.min(1, this.animationAge / HIDDEN_AGE);
		this.tool.visible = p < 1;
		this.tool.position.y = 0.09 + Math.sin(p * Math.PI) * 0.23;
		this.tool.rotation.set(-0.25 + Math.sin(p * Math.PI) * 0.65, 0.3, -1.3 * Math.sin(p * Math.PI));
		this.spray.visible = p < 1 && this.sprayOn;
		if (!this.spray.visible) return;
		for (let i = 0; i < this.drops.length / 3; i++) {
			const angle = i * 2.39996;
			const f = Math.max(0, p - (i % 5) * 0.045);
			this.drops[i * 3] = Math.cos(angle) * f * 0.82;
			this.drops[i * 3 + 1] = 0.11 + Math.sin(Math.min(1, f) * Math.PI) * (0.27 + (i % 4) * 0.095);
			this.drops[i * 3 + 2] = Math.sin(angle) * f * 0.77;
		}
		this.spray.geometry.attributes.position.needsUpdate = true;
		this.spray.material.opacity = (1 - p) * 0.9;
	}

	private sync(): void {
		if (!this.models.size) return;
		const now = Date.now();
		const current = new Map<string, {visual: string}>();
		const placements = new Map<string, Array<[number, number]>>();
		let changed = false;
		for (const [key, plot] of Object.entries(this.land?.plots ?? {})) {
			const plant = plantModel(plot, now);
			const soil = plot.wateredAt ? 'Plot_Wet' : 'Plot_Dry';
			const visual = plot.sprinkler ? 'Sprinkler' : [soil, plant].join(':');
			current.set(key, {visual});
			if (this.shown.get(key)?.visual !== visual) changed = true;
			for (const name of plot.sprinkler ? ['Plot_Dry', 'Sprinkler'] : [soil, plant]) {
				if (!name) continue;
				const list = placements.get(name) ?? [];
				list.push(plotPosition(key));
				placements.set(name, list);
			}
		}
		if (!changed && current.size === this.shown.size) return;
		this.shown = current;
		for (const [name, cells] of placements) if (!this.batches.has(name) && cells.length) this.createBatch(name);
		const matrix = new THREE.Matrix4();
		for (const [name, batch] of this.batches) {
			const cells = placements.get(name) ?? [];
			for (const {instances, transform} of batch) {
				instances.count = cells.length;
				instances.visible = cells.length > 0;
				cells.forEach(([x, z], i) => instances.setMatrixAt(i, matrix.makeTranslation(x, 0.04, z).multiply(transform)));
				instances.instanceMatrix.needsUpdate = true;
				instances.computeBoundingSphere();
			}
		}
	}

	private createBatch(name: string): void {
		const batch: PlotMesh[] = [];
		this.models.get(name)?.traverse((child) => {
			const mesh = child as THREE.Mesh;
			if (!mesh.isMesh) return;
			const instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, TEMPLATE_CAPACITY);
			instances.name = name;
			instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			instances.castShadow = !name.startsWith('Plot_');
			instances.receiveShadow = true;
			this.plants.add(instances);
			batch.push({instances, transform: mesh.matrixWorld.clone()});
		});
		this.batches.set(name, batch);
	}

	dispose(): void {
		this.disposed = true;
		this.set(null);
		for (const line of [this.extent, this.cursor]) {
			line.geometry.dispose();
			(line.material as THREE.Material).dispose();
		}
		this.spray.geometry.dispose();
		this.spray.material.dispose();
		for (const batch of this.batches.values()) for (const {instances} of batch) instances.dispose();
		this.root.removeFromParent();
	}
}

