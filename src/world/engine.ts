/**
 * Motor del mundo 3D (three.js). Ciudad + locales, caminar con WASD, carteles "E para…",
 * sentarse, puertas, NPC, tele, mesa de juegos, placas con nombre, gestos y decorar la casa.
 * La interfaz (React) vive en WorldView; acá sólo hay 3D y entrada.
 *
 * Ejes: glTF Y-arriba; avatares y asientos miran a +Z. La cámara mira desde -Z.
 */
import * as THREE from 'three';
import {CSS2DObject, CSS2DRenderer} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {Avatar, type BaseAnim, loadGLB} from '@/world/avatars';
import {Ambience} from '@/world/ambience';
import {Dust} from '@/world/dust';
import {worldSounds} from '@/world/worldSounds';
import {Cinematic} from '@/world/cinematic';
import {CameraOcclusion} from '@/world/cameraOcclusion';
import {furnitureColor} from '@/world/furnitureColors';
import {CAPTURE_RANGE, CityPets} from '@/world/cityPets';
import {isPetId, type PetId} from '@/world/petCatalog';
import {PetCompanion} from '@/world/petCompanion';
import {Npcs} from '@/world/npcs';
import {type Anim, type Catalog, type Emote, HOUSE_GLB, type Look, type PlacedFurniture, type PlayerState, ROOMS, type RoomId, YARD_GLB} from '@/world/core';
import {GardenView} from '@/world/gardenView';
import {type FarmAction, type FarmLand, inLot} from '@/world/farmData';
import {RoomEffects} from '@/world/roomEffects';
import {buildExitDoor, EXIT_DOORS} from '@/world/exitDoor';
import {buildRadio} from '@/world/radio';
import {nearestMachine, upgradeCasino} from '@/world/casinoDecor';
import {fillCasino} from '@/world/casinoFill';
import type {Spin} from '@/world/casino';
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
	/** Zonas caminables sueltas (por ejemplo costanera + muelle): se queda en la más cercana. */
	rects?: Array<[number, number, number, number]>;
	/** Zonas caminables redondas (centro x, centro z, radio): se suman a `rects`. */
	circles?: Array<[number, number, number]>;
	/** Cajas que no se pueden atravesar (los edificios de la ciudad), calculadas del modelo. */
	solids?: Array<[number, number, number, number]>;
}

/** Los edificios de la ciudad: se calcula su caja del modelo al cargar, así no se los atraviesa. */
const SOLID_NAMES = /^(Cinema|Shop|Games|Lounge|MyHouse|FishStall|Lighthouse)$/;
const BODY_RADIUS = 0.12;
const isMoving = (anim: Anim): boolean => anim === 'walk' || anim === 'run';

const box = (minX: number, maxX: number, minZ: number, maxZ: number, obstacles: Bounds['obstacles'] = []): Bounds => ({kind: 'box', minX, maxX, minZ, maxZ, radius: 0, obstacles});
const BOUNDS: Record<string, Bounds> = {
	city: box(-24, 24, -11.5, 23.6, [{x: 0, z: 0, r: 2.05}]),
	living: box(-3.6, 3.6, -3.3, 3.1, [{x: 0.1, z: 0.1, r: 0.6}]),
	cinema: box(-4.1, 4.1, -5.2, 4.0),
	campfire: {kind: 'circle', minX: 0, maxX: 0, minZ: 0, maxZ: 0, radius: 4.6, obstacles: [{x: 0, z: 0, r: 0.85}, {x: 0, z: 3.05, r: 0.45}]},
	shop: box(-4.6, 4.6, -4.4, 2.6),
	games: box(-4.6, 4.6, -4.2, 4.1, [{x: 0, z: 0.5, r: 1.3}, {x: -0.95, z: 4.2, r: 0.55}, {x: -2.05, z: 4.2, r: 0.55}]),
	port: {
		...box(-7.2, 7.2, -5.0, 3.6, [{x: 4.8, z: -2.35, r: 1.45}, {x: -6.2, z: -4.5, r: 0.6}, {x: -4.9, z: -4.9, r: 0.4}, {x: 6.7, z: -4.6, r: 0.4}, {x: 3.0, z: -1.7, r: 0.45}]),
		rects: [[-7.2, 7.2, -5.0, -1.6], [-2.55, -0.45, -1.6, 3.6]],
	},
	// Arena: el lobby (abajo), las rampas y el campo redondo del centro.
	arena: {
		...box(-10.8, 10.8, -16.2, 9.0),
		rects: [[-10.6, 10.6, -16.0, -10.3], [-1.15, 1.15, -10.6, -8.3]],
		circles: [[0, 0, 8.7]],
	},
	house: box(-4.1, 4.1, -3.7, 3.6),
	yard: box(-7.68, 7.68, -7.86, 7.85),
	restaurant: box(-5, 5, -4.4, 4.4),
	casino: box(-7.55, 7.55, -6.2, 6.2),
	smithy: box(-4, 4, -4.12, 4.12),
};

/** Lo que un juego de la Arena le cambia al motor (ver party.ts). */
export interface WorldMode {
	/** Límites propios (el campo del juego). */
	clamp?(p: THREE.Vector3): THREE.Vector3;
	/** ¿Hay piso acá? Si no, me caigo. */
	support?(x: number, z: number): boolean;
	/** Varios pisos: la altura del piso que hay debajo de (x, y, z), o null si no hay ninguno. */
	ground?(x: number, z: number, y: number): number | null;
	/** Cada cuadro, después de moverme. */
	update?(dt: number): void;
	/** Quieto (cuenta regresiva, eliminado mirando). */
	frozen?(): boolean;
	/** Tecla E / Espacio dentro del juego (devuelve true si la usó). */
	action?(): boolean;
	speed?: number;
	wideCamera?: boolean;
}

export type Interaction =
	| {kind: 'seat'; id: string; label: string}
	| {kind: 'door'; room: RoomId; label: string}
	| {kind: 'exit'; label: string}
	| {kind: 'tv'; label: string}
	| {kind: 'npc'; npc: string; label: string}
	| {kind: 'fish'; label: string}
	| {kind: 'pet'; id: string; label: string}
	| {kind: 'hotspot'; hotspot: string; label: string}
	| {kind: 'stand'; label: string};

export interface EngineCallbacks {
	onLocalChange(state: {x: number; z: number; ry: number; anim: Anim; seat: string | null; tx: number; tz: number; y?: number}): void;
	onDoor(room: RoomId): void;
	onInteract(action: Interaction): void;
	onTable(seatIndex: number | null): void;
	onPlayerClick(id: string): void;
	onPlace(x: number, z: number, rot: number): void;
	onFurniturePick(uid: string): void;
	/** Mientras pesca: E / clic para recoger (lo maneja WorldView con el minijuego). */
	onFishAction?(): void;
	/** Clic: empujar al que tengas cerca. */
	onShove?(): void;
	/** Entró o salió el modo "ver la tele" (cámara cerca de la pantalla). */
	onTvView?(on: boolean): void;
	onGroundAction?(x: number, z: number): boolean;
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
	companion?: PetCompanion;
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

const DOOR_LABELS: Record<string, string> = {living: 'al Living', cinema: 'al Cine', campfire: 'al Campamento', shop: 'a la Tienda', games: 'a la Casa de juegos', house: 'a mi casa', port: 'al Puerto', arena: 'a la Arena', yard: 'al patio', casino: 'al Casino', restaurant: 'al Restaurante', smithy: 'a la Herrería'};
const HOTSPOT_LABELS: Record<string, string> = {
	clothes: 'Ver ropa', furniture: 'Ver muebles', fitting: 'Probador', fishmarket: 'Vender pescado', 'arena-admin': 'Jugar en la Arena',
	'casino-blackjack': 'Jugar blackjack', 'casino-roulette': 'Jugar ruleta', 'casino-slots': 'Jugar tragamonedas',
	'restaurant-menu': 'Ver el menú', 'smith-upgrades': 'Mejorar herramientas', 'garden-land': 'Ampliar la huerta',
};
const HOTSPOT_ICONS: Record<string, string> = {
	furniture: 'sofa', fitting: 'mirror', fishmarket: 'fish', 'arena-admin': 'crown',
	'casino-blackjack': 'dice', 'casino-roulette': 'dice', 'casino-slots': 'dice',
	'restaurant-menu': 'utensils', 'smith-upgrades': 'hammer', 'garden-land': 'sprout',
};

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
	el.dataset.face = avatarUrl ?? '';
	const obj = new CSS2DObject(el);
	obj.position.set(0, 1.74, 0);
	return {el, obj};
}

