/**
 * NPCs del mundo: la vendedora de la tienda, el pescadero del puerto, vecinos que pasean por la
 * ciudad y el público del cine (que se para a bailar cuando suena música en la tele).
 *
 * Son locales (cada uno ve los suyos): no viajan por la red, sólo dan vida.
 */
import * as THREE from 'three';
import type {Avatar, BaseAnim} from '@/world/avatars';
import {DEFAULT_LOOK, type Look, type RoomId} from '@/world/core';

interface NpcActor {
	avatar: Avatar;
	pos: THREE.Vector3;
	target: THREE.Vector3;
	ry: number;
	labelEl: HTMLDivElement;
}

type Create = (id: string, name: string, color: string, look: Look, label: boolean) => NpcActor;

interface Npc {
	actor: NpcActor;
	kind: 'shop' | 'fish' | 'walker' | 'audience' | 'fisher';
	label?: string;
	speed: number;
	wait: number;
	/** Para el público: dónde se sienta y hacia dónde mira. */
	seat?: {pos: THREE.Vector3; ry: number; name: string};
	base: BaseAnim;
}

// Una semilla fija por sala: los vecinos son siempre los mismos (y se ven igual para todos).
// (mulberry32: el generador lineal de antes repetía patrones y les tocaba a todos el mismo pelo.)
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SKINS = ['#f3bd96', '#e0a476', '#c98a5e', '#9c6644', '#6e4630', '#f7d2b6'];
const HAIRS = ['#3b2418', '#141010', '#a8322a', '#d9a441', '#6b3e26', '#e9e1d6', '#4a3b8f'];
const CLOTHES = ['#8a5cff', '#ff7350', '#3fb68b', '#f5b326', '#4f8de0', '#e05a9b', '#2f3b78', '#f4f4f4', '#5c3d2e'];
const HAIR_IDS = ['hair_bowl', 'hair_buns', 'hair_curly', 'hair_long', 'hair_ponytail', 'hair_spiky', 'hair_anime', 'hair_sidepart', 'hair_layers', 'hair_highpony', 'hair_wavy'];
/** Para que dos vecinos seguidos nunca tengan el mismo corte. */
let hairTurn = 0;
const NAMES = ['Rosa', 'Beto', 'Coca', 'Pocho', 'Nina', 'Lalo', 'Mora', 'Tito', 'Juana', 'Quique'];

function randomLook(next: () => number): Look {
	const pick = <T,>(list: T[]) => list[Math.floor(next() * list.length)];
	const body = next() < 0.5 ? 'M' : 'F';
	return {
		...DEFAULT_LOOK,
		body,
		hair: HAIR_IDS[(hairTurn = (hairTurn + 1 + Math.floor(next() * (HAIR_IDS.length - 1))) % HAIR_IDS.length)],
		eyes: pick(['eyes_dot', 'eyes_big', 'eyes_happy', 'eyes_lash']),
		brows: pick(['brows_line', 'brows_arch', 'brows_thick']),
		mouth: pick(['mouth_smile', 'mouth_grin', 'mouth_neutral']),
		cheeks: next() < 0.4 ? 'cheeks_blush' : null,
		top: pick(body === 'F' ? ['top_tee', 'top_hoodie', 'top_tank', 'top_dress'] : ['top_tee', 'top_hoodie', 'top_tank']),
		bottom: pick(body === 'F' ? ['bottom_pants', 'bottom_shorts', 'bottom_skirt'] : ['bottom_pants', 'bottom_shorts']),
		shoes: pick(['shoes_sneakers', 'shoes_boots']),
		colors: {skin: pick(SKINS), hair: pick(HAIRS), top: pick(CLOTHES), bottom: pick(CLOTHES), shoes: pick(['#f4f4f4', '#2b2230', '#7a4a2a']), sole: pick(['#ff7350', '#f4f4f4', '#f5b326'])},
	};
}

export const SHOP_LOOK: Look = {
	...DEFAULT_LOOK, body: 'F', hair: 'hair_buns', eyes: 'eyes_lash', mouth: 'mouth_smile', cheeks: 'cheeks_blush', top: 'top_hoodie', bottom: 'bottom_skirt',
	colors: {skin: '#e0a476', hair: '#a8322a', top: '#f5b326', bottom: '#2f3b78', shoes: '#f4f4f4', sole: '#ff7350'},
};
const FISH_LOOK: Look = {
	...DEFAULT_LOOK, body: 'M', hair: 'hair_curly', eyes: 'eyes_happy', mouth: 'mouth_grin', top: 'top_tank', bottom: 'bottom_pants', shoes: 'shoes_boots',
	colors: {skin: '#c98a5e', hair: '#e9e1d6', top: '#4f8de0', bottom: '#f5b326', shoes: '#2b2230', sole: '#f4f4f4'},
};

