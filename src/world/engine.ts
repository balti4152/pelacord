/**
 * Motor del mundo 3D (three.js): salas, avatares, caminar con clic, sentarse, placas con nombre,
 * gestos, pantalla con video y decoración de la casa. La interfaz (React) vive en WorldView.
 *
 * Ejes: glTF Y-arriba; los avatares y los asientos miran a +Z. La cámara mira desde -Z (la "puerta").
 */
import * as THREE from 'three';
import {CSS2DObject, CSS2DRenderer} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {Avatar, loadGLB} from '@/world/avatars';
import {type Anim, type Catalog, type Emote, HOUSE_GLB, type Look, type PlacedFurniture, type PlayerState, ROOMS, type RoomId} from '@/world/core';

const WALK_SPEED = 1.9;
/** Las luces vienen en vatios de Blender: se pasan a una escala que se vea parecida en la web. */
const POINT_LIGHT_SCALE = 0.0022;

interface Bounds {
	kind: 'box' | 'circle';
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	radius: number;
}

const BOUNDS: Record<string, Bounds> = {
	living: {kind: 'box', minX: -3.6, maxX: 3.6, minZ: -3.2, maxZ: 3.1, radius: 0},
	cinema: {kind: 'box', minX: -4.1, maxX: 4.1, minZ: -5.2, maxZ: 4.0, radius: 0},
	campfire: {kind: 'circle', minX: 0, maxX: 0, minZ: 0, maxZ: 0, radius: 4.4},
	shop: {kind: 'box', minX: -4.6, maxX: 4.6, minZ: -4.4, maxZ: 3.9, radius: 0},
	house: {kind: 'box', minX: -4.1, maxX: 4.1, minZ: -3.7, maxZ: 3.6, radius: 0},
};

export interface EngineCallbacks {
	onLocalChange(state: {x: number; z: number; ry: number; anim: Anim; seat: string | null; tx: number; tz: number}): void;
	onHotspot(kind: string): void;
	onPlayerClick(id: string): void;
	onPlace(x: number, z: number, rot: number): void;
	onFurnitureClick(uid: string): void;
}

interface Actor {
	id: string;
	avatar: Avatar;
	label: CSS2DObject;
	labelEl: HTMLDivElement;
	pos: THREE.Vector3;
	target: THREE.Vector3;
	ry: number;
	seat: string | null;
	look: Look;
	anim: Anim;
}

interface Seat {
	id: string;
	object: THREE.Object3D;
	ring: THREE.Mesh;
	hit: THREE.Mesh;
}

function makeLabel(name: string, color: string, avatarUrl?: string): {el: HTMLDivElement; obj: CSS2DObject} {
	const el = document.createElement('div');
	el.className = 'w-name';
	const face = document.createElement('span');
	face.className = 'w-name-face';
	face.style.background = color;
	if (avatarUrl) {
		const img = document.createElement('img');
		img.src = avatarUrl;
		img.alt = '';
		img.onerror = () => img.remove();
		face.append(img);
	} else {
		face.textContent = name.slice(0, 1).toUpperCase();
	}
	const text = document.createElement('span');
	text.className = 'w-name-text';
	text.textContent = name;
	const waves = document.createElement('span');
	waves.className = 'w-waves';
	waves.innerHTML = '<i></i><i></i><i></i>';
	el.append(face, text, waves);
	const obj = new CSS2DObject(el);
	obj.position.set(0, 1.62, 0);
	return {el, obj};
}

function lighten(hex: string, amount = 0.18): THREE.Color {
	const color = new THREE.Color(hex);
	const hsl = {h: 0, s: 0, l: 0};
	color.getHSL(hsl);
	return new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + amount));
}

