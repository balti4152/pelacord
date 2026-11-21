/**
 * Motor del mundo 3D (three.js). Ciudad + locales, caminar con WASD, carteles "E para…",
 * sentarse, puertas, NPC, tele, mesa de juegos, placas con nombre, gestos y decorar la casa.
 * La interfaz (React) vive en WorldView; acá sólo hay 3D y entrada.
 *
 * Ejes: glTF Y-arriba; avatares y asientos miran a +Z. La cámara mira desde -Z.
 */
import * as THREE from 'three';
import {CSS2DObject, CSS2DRenderer} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {Avatar, loadGLB} from '@/world/avatars';
import {type Anim, type Catalog, DEFAULT_LOOK, type Emote, HOUSE_GLB, type Look, type PlacedFurniture, type PlayerState, ROOMS, type RoomId} from '@/world/core';
import {iconSvg} from '@/world/icons';

const WALK_SPEED = 2.5;
const RUN_SPEED = 4.0;
const POINT_LIGHT_SCALE = 0.0022;
const SEAT_RANGE = 1.15;
const DOOR_RANGE = 1.6;

interface Bounds {
	kind: 'box' | 'circle';
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	radius: number;
	obstacles: Array<{x: number; z: number; r: number}>;
}

const box = (minX: number, maxX: number, minZ: number, maxZ: number, obstacles: Bounds['obstacles'] = []): Bounds => ({kind: 'box', minX, maxX, minZ, maxZ, radius: 0, obstacles});
const BOUNDS: Record<string, Bounds> = {
	city: box(-15.5, 15.5, -11.5, 6.6, [{x: 0, z: 0, r: 2.05}]),
	living: box(-3.6, 3.6, -3.3, 3.1, [{x: 0.1, z: 0.1, r: 0.6}]),
	cinema: box(-4.1, 4.1, -5.2, 4.0),
	campfire: {kind: 'circle', minX: 0, maxX: 0, minZ: 0, maxZ: 0, radius: 4.6, obstacles: [{x: 0, z: 0, r: 0.85}]},
	shop: box(-4.6, 4.6, -4.4, 2.6),
	games: box(-4.6, 4.6, -4.2, 4.1, [{x: 0, z: 0.5, r: 1.3}]),
	house: box(-4.1, 4.1, -3.7, 3.6),
};

export type Interaction =
	| {kind: 'seat'; id: string; label: string}
	| {kind: 'door'; room: RoomId; label: string}
	| {kind: 'exit'; label: string}
	| {kind: 'tv'; label: string}
	| {kind: 'npc'; label: string}
	| {kind: 'hotspot'; hotspot: string; label: string}
	| {kind: 'stand'; label: string};

export interface EngineCallbacks {
	onLocalChange(state: {x: number; z: number; ry: number; anim: Anim; seat: string | null; tx: number; tz: number}): void;
	onDoor(room: RoomId): void;
	onInteract(action: Interaction): void;
	onTable(seatIndex: number | null): void;
	onPlayerClick(id: string): void;
	onPlace(x: number, z: number, rot: number): void;
	onFurniturePick(uid: string): void;
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
	table: number | null;
}

interface Door {
	room: RoomId;
	pos: THREE.Vector3;
	ry: number;
	name: string;
}

const ROOM_TITLES: Record<string, string> = {living: 'el Living', cinema: 'el Cine', campfire: 'el Campamento', shop: 'la Tienda', games: 'la Casa de juegos', house: 'Mi casa'};

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
	obj.position.set(0, 1.74, 0);
	return {el, obj};
}

function lighten(hex: string, amount = 0.18): THREE.Color {
	const color = new THREE.Color(hex);
	const hsl = {h: 0, s: 0, l: 0};
	color.getHSL(hsl);
	return new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + amount));
}

const NPC_LOOK: Look = {
	...DEFAULT_LOOK, body: 'F', hair: 'hair_buns', eyes: 'eyes_lash', mouth: 'mouth_smile', cheeks: 'cheeks_blush', top: 'top_hoodie', bottom: 'bottom_skirt',
	colors: {skin: '#e0a476', hair: '#a8322a', top: '#f5b326', bottom: '#2f3b78', shoes: '#f4f4f4', sole: '#ff7350'},
};