/** Zonas por donde pasean los vecinos (rectángulos en el piso: x1, x2, z1, z2). */
const WALK_AREAS: Partial<Record<string, Array<[number, number, number, number]>>> = {
	city: [[-9, 9, -3.5, 3.5], [-14, 14, 4.6, 6.4], [-11.6, -9.4, -4, 4], [9.4, 11.6, -4, 4], [-3.5, 3.5, -6.5, 6.5]],
	port: [[-6.5, 2.5, -4.6, -2.6]],
};
const WALKERS: Partial<Record<string, number>> = {city: 7, port: 2};

/** Un cajoncito de madera (va debajo de los pies del vendedor). */
function makeCrate(height: number, color: number): THREE.Group {
	const group = new THREE.Group();
	const wood = new THREE.MeshStandardMaterial({color, roughness: 0.75});
	const dark = new THREE.MeshStandardMaterial({color: new THREE.Color(color).multiplyScalar(0.7), roughness: 0.8});
	const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, height, 0.56), wood);
	body.position.y = -height / 2;
	body.castShadow = true;
	body.receiveShadow = true;
	group.add(body);
	// Listones para que se lea como cajón.
	for (const y of [-height * 0.25, -height * 0.75]) {
		const slat = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.04, 0.58), dark);
		slat.position.y = y;
		group.add(slat);
	}
	return group;
}

export class Npcs {
	private list: Npc[] = [];
	private clampFn: (p: THREE.Vector3) => THREE.Vector3 = (p) => p;
	private next = rng(1);
	private room: RoomId | null = null;

	constructor(private create: Create) {}

	setup(room: RoomId, scene: THREE.Object3D, clamp: (p: THREE.Vector3) => THREE.Vector3): void {
		this.dispose();
		this.room = room;
		this.clampFn = clamp;
		this.next = rng(room.length * 7919 + room.charCodeAt(0));
		const marker = (name: string) => scene.getObjectByName(name);
		const shop = room === 'shop' ? marker('Shopkeeper') : null;
		if (shop) this.add('shop', 'Mili · vendedora', '#f5b326', SHOP_LOOK, shop.getWorldPosition(new THREE.Vector3()).setY(0), Math.PI, true);
		const monger = room === 'port' ? marker('Fishmonger') : null;
		if (monger) this.add('fish', 'Tano · pescadero', '#4f8de0', FISH_LOOK, monger.getWorldPosition(new THREE.Vector3()).setY(0), Math.PI, true);
		const fisher = room === 'port' ? marker('NpcFisher') : null;
		if (fisher) {
			const n = this.add('fisher', 'Don Ramón', '#3fb68b', randomLook(this.next), fisher.getWorldPosition(new THREE.Vector3()).setY(0), 0, false);
			const dir = fisher.getWorldDirection(new THREE.Vector3());
			n.actor.ry = Math.atan2(dir.x, dir.z);
			n.base = 'fish';
		}
		const areas = WALK_AREAS[room];
		for (let i = 0; i < (WALKERS[room] ?? 0) && areas; i++) {
			const p = this.randomPoint();
			const n = this.add('walker', NAMES[i % NAMES.length], CLOTHES[i % CLOTHES.length], randomLook(this.next), p, this.next() * Math.PI * 2, false);
			n.speed = 1.0 + this.next() * 0.6;
			n.wait = this.next() * 3;
		}
		if (room === 'cinema') {
			// Público: se sientan en butacas sueltas (no en todas, para que siempre haya lugar).
			const seats: THREE.Object3D[] = [];
			scene.traverse((obj) => {
				if (obj.name.startsWith('Seat_')) seats.push(obj);
			});
			const chosen = seats.filter((_, i) => i % 3 === 1).slice(0, 3);
			chosen.forEach((seat, i) => {
				const pos = seat.getWorldPosition(new THREE.Vector3());
				const dir = seat.getWorldDirection(new THREE.Vector3());
				const n = this.add('audience', NAMES[(i + 4) % NAMES.length], CLOTHES[(i + 3) % CLOTHES.length], randomLook(this.next), pos, Math.atan2(dir.x, dir.z), false);
				n.seat = {pos, ry: Math.atan2(dir.x, dir.z), name: seat.name};
				n.base = 'sit';
			});
		}
	}