export class WorldEngine {
	private renderer: THREE.WebGLRenderer;
	private labels: CSS2DRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
	private clock = new THREE.Clock();
	private raycaster = new THREE.Raycaster();
	private roomGroup = new THREE.Group();
	private furnitureGroup = new THREE.Group();
	private actorsGroup = new THREE.Group();
	private seats: Seat[] = [];
	private hotspots: CSS2DObject[] = [];
	private me: Actor | null = null;
	private meId = '';
	private others = new Map<string, Actor>();
	private room: RoomId | null = null;
	private bounds: Bounds = BOUNDS.living;
	private spawn = new THREE.Vector3(0, 0, -2.5);
	private camTarget = new THREE.Vector3();
	private zoom = 1;
	private frame = 0;
	private screenMesh: THREE.Mesh | null = null;
	private screenOriginal: THREE.Material | null = null;
	private screenStream: MediaStream | null = null;
	private screenVideo: HTMLVideoElement | null = null;
	private speaking = new Set<string>();
	private pendingSeat: Seat | null = null;
	private decorating: {id: string; color?: string | null; rot: number} | null = null;
	private ghost: THREE.Object3D | null = null;
	private ghostToken = 0;
	private loadToken = 0;
	private furnitureClickable = new Map<THREE.Object3D, string>();
	private resizeObserver: ResizeObserver;
	private pointerDown: {x: number; y: number} | null = null;
	private disposed = false;

	constructor(private container: HTMLElement, private catalog: Catalog, private cb: EngineCallbacks) {
		this.renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.05;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.renderer.domElement.className = 'w-canvas';
		container.append(this.renderer.domElement);
		this.labels = new CSS2DRenderer();
		this.labels.domElement.className = 'w-labels';
		container.append(this.labels.domElement);

		this.scene.add(this.roomGroup, this.furnitureGroup, this.actorsGroup);
		// Luz base "cozy": cielo violeta suave + un sol tibio con sombras blandas.
		this.scene.add(new THREE.HemisphereLight(0xd9ccff, 0x3a2552, 1.25));
		const sun = new THREE.DirectionalLight(0xfff0dd, 1.5);
		sun.position.set(-4, 9, -6);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		sun.shadow.camera.left = -9;
		sun.shadow.camera.right = 9;
		sun.shadow.camera.top = 9;
		sun.shadow.camera.bottom = -9;
		sun.shadow.radius = 4;
		sun.shadow.bias = -0.0008;
		this.scene.add(sun, sun.target);

		const canvas = this.renderer.domElement;
		canvas.addEventListener('pointerdown', this.onPointerDown);
		canvas.addEventListener('pointerup', this.onPointerUp);
		canvas.addEventListener('pointermove', this.onPointerMove);
		canvas.addEventListener('wheel', this.onWheel, {passive: true});
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(container);
		this.resize();
		this.loop();
	}

	// ------------------------------------------------------------ salas ----

	async loadRoom(room: RoomId, house: PlacedFurniture[] | null): Promise<void> {
		const token = ++this.loadToken;
		this.room = room;
		const isHouse = room.startsWith('house:');
		const def = ROOMS.find((r) => r.id === room);
		const gltf = await loadGLB(isHouse ? HOUSE_GLB : (def?.glb ?? ROOMS[0].glb));
		if (token !== this.loadToken || this.disposed) return;
		this.clearRoom();
		const scene = gltf.scene.clone(true);
		this.bounds = BOUNDS[isHouse ? 'house' : room] ?? BOUNDS.living;
		this.prepareScene(scene, false);
		this.roomGroup.add(scene);
		const spawn = scene.getObjectByName('Spawn');
		if (spawn) spawn.getWorldPosition(this.spawn);
		else this.spawn.set(0, 0, -2.5);
		this.collectSeats(scene, '');
		this.collectHotspots(scene);
		this.screenMesh = (scene.getObjectByName('Screen') as THREE.Mesh) ?? null;
		this.screenOriginal = this.screenMesh ? (this.screenMesh.material as THREE.Material) : null;
		this.applyScreen();
		if (isHouse) await this.setHouse(house ?? []);
		if (this.me) {
			this.me.pos.copy(this.spawn);
			this.me.target.copy(this.spawn);
			this.me.seat = null;
			this.me.avatar.setBase('idle');
			this.me.ry = Math.PI;
			this.announce();
		}
		this.camTarget.copy(this.spawn);
	}