export class WorldEngine {
	private renderer: THREE.WebGLRenderer;
	private labels: CSS2DRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 150);
	private clock = new THREE.Clock();
	private raycaster = new THREE.Raycaster();
	private roomGroup = new THREE.Group();
	private furnitureGroup = new THREE.Group();
	private actorsGroup = new THREE.Group();
	/** Lo que pone el juego de mesa (cartas, fichas) sobre la mesa. */
	readonly tableRoot = new THREE.Group();
	private seats: Seat[] = [];
	private doors: Door[] = [];
	private hotspots: Array<{kind: string; pos: THREE.Vector3}> = [];
	private exitPoint: THREE.Vector3 | null = null;
	private tvPoint: THREE.Vector3 | null = null;
	private npc: Actor | null = null;
	private me: Actor | null = null;
	private meId = '';
	private others = new Map<string, Actor>();
	private room: RoomId | null = null;
	private bounds: Bounds = BOUNDS.city;
	private spawn = new THREE.Vector3(0, 0, -4.6);
	private camPos = new THREE.Vector3(0, 6, -12);
	private camLook = new THREE.Vector3();
	private zoom = 1;
	private frame = 0;
	private keys = new Set<string>();
	private prompt: CSS2DObject;
	private promptEl: HTMLDivElement;
	private current: Interaction | null = null;
	private promptAnchor = new THREE.Vector3();
	private screenMesh: THREE.Mesh | null = null;
	private screenOriginal: THREE.Material | null = null;
	private screenSource: {stream?: MediaStream | null; image?: string | null; title?: string | null} = {};
	private screenKey = '';
	private screenVideo: HTMLVideoElement | null = null;
	private speaking = new Set<string>();
	private decorating: {id: string; color?: string | null; rot: number} | null = null;
	private ghost: THREE.Object3D | null = null;
	private ghostToken = 0;
	private loadToken = 0;
	private furnitureClickable = new Map<THREE.Object3D, string>();
	private tableCenter: THREE.Vector3 | null = null;
	private tableSeat: number | null = null;
	private resizeObserver: ResizeObserver;
	private pointerDown: {x: number; y: number} | null = null;
	private lastAnnounce = 0;
	private moved = false;
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
		this.renderer.domElement.tabIndex = 0;
		container.append(this.renderer.domElement);
		this.labels = new CSS2DRenderer();
		this.labels.domElement.className = 'w-labels';
		container.append(this.labels.domElement);

		this.scene.add(this.roomGroup, this.furnitureGroup, this.actorsGroup, this.tableRoot);
		this.scene.add(new THREE.HemisphereLight(0xd9ccff, 0x3a2552, 1.25));
		const sun = new THREE.DirectionalLight(0xfff0dd, 1.5);
		sun.position.set(-4, 10, -6);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		Object.assign(sun.shadow.camera, {left: -12, right: 12, top: 12, bottom: -12});
		sun.shadow.radius = 4;
		sun.shadow.bias = -0.0008;
		this.scene.add(sun, sun.target);
		this.sun = sun;

		this.promptEl = document.createElement('div');
		this.promptEl.className = 'w-prompt';
		this.prompt = new CSS2DObject(this.promptEl);
		this.prompt.visible = false;
		this.scene.add(this.prompt);

		const canvas = this.renderer.domElement;
		canvas.addEventListener('pointerdown', this.onPointerDown);
		canvas.addEventListener('pointerup', this.onPointerUp);
		canvas.addEventListener('pointermove', this.onPointerMove);
		canvas.addEventListener('wheel', this.onWheel, {passive: true});
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(container);
		this.resize();
		this.loop();
		if (import.meta.env.DEV) (window as unknown as {__pelaWorld?: WorldEngine}).__pelaWorld = this;
	}

	private sun: THREE.DirectionalLight;

	// ------------------------------------------------------------ salas ----

	/** Carga una sala. `fromRoom`: si venís de un local a la ciudad, aparecés en su puerta. */
	async loadRoom(room: RoomId, house: PlacedFurniture[] | null, fromRoom: RoomId | null = null): Promise<void> {
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
		this.limitLights(scene, 6);
		this.roomGroup.add(scene);
		scene.updateMatrixWorld(true);
		const spawn = scene.getObjectByName('Spawn');
		if (spawn) spawn.getWorldPosition(this.spawn);
		else this.spawn.set(0, 0, -3);
		this.collectSeats(scene, '');
		this.collectMarkers(scene);
		this.screenMesh = (scene.getObjectByName('Screen') as THREE.Mesh) ?? null;
		this.screenOriginal = this.screenMesh ? (this.screenMesh.material as THREE.Material) : null;
		this.tvPoint = null;
		if (this.screenMesh) {
			const p = new THREE.Vector3();
			this.screenMesh.getWorldPosition(p);
			this.tvPoint = this.clamp(new THREE.Vector3(p.x, 0, p.z - 1.4));
		}
		this.screenKey = '';
		this.applyScreen();
		const table = scene.getObjectByName('GameTable');
		this.tableCenter = table ? table.getWorldPosition(new THREE.Vector3()) : null;
		this.tableRoot.position.copy(this.tableCenter ?? new THREE.Vector3(0, -50, 0));
		this.exitPoint = room === 'city' ? null : this.clamp(new THREE.Vector3(this.spawn.x, 0, this.spawn.z - 0.7));
		this.setupNpc(room === 'shop' ? scene.getObjectByName('Shopkeeper') : null);
		this.sun.position.set(-4, room === 'city' ? 16 : 10, -6);
		if (isHouse) await this.setHouse(house ?? []);
		if (this.me) {
			const arrival = room === 'city' && fromRoom ? this.doors.find((d) => d.room === (fromRoom.startsWith('house:') ? 'house' : fromRoom)) : null;
			this.me.pos.copy(arrival ? arrival.pos : this.spawn);
			this.me.target.copy(this.me.pos);
			this.me.ry = arrival ? arrival.ry : 0;
			this.me.seat = null;
			this.me.anim = 'idle';
			this.me.avatar.setBase('idle');
			this.leaveTable();
			this.announce(true);
			this.camPos.copy(this.cameraGoal());
		}
	}

	private clearRoom(): void {
		this.roomGroup.clear();
		this.furnitureGroup.clear();
		for (const seat of this.seats) seat.ring.removeFromParent();
		this.seats = [];
		this.doors = [];
		this.hotspots = [];
		this.furnitureClickable.clear();
		this.screenMesh = null;
		this.prompt.visible = false;
		this.current = null;
	}

	private prepareScene(root: THREE.Object3D, isFurniture: boolean): void {
		root.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (mesh.isMesh) {
				mesh.castShadow = isFurniture || !/Room|Floor|Ground|Clearing|Rug|Plank|Plaza|Street|Path|Trail|Stars/i.test(mesh.name);
				mesh.receiveShadow = true;
			}
			const light = obj as THREE.Light;
			if ((light as THREE.PointLight).isPointLight || (light as THREE.SpotLight).isSpotLight) {
				light.intensity *= POINT_LIGHT_SCALE;
				(light as THREE.PointLight).distance = 10;
				(light as THREE.PointLight).decay = 1.6;
				light.castShadow = false;
			} else if ((light as THREE.DirectionalLight).isDirectionalLight) {
				light.intensity = Math.min(light.intensity, 0.8);
				light.castShadow = false;
			}
		});
	}

	/**
	 * Deja sólo las luces puntuales más fuertes. Cada luz suma costo a TODOS los materiales: con los
	 * faroles de la ciudad (13 luces) una PC sin buena placa de video iba a tirones. Los faroles igual
	 * brillan (su lamparita es emisiva).
	 */
	private limitLights(root: THREE.Object3D, max: number): void {
		const lights: THREE.PointLight[] = [];
		root.traverse((obj) => {
			if ((obj as THREE.PointLight).isPointLight) lights.push(obj as THREE.PointLight);
		});
		lights.sort((a, b) => b.intensity - a.intensity);
		for (const light of lights.slice(max)) light.removeFromParent();
	}

	private collectSeats(root: THREE.Object3D, prefix: string): void {
		const found: THREE.Object3D[] = [];
		root.traverse((obj) => {
			if (obj.name.startsWith('Seat_')) found.push(obj);
		});
		root.updateMatrixWorld(true);
		for (const object of found) {
			const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.013, 8, 40), new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.85}));
			ring.rotation.x = -Math.PI / 2;
			const pos = object.getWorldPosition(new THREE.Vector3());
			ring.position.copy(pos).add(new THREE.Vector3(0, 0.05, 0));
			this.scene.add(ring);
			const match = /^Seat_Table_(\d+)/.exec(object.name);
			this.seats.push({id: prefix + object.name, object, ring, table: match ? Number(match[1]) : null});
		}
	}

	private collectMarkers(root: THREE.Object3D): void {
		root.traverse((obj) => {
			const door = obj.userData?.pelacord_door as string | undefined;
			if (door) {
				const pos = obj.getWorldPosition(new THREE.Vector3());
				pos.y = 0;
				const dir = obj.getWorldDirection(new THREE.Vector3());
				this.doors.push({room: (door === 'house' ? `house:${this.meId}` : door) as RoomId, pos, ry: Math.atan2(dir.x, dir.z), name: door});
			}
			const hotspot = obj.userData?.pelacord_hotspot as string | undefined;
			if (hotspot) this.hotspots.push({kind: hotspot, pos: obj.getWorldPosition(new THREE.Vector3()).setY(0)});
		});
	}

	private setupNpc(marker: THREE.Object3D | null | undefined): void {
		if (this.npc) {
			this.npc.avatar.dispose();
			this.npc = null;
		}
		if (!marker) return;
		const actor = this.createActor('npc', 'Mili · vendedora', '#f5b326', NPC_LOOK);
		actor.pos.copy(marker.getWorldPosition(new THREE.Vector3()).setY(0));
		actor.target.copy(actor.pos);
		actor.ry = Math.PI;
		actor.labelEl.classList.add('is-npc');
		this.npc = actor;
	}

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
		for (const door of this.doors) if (door.name === 'house') door.room = `house:${id}`;
		if (this.me) {
			await this.me.avatar.setLook(look);
			this.me.look = look;
			this.me.labelEl.querySelector('.w-name-text')!.textContent = name;
			return;
		}
		this.me = this.createActor(id, name, color, look, avatarUrl);
		this.me.pos.copy(this.spawn);
		this.me.target.copy(this.spawn);
		this.me.labelEl.classList.add('is-me');
		this.camPos.copy(this.cameraGoal());
		this.announce(true);
	}

	private createActor(id: string, name: string, color: string, look: Look, avatarUrl?: string): Actor {
		const avatar = new Avatar(this.catalog, look);
		const {el, obj} = makeLabel(name, color, avatarUrl);
		avatar.root.add(obj);
		avatar.root.userData.playerId = id;
		this.actorsGroup.add(avatar.root);
		return {id, avatar, label: obj, labelEl: el, pos: new THREE.Vector3(), target: new THREE.Vector3(), ry: 0, seat: null, look, anim: 'idle'};
	}

	syncPeers(states: PlayerState[], info: Record<string, {name: string; avatarUrl?: string}>): void {
		const here = states.filter((s) => s.room === this.room && s.id !== this.meId);
		const keep = new Set(here.map((s) => s.id));
		for (const [id, actor] of this.others) {
			if (keep.has(id)) continue;
			actor.avatar.dispose();
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
			if (actor.pos.distanceTo(reported) > 2 || s.anim === 'sit') actor.pos.copy(reported);
			actor.target.set(s.tx ?? s.x, 0, s.tz ?? s.z);
			if (s.anim !== 'walk') actor.target.copy(reported);
			if (s.anim !== 'walk') actor.ry = s.ry;
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
			this.pop(actor, iconSvg('hand', 34), null);
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

	private pop(actor: Actor, svg: string | null, image: string | null): void {
		const el = document.createElement('div');
		el.className = image ? 'w-pop is-sprite' : 'w-pop';
		if (image) {
			const img = document.createElement('img');
			img.src = image;
			img.alt = '';
			el.append(img);
		} else {
			el.innerHTML = svg ?? '';
		}
		const obj = new CSS2DObject(el);
		obj.position.set(0, 2.15, 0);
		actor.avatar.root.add(obj);
		setTimeout(() => obj.removeFromParent(), 1400);
	}

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

	/** Lo que muestra la tele: pantalla compartida (video), o una imagen con título (Jam / Pelaflix). */
	setScreen(source: {stream?: MediaStream | null; image?: string | null; title?: string | null}): void {
		const key = source.stream ? `s:${source.stream.id}` : `i:${source.image ?? ''}|${source.title ?? ''}`;
		if (key === this.screenKey) return;
		this.screenSource = source;
		this.screenKey = key;
		this.applyScreen();
	}

	private applyScreen(): void {
		const mesh = this.screenMesh;
		if (!mesh) return;
		const {stream, image, title} = this.screenSource;
		if (stream) {
			const video = this.screenVideo ?? document.createElement('video');
			video.muted = true;
			video.playsInline = true;
			video.srcObject = stream;
			void video.play().catch(() => {});
			this.screenVideo = video;
			const texture = new THREE.VideoTexture(video);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.wrapS = THREE.RepeatWrapping;
			texture.repeat.x = -1;
			mesh.material = new THREE.MeshBasicMaterial({map: texture, toneMapped: false});
			return;
		}
		this.screenVideo?.pause();
		if (!title && !image) {
			if (this.screenOriginal) mesh.material = this.screenOriginal;
			return;
		}
		// Cartel en la tele: fondo, imagen (portada del tema o de la película) y título.
		const canvas = document.createElement('canvas');
		canvas.width = 1024;
		canvas.height = 576;
		const ctx = canvas.getContext('2d')!;
		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.wrapS = THREE.RepeatWrapping;
		texture.repeat.x = -1;
		const draw = (img?: HTMLImageElement) => {
			const gradient = ctx.createLinearGradient(0, 0, 1024, 576);
			gradient.addColorStop(0, '#2a1747');
			gradient.addColorStop(1, '#5b2d8a');
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, 1024, 576);
			if (img) {
				const h = 360;
				const w = (img.width / img.height) * h;
				ctx.drawImage(img, 512 - w / 2, 60, w, h);
			}
			ctx.fillStyle = '#fff4dd';
			ctx.font = 'bold 44px "Fredoka", "Segoe UI", sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText((title ?? '').slice(0, 42), 512, img ? 500 : 300);
			texture.needsUpdate = true;
		};
		draw();
		if (image) {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => draw(img);
			img.src = image;
		}
		mesh.material = new THREE.MeshBasicMaterial({map: texture, toneMapped: false});
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
				if ((child as THREE.Light).isLight) child.visible = false;
				if (!mesh.isMesh) return;
				const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
				mat.transparent = true;
				mat.opacity = 0.6;
				if (item.color && (mat.name === 'Base' || mat.name === 'BaseLight')) mat.color.set(item.color);
				mesh.material = mat;
			});
			ghost.rotation.y = item.rot;
			if (this.me) ghost.position.set(this.me.pos.x, 0, this.me.pos.z + 1.2);
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

	private onKeyDown = (event: KeyboardEvent): void => {
		const target = event.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
		const key = event.key.toLowerCase();
		if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
			this.keys.add(key);
			if (key.startsWith('arrow')) event.preventDefault();
		}
		if (key === 'e' && !event.repeat) this.interact();
		if (key === 'r' && this.decorating) this.rotateGhost();
	};

	private onKeyUp = (event: KeyboardEvent): void => {
		this.keys.delete(event.key.toLowerCase());
	};

	private onBlur = (): void => this.keys.clear();

	private onPointerDown = (event: PointerEvent): void => {
		this.pointerDown = {x: event.clientX, y: event.clientY};
		this.renderer.domElement.focus();
	};

	private onPointerMove = (event: PointerEvent): void => {
		if (!this.ghost) return;
		const point = this.floorPoint(event);
		if (point) this.ghost.position.copy(point);
	};

	private onWheel = (event: WheelEvent): void => {
		this.zoom = THREE.MathUtils.clamp(this.zoom + Math.sign(event.deltaY) * 0.08, 0.55, 1.6);
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

	/** Objetos de la mesa que se pueden tocar (cartas, casilleros) con su userData.pick. */
	pickTable(event: PointerEvent): THREE.Object3D | null {
		this.raycaster.setFromCamera(this.ndc(event), this.camera);
		const hits = this.raycaster.intersectObjects(this.tableRoot.children, true);
		for (const hit of hits) {
			let obj: THREE.Object3D | null = hit.object;
			while (obj && obj.userData.pick === undefined) obj = obj.parent;
			if (obj) return obj;
		}
		return null;
	}

	onTableClick: ((obj: THREE.Object3D) => void) | null = null;

	private clamp(point: THREE.Vector3): THREE.Vector3 {
		const b = this.bounds;
		if (b.kind === 'circle') {
			const length = Math.hypot(point.x, point.z);
			if (length > b.radius) point.multiplyScalar(b.radius / length);
		} else {
			point.x = THREE.MathUtils.clamp(point.x, b.minX, b.maxX);
			point.z = THREE.MathUtils.clamp(point.z, b.minZ, b.maxZ);
		}
		for (const o of b.obstacles) {
			const dx = point.x - o.x;
			const dz = point.z - o.z;
			const d = Math.hypot(dx, dz);
			if (d < o.r) {
				const k = d > 0.001 ? o.r / d : 1;
				point.x = o.x + (d > 0.001 ? dx : o.r) * (d > 0.001 ? k : 1);
				point.z = o.z + dz * k;
			}
		}
		point.y = 0;
		return point;
	}

	private onPointerUp = (event: PointerEvent): void => {
		const down = this.pointerDown;
		this.pointerDown = null;
		if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6 || event.button !== 0) return;
		if (this.tableSeat !== null) {
			const picked = this.pickTable(event);
			if (picked) this.onTableClick?.(picked);
			return;
		}
		this.raycaster.setFromCamera(this.ndc(event), this.camera);
		if (this.decorating) {
			const point = this.floorPoint(event);
			if (point) this.cb.onPlace(point.x, point.z, this.decorating.rot);
			return;
		}
		if (this.room === `house:${this.meId}` && this.furnitureClickable.size && this.editMode) {
			const hits = this.raycaster.intersectObjects(this.furnitureGroup.children, true);
			const uid = hits.length ? this.furnitureClickable.get(hits[0].object) : undefined;
			if (uid) {
				this.cb.onFurniturePick(uid);
				return;
			}
		}
		const actorHits = this.raycaster.intersectObjects([...this.others.values()].map((a) => a.avatar.root), true);
		if (actorHits.length) {
			let obj: THREE.Object3D | null = actorHits[0].object;
			while (obj && !obj.userData.playerId) obj = obj.parent;
			if (obj?.userData.playerId) {
				this.cb.onPlayerClick(obj.userData.playerId as string);
				return;
			}
		}
		// Clic en el piso: también se puede caminar con el mouse.
		const point = this.floorPoint(event);
		if (point && this.me && !this.me.seat) {
			this.me.target.copy(point);
			this.me.anim = 'walk';
			this.announce(true);
		}
	};

	/** Modo decorar: clic en un mueble lo agarra para moverlo. */
	editMode = false;

	/** La tecla E: hace lo que dice el cartel. */
	interact(): void {
		const action = this.current;
		if (!action || !this.me) return;
		if (action.kind === 'stand') {
			this.standUp();
			return;
		}
		if (action.kind === 'seat') {
			const seat = this.seats.find((s) => s.id === action.id);
			if (seat) this.sit(seat);
			return;
		}
		if (action.kind === 'door') {
			this.cb.onDoor(action.room);
			return;
		}
		if (action.kind === 'exit') {
			this.cb.onDoor('city');
			return;
		}
		if (action.kind === 'npc' && this.npc) {
			this.npc.avatar.play('Wave');
		}
		this.cb.onInteract(action);
	}

	private sit(seat: Seat): void {
		if (!this.me) return;
		const pos = seat.object.getWorldPosition(new THREE.Vector3());
		const dir = seat.object.getWorldDirection(new THREE.Vector3());
		this.me.pos.copy(pos);
		this.me.target.copy(pos);
		this.me.ry = Math.atan2(dir.x, dir.z);
		this.me.seat = seat.id;
		this.me.anim = 'sit';
		this.me.avatar.setBase('sit');
		if (seat.table !== null) {
			this.tableSeat = seat.table;
			this.cb.onTable(seat.table);
		}
		this.announce(true);
	}

	standUp(): void {
		if (!this.me?.seat) return;
		const seat = this.seats.find((s) => s.id === this.me!.seat);
		const front = this.me.pos.clone();
		if (seat) front.add(seat.object.getWorldDirection(new THREE.Vector3()).setY(0).normalize().multiplyScalar(0.6));
		this.me.pos.copy(this.clamp(front));
		this.me.target.copy(this.me.pos);
		this.me.seat = null;
		this.me.anim = 'idle';
		this.me.avatar.setBase('idle');
		this.leaveTable();
		this.announce(true);
	}

	private leaveTable(): void {
		if (this.tableSeat === null) return;
		this.tableSeat = null;
		this.cb.onTable(null);
	}

	/** El ángulo de la silla en la mesa (para que el juego oriente las cartas hacia mí). */
	tableAngle(seat: number): number {
		const s = this.seats.find((x) => x.table === seat);
		if (!s || !this.tableCenter) return 0;
		const p = s.object.getWorldPosition(new THREE.Vector3());
		return Math.atan2(p.x - this.tableCenter.x, p.z - this.tableCenter.z);
	}

	private announce(force = false): void {
		if (!this.me) return;
		const now = performance.now();
		if (!force && now - this.lastAnnounce < 180) return;
		this.lastAnnounce = now;
		this.cb.onLocalChange({x: this.me.pos.x, z: this.me.pos.z, ry: this.me.ry, anim: this.me.anim, seat: this.me.seat, tx: this.me.target.x, tz: this.me.target.z});
	}

	// ------------------------------------------------------------- cuadro ---

	private cameraGoal(): THREE.Vector3 {
		const focus = this.me ? this.me.pos : this.spawn;
		if (this.tableSeat !== null && this.tableCenter) {
			const angle = this.tableAngle(this.tableSeat);
			return new THREE.Vector3(this.tableCenter.x + Math.sin(angle) * 2.1, this.tableCenter.y + 2.3, this.tableCenter.z + Math.cos(angle) * 2.1);
		}
		if (this.room === 'city' || this.room === 'campfire') {
			const far = this.room === 'city' ? 1.25 : 1.1;
			return new THREE.Vector3(focus.x, 5.4 * this.zoom * far, focus.z - 7.2 * this.zoom * far);
		}
		// Adentro: más alta y mirando más hacia abajo, y sin pasarse del borde de la sala (si no se
		// veía el vacío negro de afuera del piso).
		const b = this.bounds;
		const z = Math.max(focus.z, b.minZ + 2.4);
		return new THREE.Vector3(focus.x * 0.8, 6.3 * this.zoom, z - 6.0 * this.zoom);
	}

	private loop = (): void => {
		if (this.disposed) return;
		this.frame = requestAnimationFrame(this.loop);
		// Tiempo real (hasta 1/4 s): así caminar va a la misma velocidad aunque la PC dé pocos cuadros.
		const dt = Math.min(0.25, this.clock.getDelta());
		const t = this.clock.elapsedTime;
		if (this.me) this.stepMe(this.me, dt);
		for (const actor of this.others.values()) this.stepOther(actor, dt);
		if (this.npc) {
			this.npc.avatar.root.position.copy(this.npc.pos);
			if (this.me) {
				const dx = this.me.pos.x - this.npc.pos.x;
				const dz = this.me.pos.z - this.npc.pos.z;
				if (Math.hypot(dx, dz) < 4) this.npc.ry += (Math.atan2(dx, dz) - this.npc.ry) * Math.min(1, dt * 3);
			}
			this.npc.avatar.root.rotation.y = this.npc.ry;
			this.npc.avatar.update(dt);
		}
		const taken = new Set<string>([...this.others.values()].map((a) => a.seat).filter(Boolean) as string[]);
		if (this.me?.seat) taken.add(this.me.seat);
		for (const seat of this.seats) {
			seat.ring.visible = !taken.has(seat.id) && this.tableSeat === null;
			const s = 1 + Math.sin(t * 3 + seat.ring.position.x) * 0.06;
			seat.ring.scale.set(s, s, s);
		}
		this.updatePrompt(taken);

		const goal = this.cameraGoal();
		this.camPos.lerp(goal, 1 - Math.pow(0.0015, dt));
		this.camera.position.copy(this.camPos);
		const inside = this.room !== 'city' && this.room !== 'campfire';
		const lookZ = inside ? Math.max(this.me?.pos.z ?? 0, this.bounds.minZ + 2.4) + 0.9 : (this.me?.pos.z ?? 0) + 0.6;
		const lookGoal = this.tableSeat !== null && this.tableCenter ? this.tableCenter : new THREE.Vector3((this.me?.pos.x ?? 0) * (inside ? 0.8 : 1), 0.6, lookZ);
		this.camLook.lerp(lookGoal, 1 - Math.pow(0.0015, dt));
		this.camera.lookAt(this.camLook);
		if (this.me) this.sun.target.position.set(this.me.pos.x, 0, this.me.pos.z);
		this.sun.position.set((this.me?.pos.x ?? 0) - 4, 12, (this.me?.pos.z ?? 0) - 6);

		this.renderer.render(this.scene, this.camera);
		this.labels.render(this.scene, this.camera);
	};

	private stepMe(actor: Actor, dt: number): void {
		// WASD: la cámara mira hacia +Z, así que W = +Z, S = -Z, A = +X, D = -X.
		let ix = 0;
		let iz = 0;
		if (this.keys.has('w') || this.keys.has('arrowup')) iz += 1;
		if (this.keys.has('s') || this.keys.has('arrowdown')) iz -= 1;
		if (this.keys.has('a') || this.keys.has('arrowleft')) ix += 1;
		if (this.keys.has('d') || this.keys.has('arrowright')) ix -= 1;
		const typing = this.decorating !== null;
		if ((ix || iz) && !typing && this.tableSeat === null) {
			if (actor.seat) this.standUp();
			const length = Math.hypot(ix, iz);
			const speed = this.keys.has('shift') ? RUN_SPEED : WALK_SPEED;
			const next = actor.pos.clone().add(new THREE.Vector3((ix / length) * speed * dt, 0, (iz / length) * speed * dt));
			actor.pos.copy(this.clamp(next));
			actor.target.copy(actor.pos).add(new THREE.Vector3((ix / length) * 0.8, 0, (iz / length) * 0.8));
			this.turn(actor, Math.atan2(ix, iz), dt);
			if (actor.anim !== 'walk') {
				actor.anim = 'walk';
				this.announce(true);
			} else {
				this.announce();
			}
			this.moved = true;
		} else if (actor.anim === 'walk') {
			const toTarget = actor.target.clone().sub(actor.pos).setY(0);
			const distance = toTarget.length();
			if (this.moved || distance < 0.05) {
				// Soltó las teclas (o llegó adonde hizo clic).
				this.moved = false;
				actor.target.copy(actor.pos);
				actor.anim = 'idle';
				this.announce(true);
			} else {
				actor.pos.add(toTarget.normalize().multiplyScalar(Math.min(distance, WALK_SPEED * dt)));
				actor.pos.copy(this.clamp(actor.pos));
				this.turn(actor, Math.atan2(toTarget.x, toTarget.z), dt);
				this.announce();
			}
		}
		actor.avatar.setBase(actor.anim);
		this.place(actor, dt);
	}

	private stepOther(actor: Actor, dt: number): void {
		if (actor.anim === 'walk') {
			const toTarget = actor.target.clone().sub(actor.pos).setY(0);
			const distance = toTarget.length();
			if (distance > 0.05) {
				actor.pos.add(toTarget.normalize().multiplyScalar(Math.min(distance, RUN_SPEED * dt)));
				this.turn(actor, Math.atan2(toTarget.x, toTarget.z), dt);
			}
			actor.avatar.setBase(distance > 0.05 ? 'walk' : 'idle');
		} else {
			actor.avatar.setBase(actor.anim);
		}
		this.place(actor, dt);
	}

	private turn(actor: Actor, wanted: number, dt: number): void {
		let delta = wanted - actor.ry;
		delta = Math.atan2(Math.sin(delta), Math.cos(delta));
		actor.ry += delta * Math.min(1, dt * 14);
	}

	private place(actor: Actor, dt: number): void {
		actor.avatar.root.position.copy(actor.pos);
		actor.avatar.root.rotation.y = actor.ry;
		const talking = this.speaking.has(actor.id);
		actor.avatar.setTalking(talking);
		actor.labelEl.classList.toggle('is-speaking', talking);
		actor.avatar.update(dt);
	}

	/** Busca lo más cercano con lo que se puede interactuar y muestra el cartel "E …". */
	private updatePrompt(taken: Set<string>): void {
		const me = this.me;
		let best: {action: Interaction; at: THREE.Vector3; d: number} | null = null;
		// `bonus` acerca virtualmente: los asientos ganan sobre los carteles que están al lado.
		const consider = (action: Interaction, at: THREE.Vector3, range: number, bonus = 0) => {
			if (!me) return;
			const real = Math.hypot(me.pos.x - at.x, me.pos.z - at.z);
			const d = real - bonus;
			if (real < range && (!best || d < best.d)) best = {action, at, d};
		};
		if (me && !this.decorating) {
			if (me.seat) {
				best = {action: {kind: 'stand', label: this.tableSeat !== null ? 'Levantarte de la mesa' : 'Pararte'}, at: me.pos.clone().setY(1.95), d: 0};
			} else {
				for (const seat of this.seats) {
					if (taken.has(seat.id)) continue;
					const p = seat.object.getWorldPosition(new THREE.Vector3());
					consider({kind: 'seat', id: seat.id, label: seat.table !== null ? 'Sentarte a jugar' : 'Sentarte'}, p.clone().setY(p.y + 0.55), SEAT_RANGE, 0.6);
				}
				for (const door of this.doors) consider({kind: 'door', room: door.room, label: `Entrar a ${ROOM_TITLES[door.name] ?? door.name}`}, door.pos.clone().setY(2.4), DOOR_RANGE);
				if (this.exitPoint) consider({kind: 'exit', label: 'Salir a la ciudad'}, this.exitPoint.clone().setY(1.6), 1.3);
				if (this.tvPoint) consider({kind: 'tv', label: 'Usar la tele'}, this.tvPoint.clone().setY(1.6), 1.8);
				if (this.npc) consider({kind: 'npc', label: 'Hablar con Mili'}, this.npc.pos.clone().setY(2.2), 2.2);
				for (const h of this.hotspots) {
					const label = h.kind === 'clothes' ? 'Ver ropa' : h.kind === 'furniture' ? 'Ver muebles' : h.kind === 'fitting' ? 'Probador' : 'Caja';
					consider({kind: 'hotspot', hotspot: h.kind, label}, h.pos.clone().setY(1.7), 1.25);
				}
			}
		}
		const found = best as {action: Interaction; at: THREE.Vector3; d: number} | null;
		if (!found) {
			this.prompt.visible = false;
			this.current = null;
			return;
		}
		const key = `${found.action.kind}:${found.action.label}`;
		if (!this.current || `${this.current.kind}:${this.current.label}` !== key) {
			const icon = found.action.kind === 'seat' ? 'sofa' : found.action.kind === 'door' ? 'door' : found.action.kind === 'exit' ? 'exit' : found.action.kind === 'tv' ? 'tv' : found.action.kind === 'npc' ? 'chat' : found.action.kind === 'hotspot' ? 'shirt' : 'sofa';
			this.promptEl.innerHTML = `<kbd>E</kbd><span class="w-prompt-icon">${iconSvg(icon, 15)}</span><span>${found.action.label}</span>`;
		}
		this.current = found.action;
		// Siempre arriba de MI cabeza: así no se pisa con las placas de nombre ni queda tapado.
		this.promptAnchor.copy(me ? me.pos : found.at).setY(2.38);
		this.prompt.position.copy(this.promptAnchor);
		this.prompt.visible = true;
	}

	private resize(): void {
		const width = this.container.clientWidth || 1;
		const height = this.container.clientHeight || 1;
		this.renderer.setSize(width, height, false);
		this.labels.setSize(width, height);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	focus(): void {
		this.renderer.domElement.focus();
	}

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.frame);
		this.resizeObserver.disconnect();
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('blur', this.onBlur);
		this.me?.avatar.dispose();
		this.npc?.avatar.dispose();
		for (const actor of this.others.values()) actor.avatar.dispose();
		this.screenVideo?.pause();
		this.renderer.dispose();
		this.renderer.domElement.remove();
		this.labels.domElement.remove();
	}
}