	private add(kind: Npc['kind'], name: string, color: string, look: Look, pos: THREE.Vector3, ry: number, label: boolean): Npc {
		const actor = this.create(`npc:${kind}:${this.list.length}`, name, color, look, label);
		actor.pos.copy(pos);
		actor.target.copy(pos);
		actor.ry = ry;
		if (label) actor.labelEl.classList.add('is-npc');
		// Los vendedores van parados arriba de un cajón: detrás del mostrador, con la cámara de arriba,
		// sólo se les veía el pelo.
		if (kind === 'shop' || kind === 'fish') {
			const lift = 0.46;
			actor.pos.y = lift;
			actor.target.y = lift;
			actor.avatar.root.add(makeCrate(lift, kind === 'fish' ? 0x6f8fb3 : 0xb9824f));
		}
		const npc: Npc = {actor, kind, label: kind === 'shop' ? 'Hablar con Mili' : kind === 'fish' ? 'Vender pescado a Tano' : undefined, speed: 1.2, wait: 0, base: 'idle'};
		this.list.push(npc);
		return npc;
	}

	private randomPoint(): THREE.Vector3 {
		const areas = WALK_AREAS[this.room ?? ''] ?? [[-2, 2, -2, 2]];
		const [x1, x2, z1, z2] = areas[Math.floor(this.next() * areas.length)];
		return this.clampFn(new THREE.Vector3(x1 + (x2 - x1) * this.next(), 0, z1 + (z2 - z1) * this.next()));
	}

	/** Butacas que ocupa el público (para que no te sientes encima). */
	takenSeats(): string[] {
		return this.list.filter((n) => n.seat && n.base === 'sit').map((n) => n.seat!.name);
	}

	talkers(): Array<{kind: string; label: string; pos: THREE.Vector3}> {
		return this.list.filter((n) => n.label).map((n) => ({kind: n.kind, label: n.label!, pos: n.actor.pos}));
	}

	wave(kind: string): void {
		this.list.find((n) => n.kind === kind)?.actor.avatar.play('Wave');
	}

	update(dt: number, me: THREE.Vector3 | null, musicOn: boolean, turn: (actor: NpcActor, d: {wanted: number; dt: number}) => void): void {
		for (const n of this.list) {
			const a = n.actor;
			let base: BaseAnim = n.base;
			if (n.kind === 'walker') {
				const to = a.target.clone().sub(a.pos).setY(0);
				const distance = to.length();
				if (n.wait > 0) {
					n.wait -= dt;
					base = 'idle';
					if (n.wait <= 0) a.target.copy(this.randomPoint());
				} else if (distance < 0.1) {
					n.wait = 1.5 + this.next() * 4;
					base = 'idle';
				} else {
					const step = to.normalize().multiplyScalar(Math.min(distance, n.speed * dt));
					a.pos.copy(this.clampFn(a.pos.clone().add(step)));
					turn(a, {wanted: Math.atan2(step.x, step.z), dt});
					base = 'walk';
				}
				if (base === 'idle' && musicOn) base = 'dance';
			} else if (n.kind === 'audience' && n.seat) {
				// Con música se paran adelante de la butaca a bailar; sin música vuelven a sentarse.
				if (musicOn) {
					const front = new THREE.Vector3(Math.sin(n.seat.ry), 0, Math.cos(n.seat.ry)).multiplyScalar(0.55);
					a.pos.copy(n.seat.pos).setY(0).add(front);
					base = 'dance';
				} else {
					a.pos.copy(n.seat.pos);
					base = 'sit';
				}
				n.base = base === 'dance' ? 'idle' : 'sit';
				a.ry = n.seat.ry;
			} else if ((n.kind === 'shop' || n.kind === 'fish') && me) {
				const dx = me.x - a.pos.x;
				const dz = me.z - a.pos.z;
				if (Math.hypot(dx, dz) < 4) turn(a, {wanted: Math.atan2(dx, dz), dt: dt * 0.25});
				if (musicOn) base = 'dance';
			}
			a.avatar.setBase(base);
			a.avatar.root.position.copy(a.pos);
			a.avatar.root.rotation.y = a.ry;
			a.avatar.update(dt);
		}
	}

	dispose(): void {
		for (const n of this.list) n.actor.avatar.dispose();
		this.list = [];
	}
}