	private clearRoom(): void {
		this.roomGroup.clear();
		this.furnitureGroup.clear();
		for (const seat of this.seats) {
			seat.ring.removeFromParent();
			seat.hit.removeFromParent();
		}
		this.seats = [];
		for (const hotspot of this.hotspots) hotspot.removeFromParent();
		this.hotspots = [];
		this.furnitureClickable.clear();
		this.screenMesh = null;
	}

	/** Sombras, luces escaladas y materiales listos para la web. */
	private prepareScene(root: THREE.Object3D, isFurniture: boolean): void {
		root.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (mesh.isMesh) {
				mesh.castShadow = isFurniture || !/Room|Floor|Ground|Clearing|Rug|Plank/i.test(mesh.name);
				mesh.receiveShadow = true;
			}
			const light = obj as THREE.Light;
			if ((light as THREE.PointLight).isPointLight || (light as THREE.SpotLight).isSpotLight) {
				light.intensity *= POINT_LIGHT_SCALE;
				(light as THREE.PointLight).distance = 9;
				(light as THREE.PointLight).decay = 1.6;
				light.castShadow = false;
			} else if ((light as THREE.DirectionalLight).isDirectionalLight) {
				light.intensity = Math.min(light.intensity, 0.8);
				light.castShadow = false;
			}
		});
	}

	private collectSeats(root: THREE.Object3D, prefix: string): void {
		const seats: THREE.Object3D[] = [];
		root.traverse((obj) => {
			if (obj.name.startsWith('Seat_') || obj.userData?.pelacord_seat) seats.push(obj);
		});
		root.updateMatrixWorld(true);
		for (const object of seats) {
			const ring = new THREE.Mesh(
				new THREE.TorusGeometry(0.17, 0.012, 8, 40),
				new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.85}),
			);
			ring.rotation.x = -Math.PI / 2;
			const hit = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({visible: false}));
			hit.rotation.x = -Math.PI / 2;
			const pos = new THREE.Vector3();
			object.getWorldPosition(pos);
			ring.position.copy(pos).add(new THREE.Vector3(0, 0.05, 0));
			hit.position.copy(ring.position);
			this.scene.add(ring, hit);
			const seat: Seat = {id: prefix + object.name, object, ring, hit};
			hit.userData.seat = seat;
			this.seats.push(seat);
		}
	}

	private collectHotspots(root: THREE.Object3D): void {
		const labels: Record<string, string> = {clothes: '👕 Ropa y estilo', furniture: '🛋️ Muebles', counter: '🪙 Caja', fitting: '🪞 Probador'};
		root.traverse((obj) => {
			const kind = obj.userData?.pelacord_hotspot as string | undefined;
			if (!kind) return;
			const el = document.createElement('button');
			el.type = 'button';
			el.className = 'w-hotspot';
			el.textContent = labels[kind] ?? kind;
			el.addEventListener('click', (event) => {
				event.stopPropagation();
				this.cb.onHotspot(kind);
			});
			const label = new CSS2DObject(el);
			obj.getWorldPosition(label.position);
			label.position.y += 1.4;
			this.scene.add(label);
			this.hotspots.push(label);
		});
	}

	/** Muebles de la casa (posición, giro y color de cada uno). */
	async setHouse(items: PlacedFurniture[]): Promise<void> {
		const token = this.loadToken;
		const placed = items.filter((i) => i.x !== null && i.z !== null);
		const models = await Promise.all(placed.map((item) => {
			const def = this.catalog.items.find((c) => c.id === item.id);
			return def?.glb ? loadGLB(def.glb).catch(() => null) : Promise.resolve(null);
		}));
		if (token !== this.loadToken || this.disposed) return;
		this.furnitureGroup.clear();
		this.seats = this.seats.filter((seat) => {
			if (!seat.id.includes(':')) return true;
			seat.ring.removeFromParent();
			seat.hit.removeFromParent();
			return false;
		});
		this.furnitureClickable.clear();
		placed.forEach((item, index) => {
			const gltf = models[index];
			if (!gltf) return;
			const obj = gltf.scene.clone(true);
			obj.position.set(item.x as number, 0, item.z as number);
			obj.rotation.y = item.rot;
			if (item.color) this.recolor(obj, item.color);
			this.prepareScene(obj, true);
			this.furnitureGroup.add(obj);
			obj.traverse((child) => this.furnitureClickable.set(child, item.uid));
			this.collectSeats(obj, `${item.uid}:`);
		});
	}

	private recolor(obj: THREE.Object3D, hex: string): void {
		obj.traverse((child) => {
			const mesh = child as THREE.Mesh;
			if (!mesh.isMesh) return;
			const mat = mesh.material as THREE.MeshStandardMaterial;
			if (mat.name === 'Base') mesh.material = Object.assign(mat.clone(), {color: new THREE.Color(hex)});
			else if (mat.name === 'BaseLight') mesh.material = Object.assign(mat.clone(), {color: lighten(hex)});
		});
	}

	// --------------------------------------------------------- jugadores ---

	async setMe(id: string, name: string, color: string, look: Look, avatarUrl?: string): Promise<void> {
		this.meId = id;
		if (this.me) {
			await this.me.avatar.setLook(look);
			this.me.look = look;
			this.me.labelEl.querySelector('.w-name-text')!.textContent = name;
			return;
		}
		this.me = this.createActor(id, name, color, look, avatarUrl);
		this.me.pos.copy(this.spawn);
		this.me.target.copy(this.spawn);
		this.me.ry = Math.PI;
		this.me.labelEl.classList.add('is-me');
		this.announce();
	}

	private createActor(id: string, name: string, color: string, look: Look, avatarUrl?: string): Actor {
		const avatar = new Avatar(this.catalog, look);
		const {el, obj} = makeLabel(name, color, avatarUrl);
		avatar.root.add(obj);
		avatar.root.userData.playerId = id;
		this.actorsGroup.add(avatar.root);
		return {id, avatar, label: obj, labelEl: el, pos: new THREE.Vector3(), target: new THREE.Vector3(), ry: 0, seat: null, look, anim: 'idle'};
	}

	/** Los demás jugadores de MI sala (los que están en otra se sacan). */
	syncPeers(states: PlayerState[], info: Record<string, {name: string; avatarUrl?: string}>): void {
		const here = states.filter((s) => s.room === this.room && s.id !== this.meId);
		const keep = new Set(here.map((s) => s.id));
		for (const [id, actor] of this.others) {
			if (keep.has(id)) continue;
			actor.avatar.dispose();
			actor.label.removeFromParent();
			this.others.delete(id);
		}
		for (const s of here) {
			let actor = this.others.get(s.id);
			const name = info[s.id]?.name ?? s.name;
			if (!actor) {
				actor = this.createActor(s.id, name, s.color, s.look, info[s.id]?.avatarUrl);
				actor.pos.set(s.x, 0, s.z);
				this.others.set(s.id, actor);
			}
			void actor.avatar.setLook(s.look);
			actor.look = s.look;
			actor.seat = s.seat;
			actor.anim = s.anim;
			actor.labelEl.querySelector('.w-name-text')!.textContent = name;
			const reported = new THREE.Vector3(s.x, 0, s.z);
			if (actor.pos.distanceTo(reported) > 1.6 || s.anim === 'sit') actor.pos.copy(reported);
			actor.target.set(s.tx ?? s.x, 0, s.tz ?? s.z);
			if (s.anim !== 'walk') actor.target.copy(reported);
			actor.ry = s.ry;
		}
	}

	setSpeaking(ids: Set<string>): void {
		this.speaking = ids;
	}

	emote(id: string, emote: Emote, target?: string | null): void {
		const actor = id === this.meId ? this.me : this.others.get(id);
		if (!actor) return;
		if (emote === 'wave') {
			actor.avatar.play('Wave');
			this.pop(actor, '👋', null);
		} else if (emote === 'slap') {
			actor.avatar.play('Slap');
			const victim = target ? (target === this.meId ? this.me : this.others.get(target)) : null;
			setTimeout(() => this.pop(victim ?? actor, null, 'sprites/slap.svg'), 380);
		} else if (emote === 'laugh') {
			actor.avatar.setTalking(true);
			setTimeout(() => actor.avatar.setTalking(this.speaking.has(actor.id)), 1400);
			this.pop(actor, null, 'sprites/jaja.svg');
		}
	}

	/** Viñeta de cómic que salta sobre la cabeza y se desvanece. */
	private pop(actor: Actor, text: string | null, image: string | null): void {
		const el = document.createElement('div');
		el.className = image ? 'w-pop is-sprite' : 'w-pop';
		if (image) {
			const img = document.createElement('img');
			img.src = image;
			img.alt = '';
			el.append(img);
		} else {
			el.textContent = text ?? '';
		}
		const obj = new CSS2DObject(el);
		obj.position.set(0, 2.0, 0);
		actor.avatar.root.add(obj);
		setTimeout(() => obj.removeFromParent(), 1400);
	}

	/** Mi jugador más cerca (para la cachetada). */
	nearestTo(maxDistance = 1.8): string | null {
		if (!this.me) return null;
		let best: string | null = null;
		let bestDistance = maxDistance;
		for (const [id, actor] of this.others) {
			const distance = actor.pos.distanceTo(this.me.pos);
			if (distance < bestDistance) {
				best = id;
				bestDistance = distance;
			}
		}
		return best;
	}

	positions(): {me: {x: number; z: number; ry: number}; peers: Record<string, {x: number; z: number}>} {
		const peers: Record<string, {x: number; z: number}> = {};
		for (const [id, actor] of this.others) peers[id] = {x: actor.pos.x, z: actor.pos.z};
		return {me: {x: this.me?.pos.x ?? 0, z: this.me?.pos.z ?? 0, ry: this.me?.ry ?? 0}, peers};
	}

	// ------------------------------------------------------------ pantalla --

	setScreen(stream: MediaStream | null): void {
		if (stream === this.screenStream) return;
		this.screenStream = stream;
		this.applyScreen();
	}

	private applyScreen(): void {
		if (!this.screenMesh) return;
		if (!this.screenStream) {
			if (this.screenOriginal) this.screenMesh.material = this.screenOriginal;
			this.screenVideo?.pause();
			return;
		}
		const video = this.screenVideo ?? document.createElement('video');
		video.muted = true;
		video.playsInline = true;
		video.srcObject = this.screenStream;
		void video.play().catch(() => {});
		this.screenVideo = video;
		const texture = new THREE.VideoTexture(video);
		texture.colorSpace = THREE.SRGBColorSpace;
		// La pantalla es una caja: se ajusta para que el video quede derecho mirando a la cámara.
		texture.wrapS = THREE.RepeatWrapping;
		texture.repeat.x = -1;
		this.screenMesh.material = new THREE.MeshBasicMaterial({map: texture, toneMapped: false});
	}

	// ----------------------------------------------------------- decorar ---

	setDecorating(item: {id: string; color?: string | null; rot: number} | null): void {
		this.decorating = item;
		this.ghost?.removeFromParent();
		this.ghost = null;
		const token = ++this.ghostToken;
		if (!item) return;
		const def = this.catalog.items.find((c) => c.id === item.id);
		if (!def?.glb) return;
		void loadGLB(def.glb).then((gltf) => {
			if (token !== this.ghostToken || !this.decorating) return;
			const ghost = gltf.scene.clone(true);
			ghost.traverse((child) => {
				const mesh = child as THREE.Mesh;
				if (!mesh.isMesh) return;
				const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
				mat.transparent = true;
				mat.opacity = 0.55;
				if (item.color && (mat.name === 'Base' || mat.name === 'BaseLight')) mat.color.set(item.color);
				mesh.material = mat;
			});
			ghost.traverse((child) => {
				if ((child as THREE.Light).isLight) child.visible = false;
			});
			ghost.rotation.y = item.rot;
			this.ghost = ghost;
			this.scene.add(ghost);
		});
	}

	rotateGhost(): void {
		if (!this.decorating) return;
		this.decorating.rot = (this.decorating.rot + Math.PI / 4) % (Math.PI * 2);
		if (this.ghost) this.ghost.rotation.y = this.decorating.rot;
	}

	// ------------------------------------------------------------ entrada ---

	private onPointerDown = (event: PointerEvent): void => {
		this.pointerDown = {x: event.clientX, y: event.clientY};
	};

	private onPointerMove = (event: PointerEvent): void => {
		if (!this.ghost) return;
		const point = this.floorPoint(event);
		if (point) this.ghost.position.copy(point);
	};

	private onWheel = (event: WheelEvent): void => {
		this.zoom = THREE.MathUtils.clamp(this.zoom + Math.sign(event.deltaY) * 0.08, 0.55, 1.5);
	};

	private ndc(event: PointerEvent): THREE.Vector2 {
		const rect = this.renderer.domElement.getBoundingClientRect();
		return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
	}

	private floorPoint(event: PointerEvent): THREE.Vector3 | null {
		this.raycaster.setFromCamera(this.ndc(event), this.camera);
		const point = new THREE.Vector3();
		if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) return null;
		return this.clamp(point);
	}

	private clamp(point: THREE.Vector3): THREE.Vector3 {
		const b = this.bounds;
		if (b.kind === 'circle') {
			const length = Math.hypot(point.x, point.z);
			if (length > b.radius) point.multiplyScalar(b.radius / length);
		} else {
			point.x = THREE.MathUtils.clamp(point.x, b.minX, b.maxX);
			point.z = THREE.MathUtils.clamp(point.z, b.minZ, b.maxZ);
		}
		point.y = 0;
		return point;
	}

	private onPointerUp = (event: PointerEvent): void => {
		const down = this.pointerDown;
		this.pointerDown = null;
		if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6 || event.button !== 0) return;
		this.raycaster.setFromCamera(this.ndc(event), this.camera);
		if (this.decorating) {
			const point = this.floorPoint(event);
			if (point) this.cb.onPlace(point.x, point.z, this.decorating.rot);
			return;
		}
		// 1) un asiento libre
		const seatHits = this.raycaster.intersectObjects(this.seats.filter((s) => s.ring.visible).map((s) => s.hit), false);
		if (seatHits.length) {
			this.goToSeat(seatHits[0].object.userData.seat as Seat);
			return;
		}
		// 2) otro jugador
		const actorHits = this.raycaster.intersectObjects([...this.others.values()].map((a) => a.avatar.root), true);
		if (actorHits.length) {
			let obj: THREE.Object3D | null = actorHits[0].object;
			while (obj && !obj.userData.playerId) obj = obj.parent;
			if (obj?.userData.playerId) {
				this.cb.onPlayerClick(obj.userData.playerId as string);
				return;
			}
		}
		// 3) un mueble de la casa (para moverlo o guardarlo)
		if (this.room === `house:${this.meId}` && this.furnitureClickable.size) {
			const hits = this.raycaster.intersectObjects(this.furnitureGroup.children, true);
			const uid = hits.length ? this.furnitureClickable.get(hits[0].object) : undefined;
			if (uid && event.shiftKey) {
				this.cb.onFurnitureClick(uid);
				return;
			}
		}
		// 4) el piso: caminar hasta ahí
		const point = this.floorPoint(event);
		if (point) this.walkTo(point);
	};

	walkTo(point: THREE.Vector3): void {
		if (!this.me) return;
		this.pendingSeat = null;
		if (this.me.seat) {
			// Pararse del asiento: un pasito adelante.
			this.me.seat = null;
		}
		this.me.target.copy(point);
		this.me.avatar.setBase('walk');
		this.me.anim = 'walk';
		this.announce();
	}

	private goToSeat(seat: Seat): void {
		if (!this.me) return;
		const pos = new THREE.Vector3();
		seat.object.getWorldPosition(pos);
		const dir = new THREE.Vector3();
		seat.object.getWorldDirection(dir);
		// Se camina hasta el frente del asiento y ahí se sienta.
		const front = pos.clone().add(dir.multiplyScalar(0.55));
		front.y = 0;
		this.walkTo(this.clamp(front));
		this.pendingSeat = seat;
	}

	private sit(seat: Seat): void {
		if (!this.me) return;
		const pos = new THREE.Vector3();
		seat.object.getWorldPosition(pos);
		const dir = new THREE.Vector3();
		seat.object.getWorldDirection(dir);
		this.me.pos.copy(pos);
		this.me.target.copy(pos);
		this.me.ry = Math.atan2(dir.x, dir.z);
		this.me.seat = seat.id;
		this.me.anim = 'sit';
		this.me.avatar.setBase('sit');
		this.announce();
	}

	private announce(): void {
		if (!this.me) return;
		this.cb.onLocalChange({x: this.me.pos.x, z: this.me.pos.z, ry: this.me.ry, anim: this.me.anim, seat: this.me.seat, tx: this.me.target.x, tz: this.me.target.z});
	}

	// ------------------------------------------------------------- cuadro ---

	private loop = (): void => {
		if (this.disposed) return;
		this.frame = requestAnimationFrame(this.loop);
		const dt = Math.min(0.05, this.clock.getDelta());
		const t = this.clock.elapsedTime;
		if (this.me) this.step(this.me, dt, true);
		for (const actor of this.others.values()) this.step(actor, dt, false);

		// Anillos de "sentate acá": sólo en asientos libres, latiendo suave.
		const taken = new Set<string>([...this.others.values()].map((a) => a.seat).filter(Boolean) as string[]);
		if (this.me?.seat) taken.add(this.me.seat);
		for (const seat of this.seats) {
			const free = !taken.has(seat.id);
			seat.ring.visible = free;
			seat.hit.visible = free;
			const s = 1 + Math.sin(t * 3 + seat.ring.position.x) * 0.06;
			seat.ring.scale.set(s, s, s);
		}

		// La cámara sigue suave a mi personaje (vista alta, estilo Club Penguin).
		const focus = this.me ? this.me.pos : this.spawn;
		this.camTarget.lerp(new THREE.Vector3(focus.x * 0.6, 0, focus.z * 0.55), 1 - Math.pow(0.02, dt));
		const offset = new THREE.Vector3(0, 6.2, -8.4).multiplyScalar(this.zoom * (this.room === 'campfire' || this.room === 'cinema' ? 1.15 : 1));
		this.camera.position.copy(this.camTarget).add(offset);
		this.camera.lookAt(this.camTarget.x, 0.7, this.camTarget.z);

		this.renderer.render(this.scene, this.camera);
		this.labels.render(this.scene, this.camera);
	};

	private step(actor: Actor, dt: number, mine: boolean): void {
		const toTarget = actor.target.clone().sub(actor.pos);
		toTarget.y = 0;
		const distance = toTarget.length();
		if (actor.anim === 'walk' || (!mine && distance > 0.05 && actor.anim !== 'sit')) {
			if (distance > 0.04) {
				const stepLength = Math.min(distance, WALK_SPEED * dt);
				actor.pos.add(toTarget.normalize().multiplyScalar(stepLength));
				const wanted = Math.atan2(toTarget.x, toTarget.z);
				let delta = wanted - actor.ry;
				delta = Math.atan2(Math.sin(delta), Math.cos(delta));
				actor.ry += delta * Math.min(1, dt * 12);
				actor.avatar.setBase('walk');
			} else if (mine) {
				actor.anim = 'idle';
				actor.avatar.setBase('idle');
				const seat = this.pendingSeat;
				this.pendingSeat = null;
				if (seat) this.sit(seat);
				else this.announce();
			} else {
				actor.avatar.setBase(actor.anim === 'walk' ? 'idle' : actor.anim);
			}
		} else {
			actor.avatar.setBase(actor.anim);
		}
		actor.avatar.root.position.copy(actor.pos);
		actor.avatar.root.rotation.y = actor.ry;
		const talking = this.speaking.has(actor.id);
		actor.avatar.setTalking(talking);
		actor.labelEl.classList.toggle('is-speaking', talking);
		actor.avatar.update(dt);
	}

	private resize(): void {
		const width = this.container.clientWidth || 1;
		const height = this.container.clientHeight || 1;
		this.renderer.setSize(width, height, false);
		this.labels.setSize(width, height);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.frame);
		this.resizeObserver.disconnect();
		this.me?.avatar.dispose();
		for (const actor of this.others.values()) actor.avatar.dispose();
		this.screenVideo?.pause();
		this.renderer.dispose();
		this.renderer.domElement.remove();
		this.labels.domElement.remove();
	}
}