/** Cambia la foto de la plaquita del nombre (cuando alguien cambia su foto de perfil). */
function setLabelFace(el: HTMLDivElement, name: string, avatarUrl?: string): void {
	if ((el.dataset.face ?? '') === (avatarUrl ?? '')) return;
	el.dataset.face = avatarUrl ?? '';
	const face = el.querySelector('.w-name-face');
	if (!face) return;
	face.textContent = '';
	if (avatarUrl) {
		const img = document.createElement('img');
		img.src = avatarUrl;
		img.alt = '';
		img.onerror = () => {
			img.remove();
			face.textContent = name.slice(0, 1).toUpperCase();
		};
		face.append(img);
	} else {
		face.textContent = name.slice(0, 1).toUpperCase();
	}
}

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
	private occlusion = new CameraOcclusion();
	/** Lo que pone el juego de mesa (cartas, fichas) sobre la mesa. */
	readonly tableRoot = new THREE.Group();
	/** Lo que pone cada juego de la Arena (pisos, obstáculos, pelota…). */
	readonly partyRoot = new THREE.Group();
	private seats: Seat[] = [];
	private doors: Door[] = [];
	private hotspots: Array<{kind: string; pos: THREE.Vector3}> = [];
	private exitPoint: THREE.Vector3 | null = null;
	private exitDoorSpot: THREE.Vector3 | null = null;
	private tvPoint: THREE.Vector3 | null = null;
	private npcs: Npcs;
	private pets = new CityPets();
	/** Aviso cuando aparece una mascota salvaje (es raro: se avisa para que la busquen). */
	set onPetAppear(cb: ((name: string) => void) | null) {
		this.pets.onAppear = cb;
	}
	private ambience: Ambience;
	readonly garden = new GardenView();
	private gardenLand: FarmLand | null = null;
	private gardenTool = false;
	private effects: RoomEffects;
	private screening = false;
	private loadedRoom: RoomId | null = null;
	private active = true;
	private controlsBlocked = false;
	/** Suena música en la tele de esta sala: los que están quietos bailan. */
	private musicOn = false;
	/** Modo "ver la tele": la cámara se acerca y deja la pantalla grande (se sale al moverse). */
	private tvView = false;
	private fishing: {spot: THREE.Vector3; dir: THREE.Vector3; bite: boolean; landed: boolean; rod: THREE.Object3D; line: THREE.Line; bobber: THREE.Mesh; started: number} | null = null;
	private fishSpots: Array<{pos: THREE.Vector3; dir: THREE.Vector3}> = [];
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

		this.scene.add(this.roomGroup, this.furnitureGroup, this.actorsGroup, this.tableRoot, this.partyRoot);
		this.skyFill = new THREE.HemisphereLight(0xd9ccff, 0x3a2552, 1.25);
		this.scene.add(this.skyFill);
		const sun = new THREE.DirectionalLight(0xfff0dd, 1.5);
		sun.position.set(-4, 10, -6);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		Object.assign(sun.shadow.camera, {left: -12, right: 12, top: 12, bottom: -12});
		sun.shadow.radius = 4;
		sun.shadow.bias = -0.0008;
		this.scene.add(sun, sun.target);
		this.sun = sun;
		this.scene.add(this.garden.root);
		this.effects = new RoomEffects(this.scene, this.sun, this.skyFill);

		this.npcs = new Npcs((id, name, color, look, label) => this.createActor(id, name, color, look, undefined, label));
		this.ambience = new Ambience(this.scene, this.sun, this.skyFill);
		this.dust = new Dust(this.scene);

		this.promptEl = document.createElement('div');
		this.promptEl.className = 'w-prompt';
		this.prompt = new CSS2DObject(this.promptEl);
		this.prompt.visible = false;
		this.scene.add(this.prompt);

		const canvas = this.renderer.domElement;
		canvas.addEventListener('pointerdown', this.onPointerDown);
		canvas.addEventListener('pointerup', this.onPointerUp);
		canvas.addEventListener('contextmenu', this.onContextMenu);
		canvas.addEventListener('pointermove', this.onPointerMove);
		canvas.addEventListener('pointerleave', () => this.garden.point());
		canvas.addEventListener('wheel', this.onWheel, {passive: true});
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);
		this.fx = new Cinematic(this.renderer, this.scene, this.camera);
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(container);
		this.resize();
		this.loop();
		if (import.meta.env.DEV) (window as unknown as {__pelaWorld?: WorldEngine}).__pelaWorld = this;
	}

	private sun: THREE.DirectionalLight;
	private fx!: Cinematic;
	private skyFill: THREE.HemisphereLight;

	// ------------------------------------------------------------ salas ----

	/** Carga una sala. `fromRoom`: si venís de un local a la ciudad, aparecés en su puerta. */
	async loadRoom(room: RoomId, house: PlacedFurniture[] | null, fromRoom: RoomId | null = null): Promise<void> {
		const token = ++this.loadToken;
		this.room = room;
		this.current = null;
		this.prompt.visible = false;
		const isHouse = room.startsWith('house:');
		const isYard = room.startsWith('yard:');
		const def = ROOMS.find((r) => r.id === room);
		const gltf = await loadGLB(isHouse ? HOUSE_GLB : isYard ? YARD_GLB : (def?.glb ?? ROOMS[0].glb));
		if (token !== this.loadToken || this.disposed) return;
		this.clearRoom();
		this.loadedRoom = room;
		const scene = gltf.scene.clone(true);
		this.bounds = BOUNDS[isHouse ? 'house' : isYard ? 'yard' : room] ?? BOUNDS.living;
		const localLightScale = room === 'casino' ? 0.23 : room === 'smithy' ? 0.18 : 1;
		this.prepareScene(scene, false, localLightScale);
		this.bounds = {...this.bounds, solids: this.findSolids(scene)};
		this.limitLights(scene, 6);
		this.roomGroup.add(scene);
		scene.updateMatrixWorld(true);
		this.occlusion.setRoom(scene.children);
		const spawn = scene.getObjectByName('Spawn');
		if (spawn) spawn.getWorldPosition(this.spawn);
		else this.spawn.set(0, 0, -3);
		this.collectSeats(scene, '');
		this.collectMarkers(scene);
		this.zonesArmed = false;
		if (room === 'city') {
			this.addArenaGate(scene);
			this.faceSignsToCamera(scene);
		}
		if (room === 'arena') {
			// La gelatina del pozo era un disco: cerca del borde de abajo la cámara veía su borde contra
			// el cielo y parecía que "cambiaba el piso". Más ancha, nunca se le ve el borde; y sin sombras,
			// no cambia de color mientras caminás.
			scene.traverse((o) => {
				if (!/^GooPool/.test(o.name)) return;
				o.scale.x *= 4;
				o.scale.z *= 4;
				o.traverse((m) => {
					m.receiveShadow = false;
				});
			});
		}
		// La sala de juegos no traía tele: se pone la de la tienda, más grande, contra la pared del fondo.
		if (room === 'games') {
			const tvModel = await loadGLB('models/furniture/tv.glb').catch(() => null);
			if (token !== this.loadToken || this.disposed) return;
			if (tvModel) {
				const tvObj = tvModel.scene.clone(true);
				tvObj.position.set(-1.5, 0, 4.15);
				tvObj.rotation.y = Math.PI;
				tvObj.scale.setScalar(1.25);
				// Girada 180°, su pantalla quedaba espejada: se dan vuelta las coordenadas de la imagen.
				const tvScreen = tvObj.getObjectByName('Screen') as THREE.Mesh | undefined;
				if (tvScreen?.isMesh) {
					tvScreen.geometry = tvScreen.geometry.clone();
					// clone() comparte `userData` con el modelo guardado: sin esto, la segunda vez que se
					// entraba a la sala no se armaban las coordenadas de la imagen y se rompía la carga.
					tvScreen.geometry.userData = {};
					planarScreenUv(tvScreen.geometry);
					const uv = tvScreen.geometry.attributes.uv as THREE.BufferAttribute | undefined;
					if (uv) {
						for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
						uv.needsUpdate = true;
					}
				}
				this.prepareScene(tvObj, true);
				scene.add(tvObj);
				scene.updateMatrixWorld(true);
			}
		}
		// El casino: tres tragamonedas finitas en lugar de la gorda, y sin lámparas tapando carteles.
		if (room === 'casino') {
			upgradeCasino(scene);
			const filled = fillCasino(scene);
			this.hotspots.push(...filled.hotspots);
			this.bounds = {...this.bounds, obstacles: [...this.bounds.obstacles, ...filled.obstacles]};
		}
		// El campamento: una radio sobre un tronco (sólo música).
		if (room === 'campfire') {
			const radio = buildRadio();
			radio.position.set(0, 0, 3.05);
			radio.rotation.y = Math.PI;
			scene.add(radio);
			scene.updateMatrixWorld(true);
		}
		this.fixtures.clear();
		this.ghostFixture = null;
		if (isHouse) this.collectFixtures(scene);
		// La puerta de SALIDA (pared izquierda, cerca de la entrada).
		this.exitDoorSpot = null;
		const exitSpot = EXIT_DOORS[isHouse ? 'house' : room];
		if (exitSpot) {
			const door = buildExitDoor(exitSpot.color);
			door.position.set(exitSpot.x, 0, exitSpot.z);
			door.rotation.y = Math.PI / 2;
			scene.add(door);
			scene.updateMatrixWorld(true);
			this.exitDoorSpot = new THREE.Vector3(exitSpot.x, 0, exitSpot.z);
		}
		this.screenMesh = (scene.getObjectByName('Screen') as THREE.Mesh) ?? null;
		this.screenOriginal = this.screenMesh ? (this.screenMesh.material as THREE.Material) : null;
		if (this.screenMesh) planarScreenUv(this.screenMesh.geometry);
		this.tvPoint = null;
		if (this.screenMesh) {
			const p = new THREE.Vector3();
			this.screenMesh.getWorldPosition(p);
			this.tvPoint = this.clamp(new THREE.Vector3(p.x, 0, p.z - (room === 'campfire' ? 0.8 : 1.4)));
		}
		this.screenKey = '';
		this.applyScreen();
		const table = scene.getObjectByName('GameTable');
		this.tableCenter = table ? table.getWorldPosition(new THREE.Vector3()) : null;
		this.tableRoot.position.copy(this.tableCenter ?? new THREE.Vector3(0, -50, 0));
		this.exitPoint = room === 'city' ? null : this.exitDoorSpot ? this.clamp(this.exitDoorSpot.clone().add(new THREE.Vector3(0.75, 0, 0))) : this.clamp(new THREE.Vector3(this.spawn.x, 0, this.spawn.z - 0.7));
		this.npcs.setup(room, scene, (p) => this.clamp(p));
		// Mascotas salvajes: cada lugar tiene la suya (y aparecen muy de vez en cuando).
		this.roomGroup.add(this.pets.root);
		void this.pets.enterRoom(room);
		this.ambience.setup(room, scene);
		this.effects.enter(room, scene);
		if (isYard) this.garden.set(this.gardenLand);
		worldSounds.enter(room);
		// Color del polvo según el piso.
		this.dust.setTint(room === 'port' ? 0xf2e2c4 : room === 'campfire' ? 0xd9c2a3 : room === 'city' ? 0xe6d3c4 : 0xe4d6ea);
		this.stopFishing();
		this.setTvView(false);
		this.sun.position.set(-4, room === 'city' ? 16 : 10, -6);
		if (isHouse) await this.setHouse(house ?? []);
		if (token !== this.loadToken || this.disposed) return;
		if (this.me) {
			const arrival = room === 'city' && fromRoom ? this.doors.find((d) => d.room === (fromRoom.startsWith('house:') ? 'house' : fromRoom)) : null;
			this.me.companion?.reset();
			const backyardDoor = isHouse && fromRoom?.startsWith('yard:') ? this.doors.find((d) => d.name === 'yard') : undefined;
			// Se entra por la puerta de salida de la sala (no desde abajo de todo), mirando hacia adentro.
			const byDoor = !arrival && !backyardDoor && this.exitDoorSpot && this.exitPoint ? this.exitPoint : null;
			this.me.pos.copy(arrival ? arrival.pos : backyardDoor ? backyardDoor.pos.clone().add(new THREE.Vector3(0, 0, -0.7)) : byDoor ?? this.spawn);
			this.me.target.copy(this.me.pos);
			this.me.ry = arrival ? arrival.ry : byDoor ? Math.PI / 2 : 0;
			this.me.seat = null;
			this.me.anim = 'idle';
			this.me.avatar.setBase('idle');
			this.leaveTable();
			this.announce(true);
			this.camPos.copy(this.cameraGoal());
		}
		for (const fn of this.roomReady) fn(room);
	}

	/** Avisos de "terminó de cargar la sala" (la Arena vuelve a esconder su piso si hay un juego). */
	readonly roomReady = new Set<(room: RoomId) => void>();

	/**
	 * Los carteles de abajo (Campamento, Puerto) miraban hacia la plaza y desde la cámara (que está
	 * siempre adelante) no se leían. Se reemplaza el texto por un cartel que siempre mira a la cámara.
	 */
	private faceSignsToCamera(root: THREE.Object3D): void {
		// Se da vuelta el cartel de madera (tabla, poste y letras) 180° sobre su eje: así el lado
		// escrito queda mirando a la cámara. Sin carteles nuevos encima.
		for (const prefix of ['CampSign', 'PortSign']) {
			const parts: THREE.Object3D[] = [];
			root.traverse((obj) => {
				if (obj.name.startsWith(prefix) && obj.parent && !obj.parent.name.startsWith(prefix)) parts.push(obj);
			});
			const board = parts.find((p) => /Board/.test(p.name)) ?? parts[0];
			if (!board) continue;
			const pivot = board.position.clone();
			// Giro alrededor del eje VERTICAL del mundo (rotation.y giraba sobre el eje propio de las
			// letras, que están acostadas, y quedaban espejadas).
			const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
			for (const part of parts) {
				const offset = part.position.clone().sub(pivot);
				part.position.set(pivot.x - offset.x, part.position.y, pivot.z - offset.z);
				part.quaternion.premultiply(yaw);
			}
		}
		root.updateMatrixWorld(true);
	}

	/** La entrada a la Arena es el castillo del fondo de la plaza: se entra por el arco (con E o
	 * caminando hacia adentro). Al volver, aparecés adelante del arco mirando a la plaza. */
	private addArenaGate(scene: THREE.Object3D): void {
		let arch: THREE.Object3D | null = null;
		scene.traverse((o) => {
			if (!arch && /^Castle[_ ]?arch/i.test(o.name)) arch = o;
		});
		const box = arch ? new THREE.Box3().setFromObject(arch) : null;
		const x = box ? (box.min.x + box.max.x) / 2 : 0;
		// El arco: el borde que da a la plaza (la cámara mira desde -Z).
		const front = box ? box.min.z : 19.8;
		this.doors.push({room: 'arena', pos: new THREE.Vector3(x, 0, front - 0.9), ry: Math.PI, name: 'arena'});
	}

	/** Cajas en el piso de los edificios (sin contar lo que está alto, como toldos y carteles). */
	private findSolids(root: THREE.Object3D): Array<[number, number, number, number]> {
		root.updateMatrixWorld(true);
		const solids: Array<[number, number, number, number]> = [];
		root.traverse((obj) => {
			if (!SOLID_NAMES.test(obj.name) && obj.userData.pelacord_solid !== true) return;
			const v = new THREE.Vector3();
			let minX = Infinity;
			let maxX = -Infinity;
			let minZ = Infinity;
			let maxZ = -Infinity;
			// En glTF un objeto con varios materiales llega como grupo: se recorren sus pedazos.
			const meshes: THREE.Mesh[] = [];
			if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
			for (const child of obj.children) if ((child as THREE.Mesh).isMesh && !/Sign|Text/i.test(child.name)) meshes.push(child as THREE.Mesh);
			for (const mesh of meshes) {
				const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
				for (let i = 0; i < pos.count; i++) {
					v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
					// Sólo lo que está a la altura del cuerpo (los toldos y carteles salen más adelante).
					if (v.y > 1.6 || v.y < -0.05) continue;
					minX = Math.min(minX, v.x);
					maxX = Math.max(maxX, v.x);
					minZ = Math.min(minZ, v.z);
					maxZ = Math.max(maxZ, v.z);
				}
			}
			if (Number.isFinite(minX)) solids.push([minX, maxX, minZ, maxZ]);
		});
		return solids;
	}

	private clearRoom(): void {
		this.occlusion.clear();
		this.effects.clear();
		this.garden.set(null);
		this.pets.clear();
		this.roomGroup.clear();
		this.furnitureGroup.clear();
		for (const seat of this.seats) seat.ring.removeFromParent();
		this.seats = [];
		this.doors = [];
		this.hotspots = [];
		this.fishSpots = [];
		this.furnitureClickable.clear();
		this.screenMesh = null;
		this.prompt.visible = false;
		this.current = null;
	}

	private prepareScene(root: THREE.Object3D, isFurniture: boolean, localLightScale = 1): void {
		root.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (mesh.isMesh) {
				mesh.castShadow = isFurniture || !/Room|Floor|Ground|Clearing|Rug|Plank|Plaza|Street|Path|Trail|Stars|Cloudbank|Park hill/i.test(mesh.name);
				mesh.receiveShadow = true;
			}
			const light = obj as THREE.Light;
			if ((light as THREE.PointLight).isPointLight || (light as THREE.SpotLight).isSpotLight) {
				light.intensity *= POINT_LIGHT_SCALE * localLightScale;
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
				const destination = door === 'house' ? `house:${this.meId}` : door === 'yard' && this.room?.startsWith('house:') ? `yard:${this.room.slice(6)}` : door;
				this.doors.push({room: destination as RoomId, pos, ry: Math.atan2(dir.x, dir.z), name: door});
			}
			const hotspot = obj.userData?.pelacord_hotspot as string | undefined;
			if (hotspot === 'fish') {
				const dir = obj.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
				this.fishSpots.push({pos: obj.getWorldPosition(new THREE.Vector3()).setY(0), dir});
			} else if (hotspot) this.hotspots.push({kind: hotspot, pos: obj.getWorldPosition(new THREE.Vector3()).setY(0)});
		});
	}

	async setHouse(items: PlacedFurniture[]): Promise<void> {
		const token = this.loadToken;
		const placed = items.filter((i) => i.x !== null && i.z !== null && !i.id.startsWith('fixture:'));
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
		this.occlusion.setFurniture(this.furnitureGroup.children);
		this.lastHouse = items;
		this.applyFixtures(items);
	}

	private recolor(obj: THREE.Object3D, hex: string): void {
		obj.traverse((child) => {
			const mesh = child as THREE.Mesh;
			if (!mesh.isMesh) return;
			const mat = mesh.material as THREE.MeshStandardMaterial;
			if (mat.name === 'Base' || mat.name === 'BaseLight') {
				mesh.material = Object.assign(mat.clone(), {color: furnitureColor(hex, mat.name === 'BaseLight')});
			}
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
			setLabelFace(this.me.labelEl, name, avatarUrl);
			return;
		}
		this.me = this.createActor(id, name, color, look, avatarUrl);
		this.me.pos.copy(this.spawn);
		this.me.target.copy(this.spawn);
		this.me.labelEl.classList.add('is-me');
		this.camPos.copy(this.cameraGoal());
		this.announce(true);
	}

	private createActor(id: string, name: string, color: string, look: Look, avatarUrl?: string, label = true): Actor {
		const avatar = new Avatar(this.catalog, look);
		const {el, obj} = makeLabel(name, color, avatarUrl);
		if (label) avatar.root.add(obj);
		avatar.root.userData.playerId = id;
		this.actorsGroup.add(avatar.root);
		return {id, avatar, label: obj, labelEl: el, pos: new THREE.Vector3(), target: new THREE.Vector3(), ry: 0, seat: null, look, anim: 'idle'};
	}

	setEquippedPet(pet: PetId | null): void {
		if (this.me) this.setCompanion(this.me, pet);
	}

	private setCompanion(actor: Actor, species: unknown): void {
		const pet = isPetId(species) ? species : undefined;
		if (actor.companion?.species === pet) return;
		actor.companion?.dispose();
		actor.companion = pet ? new PetCompanion(pet, this.actorsGroup, (position) => this.clamp(position)) : undefined;
	}

	syncPeers(states: PlayerState[], info: Record<string, {name: string; avatarUrl?: string}>): void {
		const here = states.filter((s) => s.room === this.room && s.id !== this.meId);
		const keep = new Set(here.map((s) => s.id));
		for (const [id, actor] of this.others) {
			if (keep.has(id)) continue;
			actor.avatar.dispose();
			actor.companion?.dispose();
			this.others.delete(id);
		}
		for (let s of here) {
			let actor = this.others.get(s.id);
			const name = info[s.id]?.name ?? s.name;
			if (!actor) {
				actor = this.createActor(s.id, name, s.color, s.look, info[s.id]?.avatarUrl);
				actor.pos.set(s.x, 0, s.z);
				this.others.set(s.id, actor);
			}
			void actor.avatar.setLook(s.look);
			actor.avatar.setGhost(Boolean(s.away));
			actor.labelEl.classList.toggle('is-away', Boolean(s.away));
			actor.look = s.look;
			actor.seat = s.seat;
			actor.anim = s.anim;
			this.setCompanion(actor, s.equippedPet);
			actor.labelEl.querySelector('.w-name-text')!.textContent = name;
			setLabelFace(actor.labelEl, name, info[s.id]?.avatarUrl);
			const reported = new THREE.Vector3(s.x, s.y ?? 0, s.z);
			// Sentado: se usa el asiento de verdad (con su altura y hacia dónde mira). Antes quedaba a la
			// altura del piso y se veía hundido en el sillón.
			const seat = s.anim === 'sit' && s.seat ? this.seats.find((x) => x.id === s.seat) : undefined;
			if (seat) {
				seat.object.getWorldPosition(reported);
				const dir = seat.object.getWorldDirection(new THREE.Vector3());
				s = {...s, ry: Math.atan2(dir.x, dir.z)};
			}
			if (actor.pos.distanceTo(reported) > 2 || s.anim === 'sit') actor.pos.copy(reported);
			actor.target.set(s.tx ?? s.x, s.y ?? 0, s.tz ?? s.z);
			if (!isMoving(s.anim)) actor.target.copy(reported);
			if (!isMoving(s.anim)) actor.ry = s.ry;
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
		} else if (emote === 'cheer') {
			actor.avatar.play('Cheer');
			this.pop(actor, iconSvg('party', 34), null);
		} else if (emote === 'bow') {
			actor.avatar.play('Bow');
			this.pop(actor, iconSvg('crown', 30), null);
		} else if (emote === 'shrug') {
			actor.avatar.play('Shrug');
			this.pop(actor, iconSvg('question', 34), null);
		} else if (emote === 'heart') {
			actor.avatar.play('Wave');
			this.pop(actor, iconSvg('heart', 36), null, 'is-heart');
		}
	}

	/**
	 * Bailes y aplausos: quedan puestos hasta que te movés (y los demás los ven, porque viajan como
	 * estado del personaje). Llamarlo con el mismo baile otra vez lo corta.
	 */
	setLoopEmote(anim: 'dance' | 'robot' | 'clap'): void {
		const me = this.me;
		if (!me) return;
		if (me.seat) this.standUp();
		if (this.fishing) this.stopFishing();
		me.target.copy(me.pos);
		me.anim = me.anim === anim ? 'idle' : anim;
		this.announce(true);
	}

	myAnim(): Anim {
		return this.me?.anim ?? 'idle';
	}

	private pop(actor: Actor, svg: string | null, image: string | null, extra = ''): void {
		const el = document.createElement('div');
		el.className = `${image ? 'w-pop is-sprite' : 'w-pop'} ${extra}`.trim();
		if (image) {
			const img = document.createElement('img');
			img.src = image;
			img.alt = '';
			el.append(img);
		} else {
			el.innerHTML = svg ?? '';
		}
		// El renderer de etiquetas ubica el elemento con `transform`: si la animación (que también usa
		// `transform`) va en el mismo elemento, lo pisa y el cartelito aparecía en la esquina de la
		// pantalla. Por eso va adentro de un "ancla" que sólo se posiciona.
		const anchor = document.createElement('div');
		anchor.className = 'w-pop-anchor';
		anchor.append(el);
		const obj = new CSS2DObject(anchor);
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

	/** Lo que suena en la tele, dibujado en la pantalla (portada, título, barra, play/pausa). */
	setScreenMusic(info: {title: string; author?: string; thumbnail?: string; positionMs: number; duration: number; paused: boolean; next?: string | null; loading?: boolean} | null): void {
		const mesh = this.screenMesh;
		if (!mesh || !info) return;
		const second = Math.floor(info.positionMs / 1000);
		const key = `m:${info.title}|${info.thumbnail}|${second}|${info.paused}|${info.next}|${info.loading}|${this.musicCard?.image ? 1 : 0}`;
		if (key === this.screenKey) return;
		this.screenKey = key;
		this.screenVideo?.pause();
		if (!this.musicCard) {
			const canvas = document.createElement('canvas');
			canvas.width = 1024;
			canvas.height = 576;
			const texture = new THREE.CanvasTexture(canvas);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.wrapS = THREE.RepeatWrapping;
			texture.repeat.x = -1;
			this.musicCard = {canvas, texture, image: null, imageUrl: '', material: new THREE.MeshBasicMaterial({map: texture, toneMapped: false})};
		}
		const card = this.musicCard;
		if (info.thumbnail && info.thumbnail !== card.imageUrl) {
			card.imageUrl = info.thumbnail;
			card.image = null;
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => {
				if (card.imageUrl !== info.thumbnail) return;
				card.image = img;
				this.screenKey = '';
			};
			img.src = info.thumbnail;
		}
		drawMusicCard(card.canvas, info, card.image);
		card.texture.needsUpdate = true;
		mesh.material = card.material;
	}

	private musicCard: {canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; image: HTMLImageElement | null; imageUrl: string; material: THREE.MeshBasicMaterial} | null = null;

	/** Dónde cae la pantalla de la tele en la ventana (para ponerle encima el reproductor de Pelaflix). */
	screenRect(): {left: number; top: number; width: number; height: number} | null {
		const mesh = this.screenMesh;
		if (!mesh || !this.active) return null;
		const geometry = mesh.geometry;
		if (!geometry.boundingBox) geometry.computeBoundingBox();
		const bb = geometry.boundingBox!;
		const width = this.container.clientWidth;
		const height = this.container.clientHeight;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		const v = new THREE.Vector3();
		for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
			v.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(this.camera);
			if (v.z > 1) return null;
			minX = Math.min(minX, ((v.x + 1) / 2) * width);
			maxX = Math.max(maxX, ((v.x + 1) / 2) * width);
			minY = Math.min(minY, ((1 - v.y) / 2) * height);
			maxY = Math.max(maxY, ((1 - v.y) / 2) * height);
		}
		if (maxX < 0 || maxY < 0 || minX > width || minY > height) return null;
		return {left: minX, top: minY, width: maxX - minX, height: maxY - minY};
	}

	/** Qué tan lejos estoy de la tele (null si en esta sala no hay tele). */
	distanceToScreen(): number | null {
		if (!this.screenMesh || !this.me) return null;
		const p = this.screenMesh.getWorldPosition(new THREE.Vector3());
		return Math.hypot(this.me.pos.x - p.x, this.me.pos.z - p.z);
	}

	hasScreen(): boolean {
		return this.screenMesh !== null;
	}

	/** Música en la tele de esta sala: los que están quietos bailan. */
	setMusicOn(on: boolean): void {
		this.musicOn = on;
	}

	private partyMode = false;

	/** Modo joda de la tele de esta sala (bola de boliche y luces). */
	setPartyMode(on: boolean): void {
		this.partyMode = on;
	}

	setScreening(on: boolean): void {
		this.screening = on;
	}

	playCasino(spin: Spin, who: string = this.meId): void {
		const actor = who === this.meId ? this.me : this.others.get(who);
		this.effects.play(spin, nearestMachine(actor?.pos.x ?? 4.65));
	}

	/**
	 * Globito de pensamiento arriba de alguien que apostó: la ficha con el monto y a qué apostó.
	 * Cuando sale el resultado: si ganó, confeti y festejo; si no, se va solo.
	 */
	casinoBubble(id: string, bets: Array<{label: string; stake: number; tone?: string}>, payout: number, total: number, delayMs: number): void {
		const actor = id === this.meId ? this.me : this.others.get(id);
		if (!actor) return;
		const old = this.betBubbles.get(id);
		if (old) {
			window.clearTimeout(old.timer);
			old.obj.removeFromParent();
		}
		const anchor = document.createElement('div');
		anchor.className = 'w-pop-anchor';
		const el = document.createElement('div');
		el.className = 'w-bet';
		const list = document.createElement('div');
		list.className = 'w-bet-list';
		for (const bet of bets.slice(0, 4)) {
			const row = document.createElement('span');
			row.className = 'w-bet-row';
			const chip = document.createElement('i');
			chip.className = 'w-bet-chip';
			chip.textContent = String(bet.stake);
			const label = document.createElement('b');
			label.textContent = bet.label;
			if (bet.tone) label.dataset.tone = bet.tone;
			row.append(chip, label);
			list.append(row);
		}
		if (bets.length > 4) {
			const more = document.createElement('small');
			more.textContent = `y ${bets.length - 4} más`;
			list.append(more);
		}
		const dots = document.createElement('span');
		dots.className = 'w-bet-dots';
		dots.innerHTML = '<i></i><i></i>';
		el.append(list, dots);
		anchor.append(el);
		const obj = new CSS2DObject(anchor);
		obj.position.set(0, 2.25, 0);
		actor.avatar.root.add(obj);
		const finish = () => {
			const won = payout > total;
			const result = document.createElement('div');
			result.className = `w-bet-result ${won ? 'is-win' : payout === total && payout > 0 ? 'is-even' : 'is-lose'}`;
			result.textContent = won ? `¡Ganó ${payout}!` : payout === total && payout > 0 ? 'Recuperó' : 'Perdió';
			el.append(result);
			el.classList.add(won ? 'is-win' : 'is-done');
			if (won) {
				this.confetti(actor.pos);
				this.emote(id, 'cheer');
			}
			const timer = window.setTimeout(() => {
				obj.removeFromParent();
				if (this.betBubbles.get(id)?.obj === obj) this.betBubbles.delete(id);
			}, won ? 4200 : 2600);
			this.betBubbles.set(id, {obj, timer});
		};
		const timer = window.setTimeout(finish, delayMs);
		this.betBubbles.set(id, {obj, timer});
	}

	private betBubbles = new Map<string, {obj: CSS2DObject; timer: number}>();

	/** Lluvia de papelitos de colores arriba de alguien. */
	confetti(at: THREE.Vector3): void {
		const count = 90;
		const colors = [0xff4fa8, 0xffd23f, 0x38d39f, 0x4fb3ff, 0x8a5cff, 0xff7350];
		const pieces = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.11), new THREE.MeshBasicMaterial({side: THREE.DoubleSide, toneMapped: false}), count);
		pieces.frustumCulled = false;
		const state = Array.from({length: count}, (_, i) => {
			const a = Math.random() * Math.PI * 2;
			const sp = 1.2 + Math.random() * 2.2;
			pieces.setColorAt(i, new THREE.Color(colors[i % colors.length]));
			return {p: new THREE.Vector3(at.x, 2.3, at.z), v: new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 3, Math.sin(a) * sp), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: (Math.random() - 0.5) * 14};
		});
		this.scene.add(pieces);
		const pose = new THREE.Object3D();
		const born = performance.now();
		let last = born;
		const tick = () => {
			const now = performance.now();
			const dt = Math.min(0.05, (now - last) / 1000);
			last = now;
			const age = (now - born) / 1000;
			state.forEach((s, i) => {
				s.v.y -= 6.5 * dt;
				s.v.multiplyScalar(1 - 1.6 * dt);
				s.p.addScaledVector(s.v, dt);
				if (s.p.y < 0.03) {
					s.p.y = 0.03;
					s.v.set(0, 0, 0);
				}
				s.r.x += s.w * dt;
				s.r.y += s.w * 0.7 * dt;
				pose.position.copy(s.p);
				pose.rotation.copy(s.r);
				pose.scale.setScalar(Math.max(0.001, Math.min(1, (3.2 - age) / 0.6)));
				pose.updateMatrix();
				pieces.setMatrixAt(i, pose.matrix);
			});
			pieces.instanceMatrix.needsUpdate = true;
			if (pieces.instanceColor) pieces.instanceColor.needsUpdate = true;
			if (age < 3.2) requestAnimationFrame(tick);
			else {
				pieces.removeFromParent();
				pieces.geometry.dispose();
				pieces.material.dispose();
			}
		};
		tick();
	}

	setGarden(land: FarmLand | null, action: FarmAction): void {
		this.gardenLand = land;
		this.gardenTool = action !== 'walk';
		if (this.loadedRoom?.startsWith('yard:')) this.garden.set(land);
		if (!this.gardenTool) this.garden.point();
	}

	/** Pausa el mundo (cuando se pasa a la parte 2D de PelaCord): no dibuja ni escucha el teclado. */
	setActive(on: boolean): void {
		this.active = on;
		this.keys.clear();
		if (!on) this.stopFishing();
		this.labels.domElement.style.display = on ? '' : 'none';
	}

	setControlsBlocked(blocked: boolean): void {
		this.controlsBlocked = blocked;
		this.keys.clear();
		this.pointerDown = null;
	}

	// ------------------------------------------------------------- pesca ---

	private nearestFishSpot(): {pos: THREE.Vector3; dir: THREE.Vector3} | null {
		if (!this.me || !this.fishSpots.length) return null;
		let best: {pos: THREE.Vector3; dir: THREE.Vector3} | null = null;
		let bestD = 1.6;
		for (const spot of this.fishSpots) {
			const d = Math.hypot(this.me.pos.x - spot.pos.x, this.me.pos.z - spot.pos.z);
			if (d < bestD) {
				best = spot;
				bestD = d;
			}
		}
		return best;
	}

	isFishing(): boolean {
		return this.fishing !== null;
	}

	/** El lugar donde está pescando es hondo (la punta del muelle): salen cosas más raras. */
	isDeepSpot(): boolean {
		return Boolean(this.fishing && this.fishing.spot.z > 2.0);
	}

	/** Color de la caña que se ve en la mano (cambia con la que compraste). */
	rodColor = '#c9a464';

	private startFishing(spot: {pos: THREE.Vector3; dir: THREE.Vector3}): void {
		if (!this.me) return;
		this.me.pos.copy(spot.pos);
		this.me.target.copy(spot.pos);
		this.me.ry = Math.atan2(spot.dir.x, spot.dir.z);
		this.me.anim = 'fish';
		// Caña: palo fino que sale de las manos hacia adelante y arriba.
		const rod = new THREE.Group();
		const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, 1.7, 8), new THREE.MeshStandardMaterial({color: this.rodColor, roughness: 0.45, metalness: this.rodColor === '#ffc93c' ? 0.5 : 0}));
		stick.position.set(0, 0.78, 0);
		const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 14), new THREE.MeshStandardMaterial({color: 0xe8b23a, roughness: 0.4}));
		reel.rotation.z = Math.PI / 2;
		reel.position.set(0.05, 0.2, 0);
		rod.add(stick, reel);
		rod.position.set(-0.04, 0.62, 0.32);
		rod.rotation.x = 0.85;
		this.me.avatar.root.add(rod);
		const bobber = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshStandardMaterial({color: 0xff4a4a, roughness: 0.35}));
		const white = new THREE.Mesh(new THREE.SphereGeometry(0.071, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({color: 0xffffff}));
		bobber.add(white);
		const target = spot.pos.clone().add(spot.dir.clone().multiplyScalar(2.4));
		bobber.position.set(target.x, 0.9, target.z);
		this.scene.add(bobber);
		const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({color: 0xf4f0ff, transparent: true, opacity: 0.8}));
		line.frustumCulled = false;
		this.scene.add(line);
		this.fishing = {spot: spot.pos.clone(), dir: spot.dir.clone(), bite: false, landed: false, rod, line, bobber, started: this.clock.elapsedTime};
		worldSounds.play('throw', .75);
		this.announce(true);
		this.cb.onFishAction?.();
	}

	/** Pica un pez: el corcho se hunde y aparece el "!". */
	setBite(on: boolean): void {
		if (!this.fishing || !this.me) return;
		if (on && !this.fishing.bite) worldSounds.play('bite');
		this.fishing.bite = on;
		if (on) this.pop(this.me, iconSvg('alert', 34), null);
	}

	/** Deja de pescar (y, si sacó algo, lo muestra un ratito arriba de la cabeza). */
	stopFishing(caught: {color: string} | null = null): void {
		const f = this.fishing;
		if (!f) return;
		this.fishing = null;
		f.rod.removeFromParent();
		f.line.removeFromParent();
		f.line.geometry.dispose();
		f.bobber.removeFromParent();
		if (this.me) {
			if (caught) {
				const fish = makeFishMesh(caught.color);
				fish.position.set(0, 2.05, 0);
				this.me.avatar.root.add(fish);
				this.me.avatar.play('Wave');
				const born = performance.now();
				const spin = () => {
					const age = (performance.now() - born) / 1000;
					fish.rotation.y = age * 4;
					fish.position.y = 2.05 + Math.sin(age * 6) * 0.05;
					if (age < 1.8 && fish.parent) requestAnimationFrame(spin);
					else fish.removeFromParent();
				};
				spin();
			}
			this.me.anim = 'idle';
			this.announce(true);
		}
	}

	private updateFishing(t: number): void {
		const f = this.fishing;
		if (!f || !this.me) return;
		const bob = f.bite ? -0.1 + Math.sin(t * 22) * 0.05 : Math.sin(t * 2.4) * 0.025;
		const settle = Math.min(1, (t - f.started) * 2.5);
		if (settle === 1 && !f.landed) {
			f.landed = true;
			worldSounds.play('splash');
		}
		f.bobber.position.y = THREE.MathUtils.lerp(0.9, 0.04, settle) + bob;
		const tip = new THREE.Vector3(0, 1.62, 0);
		f.rod.localToWorld(tip);
		const positions = f.line.geometry.attributes.position as THREE.BufferAttribute;
		positions.setXYZ(0, tip.x, tip.y, tip.z);
		positions.setXYZ(1, f.bobber.position.x, f.bobber.position.y + 0.05, f.bobber.position.z);
		positions.needsUpdate = true;
	}

	// ----------------------------------------------------------- decorar ---

	setDecorating(item: {id: string; color?: string | null; rot: number} | null): void {
		this.decorating = item;
		if (this.ghostFixture) {
			// Se canceló (o terminó) de mover algo fijo de la casa: vuelve a donde dice la casa.
			this.ghostFixture = null;
			this.ghost = null;
			this.applyFixtures(this.lastHouse);
		}
		this.ghost?.removeFromParent();
		this.ghost = null;
		const token = ++this.ghostToken;
		if (!item) return;
		const fixture = item.id.startsWith('fixture:') ? this.fixtures.get(item.id.slice(8)) : undefined;
		if (fixture) {
			// La tele, la ventana y la puerta se mueven "de verdad" (pegadas a la pared más cercana).
			this.ghostFixture = item.id.slice(8);
			this.ghost = fixture;
			return;
		}
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

	// ---------------------------------------------- lo fijo de la casa ---
	// La tele, la ventana y la puerta al patio vienen en el modelo de la casa: se agrupan y se pueden
	// mover por las paredes (atrás, izquierda o derecha). Viajan en la casa como muebles 'fixture:*'.

	private fixtures = new Map<string, THREE.Group>();
	private fixtureHome = new Map<string, {x: number; z: number; half: number}>();
	private ghostFixture: string | null = null;
	private lastHouse: PlacedFurniture[] = [];
	private static readonly HOUSE_WALLS = {back: 3.98, left: -4.46, right: 3.96, front: -0.4};

	private collectFixtures(scene: THREE.Object3D): void {
		this.fixtures.clear();
		this.fixtureHome.clear();
		const groups: Array<[string, RegExp, number, number, number]> = [
			['tv', /^(HouseTvStand|Screen|ScreenFrame)$/, 1.3, 3.98, 1.35],
			['window', /^(WindowFrame|WindowSky|wstar_\d+)$/, -1.6, 3.98, 1.0],
			['door', /^(Yard[ _]door([ _](glass|latch|trim))?|Door_yard)$/, -3.13, 3.98, 0.85],
		];
		scene.updateMatrixWorld(true);
		for (const [key, pattern, x, z, half] of groups) {
			const parts: THREE.Object3D[] = [];
			scene.traverse((o) => {
				if (pattern.test(o.name) && !parts.some((p) => p === o.parent)) parts.push(o);
			});
			if (!parts.length) continue;
			const pivot = new THREE.Group();
			pivot.name = `Fixture_${key}`;
			pivot.position.set(x, 0, z);
			scene.add(pivot);
			pivot.updateMatrixWorld(true);
			for (const part of parts) pivot.attach(part);
			this.fixtures.set(key, pivot);
			this.fixtureHome.set(key, {x, z, half});
		}
	}

	/** El punto de la pared más cercano (y hacia dónde mira lo que se cuelga ahí). */
	private snapFixture(key: string, point: THREE.Vector3): {x: number; z: number; rot: number} {
		const W = WorldEngine.HOUSE_WALLS;
		const half = this.fixtureHome.get(key)?.half ?? 1;
		const dBack = Math.abs(point.z - W.back);
		const dLeft = Math.abs(point.x - W.left);
		const dRight = Math.abs(point.x - W.right);
		const clampZ = (z: number) => Math.min(W.back - half - 0.1, Math.max(W.front + half, z));
		if (dBack <= dLeft && dBack <= dRight) return {x: Math.min(W.right - half - 0.1, Math.max(W.left + half + 0.1, point.x)), z: W.back, rot: 0};
		if (dLeft < dRight) return {x: W.left, z: clampZ(point.z), rot: -Math.PI / 2};
		return {x: W.right, z: clampZ(point.z), rot: Math.PI / 2};
	}

	/** Pone la tele, la ventana y la puerta donde las dejó el dueño de la casa. */
	private applyFixtures(items: PlacedFurniture[]): void {
		if (!this.fixtures.size) return;
		for (const [key, pivot] of this.fixtures) {
			if (this.ghostFixture === key) continue;
			const saved = items.find((i) => i.id === `fixture:${key}` && i.x !== null && i.z !== null);
			const home = this.fixtureHome.get(key)!;
			const snap = saved ? this.snapFixture(key, new THREE.Vector3(saved.x as number, 0, saved.z as number)) : {x: home.x, z: home.z, rot: 0};
			pivot.position.set(snap.x, 0, snap.z);
			pivot.rotation.y = snap.rot;
		}
		this.afterFixturesMoved();
	}

	/** Lo que depende de dónde están: el lugar para usar la tele y la puerta al patio. */
	private afterFixturesMoved(): void {
		this.roomGroup.updateMatrixWorld(true);
		if (this.screenMesh && this.fixtures.has('tv')) {
			const p = this.screenMesh.getWorldPosition(new THREE.Vector3());
			const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.fixtures.get('tv')!.quaternion);
			this.tvPoint = this.clamp(new THREE.Vector3(p.x + dir.x * 1.4, 0, p.z + dir.z * 1.4));
		}
		const marker = this.fixtures.get('door')?.getObjectByName('Door_yard');
		const yard = this.doors.find((d) => d.name === 'yard');
		if (marker && yard) {
			marker.getWorldPosition(yard.pos);
			yard.pos.y = 0;
			const dir = marker.getWorldDirection(new THREE.Vector3());
			yard.ry = Math.atan2(dir.x, dir.z);
		}
	}

	/** Lo fijo de la casa que tocaste (modo decorar). */
	private pickFixture(): string | null {
		for (const [key, pivot] of this.fixtures) {
			if (this.raycaster.intersectObject(pivot, true).length) return key;
		}
		return null;
	}

	rotateGhost(): void {
		if (!this.decorating || this.ghostFixture) return;
		worldSounds.play('highlight');
		this.decorating.rot = (this.decorating.rot + Math.PI / 4) % (Math.PI * 2);
		if (this.ghost) this.ghost.rotation.y = this.decorating.rot;
	}

	// ------------------------------------------------------------ entrada ---

	private onKeyDown = (event: KeyboardEvent): void => {
		const target = event.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
		if (!this.active || this.controlsBlocked) return;
		const key = event.key.toLowerCase();
		if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
			this.keys.add(key);
			if (key.startsWith('arrow')) event.preventDefault();
		}
		// En un juego de la Arena, E / Espacio es la acción del juego (empujar, agarrar la cola…).
		// Espacio: saltar (en todo el mundo).
		if (key === ' ' && !event.repeat) {
			event.preventDefault();
			this.jump();
			return;
		}
		if (key === 'e' && !event.repeat && this.mode?.action?.()) {
			worldSounds.play('throw', .76);
			event.preventDefault();
			return;
		}
		if (key === 'e' && !event.repeat) this.interact();
		if (key === 'r' && this.decorating) this.rotateGhost();
	};

	private onKeyUp = (event: KeyboardEvent): void => {
		this.keys.delete(event.key.toLowerCase());
	};

	private onBlur = (): void => this.keys.clear();

	private onPointerDown = (event: PointerEvent): void => {
		if (this.controlsBlocked) return;
		this.pointerDown = {x: event.clientX, y: event.clientY};
		this.renderer.domElement.focus();
	};

	private onPointerMove = (event: PointerEvent): void => {
		if (this.gardenTool && this.loadedRoom?.startsWith('yard:') && this.gardenLand) {
			const point = this.floorPoint(event);
			if (!point) this.garden.point();
			else {
				const x = Math.round(point.x);
				const z = Math.round(point.z);
				this.garden.point(x, z, inLot(this.gardenLand.level, x, z) && Boolean(this.me && Math.hypot(x - this.me.pos.x, z - this.me.pos.z) <= 2.8));
			}
		}
		if (!this.ghost) return;
		const point = this.floorPoint(event);
		if (point && this.ghostFixture) {
			const snap = this.snapFixture(this.ghostFixture, point);
			this.ghost.position.set(snap.x, 0, snap.z);
			this.ghost.rotation.y = snap.rot;
			this.afterFixturesMoved();
		} else if (point) this.ghost.position.copy(point);
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

	/** Cosas que se animan cuadro a cuadro desde afuera (la mesa de juegos). */
	readonly tickers = new Set<(dt: number) => void>();

	private clamp(point: THREE.Vector3): THREE.Vector3 {
		const b = this.bounds;
		if (b.kind === 'circle') {
			const length = Math.hypot(point.x, point.z);
			if (length > b.radius) point.multiplyScalar(b.radius / length);
		} else if (b.rects || b.circles) {
			let best: [number, number] | null = null;
			let bestD = Infinity;
			for (const [cx, cz, r] of b.circles ?? []) {
				const dx = point.x - cx;
				const dz = point.z - cz;
				const len = Math.hypot(dx, dz);
				const k = len > r ? r / len : 1;
				const x = cx + dx * k;
				const z = cz + dz * k;
				const d = (x - point.x) ** 2 + (z - point.z) ** 2;
				if (d < bestD) {
					bestD = d;
					best = [x, z];
				}
			}
			for (const [x1, x2, z1, z2] of b.rects ?? []) {
				const x = THREE.MathUtils.clamp(point.x, x1, x2);
				const z = THREE.MathUtils.clamp(point.z, z1, z2);
				const d = (x - point.x) ** 2 + (z - point.z) ** 2;
				if (d < bestD) {
					bestD = d;
					best = [x, z];
				}
			}
			if (best) [point.x, point.z] = best;
		} else {
			point.x = THREE.MathUtils.clamp(point.x, b.minX, b.maxX);
			point.z = THREE.MathUtils.clamp(point.z, b.minZ, b.maxZ);
		}
		// Edificios: si quedó adentro de uno, se lo empuja al borde más cercano.
		for (const [x1, x2, z1, z2] of b.solids ?? []) {
			const minX = x1 - BODY_RADIUS;
			const maxX = x2 + BODY_RADIUS;
			const minZ = z1 - BODY_RADIUS;
			const maxZ = z2 + BODY_RADIUS;
			if (point.x <= minX || point.x >= maxX || point.z <= minZ || point.z >= maxZ) continue;
			const pushes = [point.x - minX, maxX - point.x, point.z - minZ, maxZ - point.z];
			const k = pushes.indexOf(Math.min(...pushes));
			if (k === 0) point.x = minX;
			else if (k === 1) point.x = maxX;
			else if (k === 2) point.z = minZ;
			else point.z = maxZ;
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
			if (point && this.ghostFixture) {
				const snap = this.snapFixture(this.ghostFixture, point);
				worldSounds.play('place');
				this.cb.onPlace(snap.x, snap.z, snap.rot);
			} else if (point) {
				worldSounds.play('place');
				this.cb.onPlace(point.x, point.z, this.decorating.rot);
			}
			return;
		}
		if (this.room === `house:${this.meId}` && this.editMode) {
			const fixture = this.pickFixture();
			if (fixture) {
				this.cb.onFurniturePick(`fixture:${fixture}`);
				return;
			}
		}
		if (this.room === `house:${this.meId}` && this.furnitureClickable.size && this.editMode) {
			const hits = this.raycaster.intersectObjects(this.furnitureGroup.children, true);
			const uid = hits.length ? this.furnitureClickable.get(hits[0].object) : undefined;
			if (uid) {
				this.cb.onFurniturePick(uid);
				return;
			}
		}
		// El clic NO camina (se camina con WASD): el clic empuja al que tengas cerca.
		if (this.gardenTool && this.loadedRoom?.startsWith('yard:') && this.room === this.loadedRoom) {
			const point = this.floorPoint(event);
			if (point && this.cb.onGroundAction?.(point.x, point.z)) return;
		}
		if (this.mode?.action?.()) return;
		this.cb.onShove?.();
	};

	/** Clic derecho sobre alguien: su tarjetita (ir a su casa). */
	private onContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
		this.raycaster.setFromCamera(this.ndc(event as PointerEvent), this.camera);
		const actorHits = this.raycaster.intersectObjects([...this.others.values()].map((a) => a.avatar.root), true);
		if (!actorHits.length) return;
		let obj: THREE.Object3D | null = actorHits[0].object;
		while (obj && !obj.userData.playerId) obj = obj.parent;
		if (obj?.userData.playerId) this.cb.onPlayerClick(obj.userData.playerId as string);
	};

	private jumping = false;

	/** Salto: sólo desde el piso (y no sentado ni pescando). */
	jump(): void {
		const me = this.me;
		if (!me || this.falling || me.seat || this.fishing || this.tableSeat !== null || this.mode?.frozen?.()) return;
		this.falling = true;
		this.jumping = true;
		this.fallV = 7.6;
		me.anim = 'jump';
		this.announce(true);
	}

	/** Está en el aire por un salto (para esquivar barras y balas). */
	isJumping(): boolean {
		return this.jumping;
	}

	/** Se activa recién cuando saliste de la zona (si no, al volver del campamento te metía de nuevo). */
	private zonesArmed = false;

	private checkWalkInZones(actor: Actor): void {
		let inside: Door | null = null;
		for (const door of this.doors) {
			if (door.name === 'arena') {
				// Castillo: se entra al pasar por debajo del arco.
				if (actor.pos.z > door.pos.z + 1.2 && Math.abs(actor.pos.x - door.pos.x) < 1.3) inside = door;
				continue;
			}
			if (door.name !== 'campfire' && door.name !== 'port') continue;
			const near = Math.hypot(actor.pos.x - door.pos.x, actor.pos.z - door.pos.z) < 1.4;
			// Pasado el cartel, hacia el bosque o el muelle (abajo): también entra.
			const beyond = actor.pos.z < door.pos.z + 0.4 && Math.abs(actor.pos.x - door.pos.x) < 3;
			if (near || beyond) inside = door;
		}
		if (!inside) {
			this.zonesArmed = true;
			return;
		}
		if (!this.zonesArmed) return;
		this.zonesArmed = false;
		this.cb.onDoor(inside.room);
	}

	/** El más cercano adelante mío (para empujar): jugador o bot. */
	shoveTarget(maxDistance = 1.8): {id: string; dx: number; dz: number} | null {
		if (!this.me) return null;
		let best: {id: string; dx: number; dz: number} | null = null;
		let bestD = maxDistance;
		for (const [id, actor] of [...this.others, ...this.bots]) {
			const dx = actor.pos.x - this.me.pos.x;
			const dz = actor.pos.z - this.me.pos.z;
			const d = Math.hypot(dx, dz);
			if (d < bestD) {
				bestD = d;
				best = {id, dx, dz};
			}
		}
		return best;
	}

	/** Modo decorar: clic en un mueble lo agarra para moverlo. */
	editMode = false;

	capturePet(id: string, commit: (species: PetId) => boolean): PetId | null {
		if (this.room !== 'city' || !this.me || this.me.seat) return null;
		return this.pets.tryCapture(id, this.me.pos, commit);
	}

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
			this.cb.onDoor(this.loadedRoom?.startsWith('yard:') ? `house:${this.loadedRoom.slice(5)}` : 'city');
			return;
		}
		if (action.kind === 'npc') this.npcs.wave(action.npc);
		if (action.kind === 'fish') {
			if (this.fishing) this.cb.onFishAction?.();
			else {
				const spot = this.nearestFishSpot();
				if (spot) this.startFishing(spot);
			}
		}
		this.cb.onInteract(action);
	}

	private sit(seat: Seat): void {
		if (!this.me) return;
		worldSounds.play('fabric');
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
		worldSounds.play('fabric', .72);
		const seat = this.seats.find((s) => s.id === this.me!.seat);
		const front = this.me.pos.clone();
		if (seat) front.add(seat.object.getWorldDirection(new THREE.Vector3()).setY(0).normalize().multiplyScalar(0.6));
		this.me.pos.copy(this.clamp(front));
		this.me.target.copy(this.me.pos);
		this.me.seat = null;
		this.me.anim = 'idle';
		this.me.avatar.setBase('idle');
		this.leaveTable();
		this.setTvView(false);
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
		this.cb.onLocalChange({x: this.me.pos.x, z: this.me.pos.z, ry: this.me.ry, anim: this.me.anim, seat: this.me.seat, tx: this.me.target.x, tz: this.me.target.z, y: Math.round(this.me.pos.y * 100) / 100});
	}

	// ------------------------------------------------------- modo juego ---

	/** Un juego de la Arena: cambia los límites, el piso (para caerse) y agrega su lógica por cuadro. */
	mode: WorldMode | null = null;
	/** Cámara más lejos (se ve todo el campo) durante una partida. */
	partyCamera = false;
	private meVel = new THREE.Vector3();
	private fallV = 0;
	private falling = false;
	/** Los bots de la Arena (personajes de verdad, manejados por el que organiza la partida). */
	readonly bots = new Map<string, Actor>();

	setMode(mode: WorldMode | null): void {
		this.mode = mode;
		this.partyCamera = Boolean(mode?.wideCamera);
		this.resetFall();
	}

	resetFall(): void {
		this.jumping = false;
		this.falling = false;
		this.fallV = 0;
		this.meVel.set(0, 0, 0);
		if (this.me) this.me.pos.y = 0;
	}

	/** Empujón (cachetada, barra que gira, barril…): una velocidad que se va frenando. */
	push(dx: number, dz: number, strength: number): void {
		// Sólo suenan los golpes de verdad: los empujoncitos de cada cuadro (el barco inclinado)
		// hacían sonar 'place' sin parar, re fuerte y trabado. Y como mucho un golpe cada 150 ms.
		const now = performance.now();
		if (strength >= 3 && now - this.lastPushSound > 150) {
			this.lastPushSound = now;
			worldSounds.play('place', .63);
		}
		const len = Math.hypot(dx, dz) || 1;
		this.meVel.x += (dx / len) * strength;
		this.meVel.z += (dz / len) * strength;
	}

	private lastPushSound = 0;

	teleport(x: number, z: number, ry = 0): void {
		if (!this.me) return;
		this.resetFall();
		if (this.me.seat) this.standUp();
		this.me.pos.set(x, 0, z);
		this.me.target.copy(this.me.pos);
		this.me.ry = ry;
		this.me.anim = 'idle';
		this.announce(true);
	}

	myState(): {x: number; y: number; z: number; ry: number; falling: boolean} {
		const p = this.me?.pos;
		return {x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0, ry: this.me?.ry ?? 0, falling: this.falling};
	}

	/** Dónde está cada uno (yo, los demás de esta sala y los bots). */
	allPositions(): Record<string, {x: number; y: number; z: number}> {
		const out: Record<string, {x: number; y: number; z: number}> = {};
		if (this.me) out[this.meId] = {x: this.me.pos.x, y: this.me.pos.y, z: this.me.pos.z};
		for (const [id, a] of this.others) out[id] = {x: a.pos.x, y: a.pos.y, z: a.pos.z};
		for (const [id, a] of this.bots) out[id] = {x: a.pos.x, y: a.pos.y, z: a.pos.z};
		return out;
	}

	/** Crea o mueve un bot. */
	setBot(id: string, name: string, look: Look, x: number, y: number, z: number, ry: number, anim: Anim): void {
		let actor = this.bots.get(id);
		if (!actor) {
			actor = this.createActor(id, name, '#ffd23f', look);
			actor.labelEl.classList.add('is-bot');
			actor.pos.set(x, y, z);
			this.bots.set(id, actor);
		}
		actor.target.set(x, y, z);
		actor.anim = anim;
		if (!isMoving(anim)) actor.ry = ry;
	}

	removeBot(id: string): void {
		const actor = this.bots.get(id);
		if (!actor) return;
		actor.avatar.dispose();
		this.bots.delete(id);
	}

	clearBots(): void {
		for (const id of [...this.bots.keys()]) this.removeBot(id);
	}

	/** El personaje de alguien (yo, otro jugador o un bot), para colgarle cosas (colas, disfraces). */
	actorRoot(id: string): THREE.Object3D | null {
		if (id === this.meId) return this.me?.avatar.root ?? null;
		return this.others.get(id)?.avatar.root ?? this.bots.get(id)?.avatar.root ?? null;
	}

	/** Esconde o muestra el cuerpo de alguien (para disfrazarlo de juguete). */
	setBodyHidden(id: string, hidden: boolean): void {
		const root = this.actorRoot(id);
		if (!root) return;
		for (const child of root.children) if (!(child.userData.partyProp)) child.visible = !hidden;
	}

	private stepBot(actor: Actor, dt: number): void {
		const to = actor.target.clone().sub(actor.pos);
		const flat = Math.hypot(to.x, to.z);
		actor.pos.lerp(actor.target, Math.min(1, dt * 7));
		if (flat > 0.04) this.turn(actor, Math.atan2(to.x, to.z), dt);
		actor.avatar.setBase(flat > 0.04 && isMoving(actor.anim) ? (actor.anim as BaseAnim) : actor.anim === 'walk' || actor.anim === 'run' ? 'idle' : (actor.anim as BaseAnim));
		this.place(actor, dt);
	}

	/** Mueve respetando el modo de juego (si hay) y sin perder la altura (para caerse). */
	private clampMove(p: THREE.Vector3): THREE.Vector3 {
		const y = p.y;
		const out = this.mode?.clamp ? this.mode.clamp(p) : this.clamp(p);
		out.y = y;
		return out;
	}

	// ------------------------------------------------------------- cuadro ---

	/** Prende o apaga el modo "ver la tele". */
	setTvView(on: boolean): void {
		const next = on && this.screenMesh !== null;
		if (next === this.tvView) return;
		this.tvView = next;
		this.cb.onTvView?.(next);
	}

	isTvView(): boolean {
		return this.tvView;
	}

	/** Dónde poner la cámara para que la pantalla ocupe ~3/4 del ancho (sin taparlo todo). */
	private tvCamera(): {pos: THREE.Vector3; look: THREE.Vector3} | null {
		const mesh = this.screenMesh;
		if (!mesh) return null;
		if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
		const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
		const center = mesh.getWorldPosition(new THREE.Vector3());
		const width = Math.max(size.x, size.z) * Math.max(mesh.getWorldScale(new THREE.Vector3()).x, 1e-3);
		// Hacia dónde mira la pantalla: hacia el lado donde está la sala (la puerta de entrada).
		const normal = new THREE.Vector3(0, 0, Math.sign(this.spawn.z - center.z) || -1);
		const vfov = THREE.MathUtils.degToRad(this.camera.fov);
		const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
		const distance = (width / 0.74) / 2 / Math.tan(hfov / 2);
		const pos = center.clone().add(normal.multiplyScalar(distance));
		pos.y = center.y + 0.55;
		return {pos, look: center};
	}

	private cameraGoal(): THREE.Vector3 {
		if (this.tvView) {
			const tv = this.tvCamera();
			if (tv) return tv.pos;
		}
		const focus = this.me ? this.me.pos : this.spawn;
		if (this.tableSeat !== null && this.tableCenter) {
			const angle = this.tableAngle(this.tableSeat);
			return new THREE.Vector3(this.tableCenter.x + Math.sin(angle) * 2.05, this.tableCenter.y + 2.2, this.tableCenter.z + Math.cos(angle) * 2.05);
		}
		if (this.room === 'city') {
			const edge = Math.min(1, Math.abs(focus.x) / 14);
			return new THREE.Vector3(focus.x * .93 + .48, (4.04 + 1.9 * edge ** 4) * this.zoom, focus.z - 8.35 * this.zoom);
		}
		if (this.room === 'arena') {
			// Arena: más lejos y alta (el campo es grande); en una partida, todavía más (se ve todo).
			// Si caés a un piso de abajo, la cámara baja con vos.
			const far = this.partyCamera ? 1.75 : 1.4;
			const down = Math.max(-8, Math.min(0, focus.y));
			return new THREE.Vector3(focus.x * 0.85, 5.6 * this.zoom * far + down, focus.z - 7.0 * this.zoom * far);
		}
		if (this.room === 'campfire' || this.room === 'port' || this.room?.startsWith('yard:')) {
			const far = this.room === 'campfire' ? 1.1 : 1.25;
			return new THREE.Vector3(focus.x, 5.4 * this.zoom * far, focus.z - 7.2 * this.zoom * far);
		}
		// Adentro: más alta y mirando más hacia abajo, y sin pasarse del borde de la sala (si no se
		// veía el vacío negro de afuera del piso).
		const b = this.bounds;
		const z = Math.max(focus.z, b.minZ + 2.4);
		if (this.room === 'casino') return new THREE.Vector3(focus.x * 0.76, 7.45 * this.zoom, z - 7.35 * this.zoom);
		return new THREE.Vector3(focus.x * 0.8, 6.3 * this.zoom, z - 6.0 * this.zoom);
	}

	private loop = (): void => {
		if (this.disposed) return;
		this.frame = requestAnimationFrame(this.loop);
		if (!this.active) {
			this.clock.getDelta();
			return;
		}
		// Tiempo real (hasta 1/4 s): así caminar va a la misma velocidad aunque la PC dé pocos cuadros.
		const dt = Math.min(0.25, this.clock.getDelta());
		const t = this.clock.elapsedTime;
		if (this.me) this.stepMe(this.me, dt);
		for (const actor of this.others.values()) this.stepOther(actor, dt);
		for (const actor of this.bots.values()) this.stepBot(actor, dt);
		this.npcs.update(dt, this.me?.pos ?? null, this.musicOn, this.camera.position, (a, d) => this.turn(a, d.wanted, d.dt));
		this.pets.update(dt);
		const night = this.ambience.update(t);
		this.garden.tick(dt);
		this.effects.tick(dt, t, this.musicOn, this.screening, this.partyMode);
		this.dust.update(dt);
		this.updateFishing(t);
		for (const tick of this.tickers) tick(dt);
		const taken = new Set<string>([...this.others.values()].map((a) => a.seat).filter(Boolean) as string[]);
		if (this.me?.seat) taken.add(this.me.seat);
		for (const name of this.npcs.takenSeats()) for (const seat of this.seats) if (seat.object.name === name) taken.add(seat.id);
		for (const seat of this.seats) {
			seat.ring.visible = !taken.has(seat.id) && this.tableSeat === null;
			const s = 1 + Math.sin(t * 3 + seat.ring.position.x) * 0.06;
			seat.ring.scale.set(s, s, s);
		}
		this.updatePrompt(taken);
		// Mirando la tele: sin carteles ni mi nombre encima de la pantalla.
		if (this.tvView || this.tableSeat !== null) this.prompt.visible = false;
		if (this.me) {
			this.me.label.visible = !this.tvView && this.tableSeat === null;
			// En la mesa la cámara va detrás de mi silla: mi propia cabeza tapaba mis cartas.
			this.me.avatar.root.visible = this.tableSeat === null;
		}

		const goal = this.cameraGoal();
		this.camPos.lerp(goal, 1 - Math.pow(0.0015, dt));
		this.camera.position.copy(this.camPos);
		const inside = this.room !== 'city' && this.room !== 'campfire' && this.room !== 'port' && this.room !== 'arena' && !this.room?.startsWith('yard:');
		const city = this.room === 'city';
		const lookZ = inside ? Math.max(this.me?.pos.z ?? 0, this.bounds.minZ + 2.4) + .9 : (this.me?.pos.z ?? 0) + (city ? 2.15 : .6);
		const tvCam = this.tvView ? this.tvCamera() : null;
		const lookGoal = tvCam ? tvCam.look : this.tableSeat !== null && this.tableCenter ? this.tableCenter : new THREE.Vector3((this.me?.pos.x ?? 0) * (inside ? .8 : 1), (city ? 1.65 : .6) + (this.room === 'arena' ? Math.max(-8, Math.min(0, this.me?.pos.y ?? 0)) : 0), lookZ);
		this.camLook.lerp(lookGoal, 1 - Math.pow(0.0015, dt));
		this.camera.lookAt(this.camLook);
		if (this.me) this.sun.target.position.set(this.me.pos.x, 0, this.me.pos.z);
		this.sun.position.set((this.me?.pos.x ?? 0) - (city ? 8.4 : 4), city ? 10.8 : 12, (this.me?.pos.z ?? 0) - 6);
		this.occlusion.update(this.camera.position, this.tvView || this.tableSeat !== null ? null : this.me?.pos ?? null, dt);

		if (this.controlsBlocked) return;
		// Enfoque en mi personaje: afuera el fondo se desenfoca más; en la mesa o mirando la tele, casi nada.
		if (this.fx) {
			const focusAt = this.tvView || this.tableSeat !== null ? this.camLook : (this.me?.pos ?? this.camLook);
			const outdoor = !inside;
			// Adentro (casas, locales) nada de desenfoque ni brillo: encandilaba todo.
			// En la Arena, sin brillo (bloom): los pisos claros quedaban encandilados y no se veía nada.
			this.fx.setOutdoor(outdoor, outdoor && this.room !== 'arena');
			this.fx.setFocus(this.camera.position.distanceTo(focusAt), this.tvView || this.tableSeat !== null ? 0.15 : 1, night);
			this.fx.render(this.scene, this.camera);
		} else this.renderer.render(this.scene, this.camera);
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
		// En un juego: congelado en la cuenta regresiva o si te caíste.
		// Quieto en la cuenta regresiva o cayendo al pozo; en un salto sí se puede dirigir en el aire.
		if (this.mode?.frozen?.() || (this.falling && !this.jumping) || actor.pos.y < -0.6) {
			ix = 0;
			iz = 0;
		}
		if ((ix || iz) && !typing && this.tableSeat === null) {
			if (actor.seat) this.standUp();
			if (this.fishing) this.stopFishing();
			this.setTvView(false);
			const length = Math.hypot(ix, iz);
			const speed = (this.keys.has('shift') ? RUN_SPEED : WALK_SPEED) * (this.mode?.speed ?? 1);
			const next = actor.pos.clone().add(new THREE.Vector3((ix / length) * speed * dt, 0, (iz / length) * speed * dt));
			actor.pos.copy(this.clampMove(next));
			actor.target.copy(actor.pos).add(new THREE.Vector3((ix / length) * 0.8, 0, (iz / length) * 0.8));
			this.turn(actor, Math.atan2(ix, iz), dt);
			// Con Shift corre (otra animación, no la misma caminata apurada).
			const gait: Anim = this.keys.has('shift') ? 'run' : 'walk';
			if (actor.anim !== gait) {
				actor.anim = gait;
				this.announce(true);
			} else {
				this.announce();
			}
			this.moved = true;
		} else if (isMoving(actor.anim)) {
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
				actor.pos.copy(this.clampMove(actor.pos));
				this.turn(actor, Math.atan2(toTarget.x, toTarget.z), dt);
				this.announce();
			}
		}
		// Física de los juegos: empujones que se frenan y caerse si no hay piso.
		// Campamento y puerto: se entra con sólo bajar caminando a esa zona (sin apretar E).
		if (this.room === 'city') this.checkWalkInZones(actor);
		// Empujones (cachetadas, barras, barriles): en todo el mundo, no sólo en la Arena.
		if (this.meVel.lengthSq() > 1e-4) {
			if (actor.seat) this.standUp();
			actor.pos.copy(this.clampMove(actor.pos.clone().addScaledVector(this.meVel, dt)));
			this.meVel.multiplyScalar(Math.pow(0.03, dt));
			this.announce();
		}
		if (this.mode?.ground) {
			// Con varios pisos: caés hasta el de abajo (y si no hay ninguno, seguís cayendo).
			const floorY = this.mode.ground(actor.pos.x, actor.pos.z, actor.pos.y);
			if (floorY === null || actor.pos.y > floorY + 0.02) {
				this.falling = true;
				this.fallV -= 22 * dt;
				actor.pos.y += this.fallV * dt;
				if (floorY !== null && actor.pos.y <= floorY) {
					actor.pos.y = floorY;
					this.fallV = 0;
					this.falling = false;
				}
				this.announce();
			} else actor.pos.y = floorY;
			this.mode.update?.(dt);
		} else {
			const supported = this.mode?.support ? this.mode.support(actor.pos.x, actor.pos.z) : true;
			if ((!supported && actor.pos.y <= 0.05) || this.falling) {
				if (!this.falling && !this.jumping) worldSounds.play('cancel', .78);
				this.falling = true;
				this.fallV -= 22 * dt;
				actor.pos.y += this.fallV * dt;
				// Aterriza de un salto si hay piso abajo.
				if (supported && actor.pos.y <= 0 && this.fallV <= 0) {
					actor.pos.y = 0;
					this.fallV = 0;
					this.falling = false;
				}
				this.announce();
			}
			this.mode?.update?.(dt);
		}
		if (this.jumping && !this.falling) {
			this.jumping = false;
			if (actor.anim === 'jump') actor.anim = 'idle';
			this.announce(true);
		}
		actor.avatar.setBase(this.falling ? 'jump' : this.visualAnim(actor.anim));
		this.place(actor, dt);
	}

	/** Lo que se ve de un jugador. Con música en la tele bailan sólo los NPC: los jugadores bailan
	 * cuando ellos quieren (con el emote). */
	private visualAnim(anim: Anim): BaseAnim {
		return anim;
	}

	private stepOther(actor: Actor, dt: number): void {
		if (isMoving(actor.anim)) {
			const toTarget = actor.target.clone().sub(actor.pos).setY(0);
			const distance = toTarget.length();
			if (distance > 0.05) {
				actor.pos.add(toTarget.normalize().multiplyScalar(Math.min(distance, (actor.anim === 'run' ? RUN_SPEED * 1.15 : WALK_SPEED * 1.3) * dt)));
				this.turn(actor, Math.atan2(toTarget.x, toTarget.z), dt);
			}
			actor.avatar.setBase(distance > 0.05 ? (actor.anim as BaseAnim) : this.visualAnim('idle'));
		} else {
			// Quieto: se acomoda suave adonde dice que está (antes podía quedar hasta 2 m corrido).
			if (!actor.seat && actor.pos.distanceTo(actor.target) > 0.02) actor.pos.lerp(actor.target, Math.min(1, dt * 6));
			actor.avatar.setBase(actor.avatar.isGhost() ? 'idle' : this.visualAnim(actor.anim));
		}
		this.place(actor, dt);
	}

	private turn(actor: {ry: number}, wanted: number, dt: number): void {
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
		actor.companion?.update(actor.pos, actor.ry, dt);
		this.kickDust(actor, dt);
	}

	private dust!: Dust;
	private dustState = new WeakMap<object, {t: number; gait: string; foot: number}>();

	/** Polvito de los pies: al correr, al arrancar y al frenar (y un poquito al caminar). */
	private kickDust(actor: Actor, dt: number): void {
		const gait = actor.avatar.getBase();
		let state = this.dustState.get(actor);
		if (!state) {
			state = {t: 0, gait, foot: 1};
			this.dustState.set(actor, state);
		}
		const back = new THREE.Vector3(-Math.sin(actor.ry), 0, -Math.cos(actor.ry));
		const side = new THREE.Vector3(Math.cos(actor.ry), 0, -Math.sin(actor.ry));
		if (gait !== state.gait) {
			// Arranca a correr: ¡puf! grande. Frena de golpe: nubecita adelante.
			if (gait === 'run') this.dust.emit(actor.pos, 7, {back, size: 0.3, spread: 0.9, up: 0.4});
			else if (state.gait === 'run' && (gait === 'idle' || gait === 'walk')) this.dust.emit(actor.pos.clone().addScaledVector(back, -0.25), 5, {size: 0.26, spread: 0.8, up: 0.3});
			state.gait = gait;
			state.t = 0;
		}
		if (gait !== 'run' && gait !== 'walk') return;
		state.t -= dt;
		if (state.t > 0) return;
		state.foot *= -1;
		const foot = actor.pos.clone().addScaledVector(side, 0.09 * state.foot).addScaledVector(back, 0.12);
		if (gait === 'run') {
			this.dust.emit(foot, 2, {back, size: 0.32, spread: 0.4, up: 0.35, life: 0.65});
			state.t = 0.16;
		} else {
			this.dust.emit(foot, 1, {back, size: 0.14, spread: 0.2, up: 0.2, life: 0.45});
			state.t = 0.34;
		}
	}

	/** Busca lo más cercano con lo que se puede interactuar y muestra el cartel "E …". */
	private updatePrompt(taken: Set<string>): void {
		if (this.room !== this.loadedRoom) return;
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
			if (this.fishing) {
				best = {action: {kind: 'fish', label: this.fishing.bite ? '¡Recoger!' : 'Esperando que pique… (E para soltar)'}, at: me.pos.clone(), d: 0};
			} else if (me.seat) {
				best = {action: {kind: 'stand', label: this.tableSeat !== null ? 'Levantarte de la mesa' : 'Pararte'}, at: me.pos.clone().setY(1.95), d: 0};
			} else {
				for (const seat of this.seats) {
					if (taken.has(seat.id)) continue;
					const p = seat.object.getWorldPosition(new THREE.Vector3());
					consider({kind: 'seat', id: seat.id, label: seat.table !== null ? 'Sentarte a jugar' : 'Sentarte'}, p.clone().setY(p.y + 0.55), SEAT_RANGE, 0.6);
				}
				for (const door of this.doors) consider({kind: 'door', room: door.room, label: `Entrar ${DOOR_LABELS[door.name] ?? 'a ' + door.name}`}, door.pos.clone().setY(2.4), DOOR_RANGE);
				if (this.exitPoint) consider({kind: 'exit', label: this.loadedRoom?.startsWith('yard:') ? 'Volver a casa' : 'Salir a la ciudad'}, this.exitPoint.clone().setY(this.exitDoorSpot ? 2.5 : 1.6), this.exitDoorSpot ? 1.5 : 1.3);
				if (this.tvPoint) consider({kind: 'tv', label: this.loadedRoom === 'campfire' ? 'Usar la radio' : 'Usar la tele'}, this.tvPoint.clone().setY(1.6), 1.8);
				for (const npc of this.npcs.talkers()) consider({kind: 'npc', npc: npc.kind, label: npc.label}, npc.pos.clone().setY(2.2), 2.2);
				const spot = this.nearestFishSpot();
				if (spot) consider({kind: 'fish', label: 'Pescar'}, spot.pos.clone().setY(1.6), 1.5, 0.3);
				if (this.room === 'city') {
					for (const pet of this.pets.targets()) consider({kind: 'pet', id: pet.id, label: `Atrapar a ${pet.name}`}, pet.position, CAPTURE_RANGE);
				}
				for (const h of this.hotspots) {
					const label = HOTSPOT_LABELS[h.kind] ?? 'Caja';
					const bonus = h.kind.startsWith('casino-') ? 0.4 : 0;
					consider({kind: 'hotspot', hotspot: h.kind, label}, h.pos.clone().setY(1.7), 1.25, bonus);
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
			const icon = found.action.kind === 'hotspot' ? HOTSPOT_ICONS[found.action.hotspot] ?? 'shirt' :
				found.action.kind === 'npc' ? 'chat' : found.action.kind === 'pet' ? 'paw' :
				found.action.kind === 'seat' || found.action.kind === 'stand' ? 'sofa' : found.action.kind;
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
		this.fx?.setSize(width, height);
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
		this.me?.companion?.dispose();
		this.npcs.dispose();
		this.pets.dispose();
		this.ambience.dispose();
		this.effects.dispose();
		this.garden.dispose();
		worldSounds.leave();
		this.dust.dispose();
		this.occlusion.clear();
		for (const actor of this.others.values()) {
			actor.avatar.dispose();
			actor.companion?.dispose();
		}
		this.screenVideo?.pause();
		this.fx?.dispose();
		this.renderer.dispose();
		this.renderer.domElement.remove();
		this.labels.domElement.remove();
	}
}

/**
 * La pantalla viene de Blender sin coordenadas de textura (UV): sin esto el video o el cartel de la
 * tele se veía como un color liso (era el "no se ve nada en la tele"). Se proyecta de frente.
 */
function planarScreenUv(geometry: THREE.BufferGeometry): void {
	if (geometry.userData.planarUv) return;
	geometry.computeBoundingBox();
	const bb = geometry.boundingBox!;
	const size = bb.getSize(new THREE.Vector3());
	// Los dos ejes más largos son el ancho y el alto de la pantalla.
	const axes = (['x', 'y', 'z'] as const).slice().sort((a, b) => size[b] - size[a]);
	const [ua, va] = axes[0] === 'y' ? [axes[1], axes[0]] : [axes[0], axes[1]];
	const pos = geometry.attributes.position as THREE.BufferAttribute;
	const uv = new Float32Array(pos.count * 2);
	for (let i = 0; i < pos.count; i++) {
		const p = new THREE.Vector3().fromBufferAttribute(pos, i);
		uv[i * 2] = (p[ua] - bb.min[ua]) / (size[ua] || 1);
		uv[i * 2 + 1] = (p[va] - bb.min[va]) / (size[va] || 1);
	}
	geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	geometry.userData.planarUv = true;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function clockText(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
	if (ctx.measureText(text).width <= max) return text;
	let cut = text;
	while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
	return `${cut}…`;
}

/** La pantalla de "sonando ahora" de la tele. */
function drawMusicCard(
	canvas: HTMLCanvasElement,
	info: {title: string; author?: string; positionMs: number; duration: number; paused: boolean; next?: string | null; loading?: boolean},
	image: HTMLImageElement | null,
): void {
	const ctx = canvas.getContext('2d')!;
	const W = canvas.width;
	const H = canvas.height;
	const gradient = ctx.createLinearGradient(0, 0, W, H);
	gradient.addColorStop(0, '#2b1650');
	gradient.addColorStop(1, '#6b2f7d');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, W, H);
	if (image) {
		ctx.save();
		ctx.globalAlpha = 0.28;
		ctx.filter = 'blur(18px)';
		ctx.drawImage(image, -60, -60, W + 120, H + 120);
		ctx.restore();
	}
	const size = 300;
	const x0 = 70;
	const y0 = 90;
	ctx.save();
	roundRect(ctx, x0, y0, size, size, 28);
	ctx.clip();
	if (image) {
		const scale = Math.max(size / image.width, size / image.height);
		ctx.drawImage(image, x0 + size / 2 - (image.width * scale) / 2, y0 + size / 2 - (image.height * scale) / 2, image.width * scale, image.height * scale);
	} else {
		ctx.fillStyle = '#3d2466';
		ctx.fillRect(x0, y0, size, size);
	}
	ctx.restore();
	ctx.lineWidth = 6;
	ctx.strokeStyle = 'rgba(255,244,221,0.9)';
	roundRect(ctx, x0, y0, size, size, 28);
	ctx.stroke();
	const tx = x0 + size + 50;
	const maxW = W - tx - 60;
	ctx.fillStyle = '#ffd36b';
	ctx.font = 'bold 30px "Fredoka", "Segoe UI", sans-serif';
	ctx.fillText(info.loading ? 'CARGANDO…' : info.paused ? 'EN PAUSA' : 'SONANDO AHORA', tx, 130);
	ctx.fillStyle = '#fff4dd';
	ctx.font = 'bold 52px "Fredoka", "Segoe UI", sans-serif';
	const lines: string[] = [];
	let line = '';
	for (const word of info.title.split(' ')) {
		const test = line ? `${line} ${word}` : word;
		if (ctx.measureText(test).width > maxW && line) {
			lines.push(line);
			line = word;
		} else line = test;
	}
	if (line) lines.push(line);
	lines.slice(0, 2).forEach((l, i) => ctx.fillText(fitText(ctx, l, maxW), tx, 200 + i * 60));
	if (info.author) {
		ctx.fillStyle = 'rgba(255,244,221,0.7)';
		ctx.font = '34px "Fredoka", "Segoe UI", sans-serif';
		ctx.fillText(fitText(ctx, info.author, maxW), tx, 200 + Math.min(2, lines.length) * 60 + 10);
	}
	const by = 360;
	ctx.fillStyle = '#fff4dd';
	ctx.beginPath();
	ctx.arc(tx + 28, by, 28, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#4a2370';
	if (info.paused) {
		ctx.beginPath();
		ctx.moveTo(tx + 20, by - 14);
		ctx.lineTo(tx + 40, by);
		ctx.lineTo(tx + 20, by + 14);
		ctx.fill();
	} else {
		ctx.fillRect(tx + 17, by - 13, 8, 26);
		ctx.fillRect(tx + 31, by - 13, 8, 26);
	}
	const barX = tx + 76;
	const barW = maxW - 76;
	ctx.fillStyle = 'rgba(255,244,221,0.25)';
	roundRect(ctx, barX, by - 7, barW, 14, 7);
	ctx.fill();
	const ratio = info.duration > 0 ? Math.min(1, info.positionMs / (info.duration * 1000)) : 0;
	ctx.fillStyle = '#ffd36b';
	roundRect(ctx, barX, by - 7, Math.max(14, barW * ratio), 14, 7);
	ctx.fill();
	ctx.fillStyle = 'rgba(255,244,221,0.8)';
	ctx.font = '26px "Fredoka", "Segoe UI", sans-serif';
	ctx.fillText(clockText(info.positionMs), barX, by + 46);
	ctx.textAlign = 'right';
	ctx.fillText(info.duration ? clockText(info.duration * 1000) : '', barX + barW, by + 46);
	ctx.textAlign = 'left';
	if (info.next) {
		ctx.fillStyle = 'rgba(0,0,0,0.25)';
		roundRect(ctx, 70, 452, W - 140, 70, 20);
		ctx.fill();
		ctx.fillStyle = 'rgba(255,244,221,0.85)';
		ctx.font = '28px "Fredoka", "Segoe UI", sans-serif';
		ctx.fillText(fitText(ctx, `A continuación: ${info.next}`, W - 200), 100, 497);
	}
}

/** Un pececito de juguete (para mostrar lo que se pescó). */
export function makeFishMesh(color: string): THREE.Group {
	const group = new THREE.Group();
	const mat = new THREE.MeshStandardMaterial({color, roughness: 0.4});
	const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mat);
	body.scale.set(1.5, 0.9, 0.55);
	const tail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 4), mat);
	tail.rotation.z = Math.PI / 2;
	tail.position.x = -0.28;
	const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({color: 0x1a1020}));
	eye.position.set(0.15, 0.04, 0.07);
	group.add(body, tail, eye);
	return group;
}
