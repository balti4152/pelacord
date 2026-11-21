/**
 * Dibuja en 3D la partida de la mesa redonda: cartas (Mano Loca), tableros y fichas (Ta-Te-Ti,
 * 4 en línea) y las cartas del Memotest. Todo se cuelga de `engine.tableRoot` (centro de la mesa)
 * y se orienta hacia MI silla: mi mano queda adelante, mirando a la cámara.
 */
import * as THREE from 'three';
import {CSS2DObject} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {type Card, CARD_COLOR_HEX, canPlay, cuatroDrop, type TableSession} from '@/world/tableGames';

const CARD_W = 0.11;
const CARD_H = 0.16;
const CARD_T = 0.004;
const textures = new Map<string, THREE.Texture>();

function canvasTexture(key: string, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 384): THREE.Texture {
	let texture = textures.get(key);
	if (texture) return texture;
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d')!;
	draw(ctx, w, h);
	texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	textures.set(key, texture);
	return texture;
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

const LABEL: Record<string, string> = {skip: 'Ø', rev: '⇄', '+2': '+2', '+4': '+4', wild: '★'};

function cardFace(card: Card): THREE.Texture {
	return canvasTexture(`card:${card.color}:${card.value}`, (ctx, w, h) => {
		ctx.fillStyle = '#fff8ec';
		roundRect(ctx, 0, 0, w, h, 26);
		ctx.fill();
		if (card.color === 'w') {
			const quads = ['#ff4d5e', '#ffc93c', '#3ccf7a', '#4f8dff'];
			quads.forEach((color, i) => {
				ctx.fillStyle = color;
				ctx.save();
				roundRect(ctx, 14, 14, w - 28, h - 28, 20);
				ctx.clip();
				ctx.fillRect(14 + (i % 2) * (w - 28) / 2, 14 + Math.floor(i / 2) * (h - 28) / 2, (w - 28) / 2, (h - 28) / 2);
				ctx.restore();
			});
		} else {
			ctx.fillStyle = CARD_COLOR_HEX[card.color];
			roundRect(ctx, 14, 14, w - 28, h - 28, 20);
			ctx.fill();
		}
		ctx.save();
		ctx.translate(w / 2, h / 2);
		ctx.rotate(-0.4);
		ctx.fillStyle = '#fff8ec';
		ctx.beginPath();
		ctx.ellipse(0, 0, w * 0.36, h * 0.3, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
		const text = LABEL[card.value] ?? card.value;
		ctx.fillStyle = card.color === 'w' ? '#2a1747' : CARD_COLOR_HEX[card.color];
		ctx.font = `900 ${text.length > 1 ? 92 : 120}px "Fredoka", "Segoe UI", sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineWidth = 10;
		ctx.strokeStyle = '#2a1747';
		ctx.strokeText(text, w / 2, h / 2 + 6);
		ctx.fillText(text, w / 2, h / 2 + 6);
		ctx.fillStyle = '#fff8ec';
		ctx.font = '900 40px "Fredoka", "Segoe UI", sans-serif';
		ctx.fillText(text, 44, 52);
	});
}

function cardBack(): THREE.Texture {
	return canvasTexture('card:back', (ctx, w, h) => {
		ctx.fillStyle = '#fff8ec';
		roundRect(ctx, 0, 0, w, h, 26);
		ctx.fill();
		const g = ctx.createLinearGradient(0, 0, w, h);
		g.addColorStop(0, '#8a5cff');
		g.addColorStop(1, '#ff7350');
		ctx.fillStyle = g;
		roundRect(ctx, 14, 14, w - 28, h - 28, 20);
		ctx.fill();
		ctx.save();
		ctx.translate(w / 2, h / 2);
		ctx.rotate(-0.5);
		ctx.fillStyle = '#fff8ec';
		ctx.font = '900 64px "Fredoka", "Segoe UI", sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('PELA', 0, 0);
		ctx.restore();
	});
}

function symbolFace(symbol: string): THREE.Texture {
	const colors: Record<string, string> = {star: '#ffc93c', heart: '#ff4d5e', moon: '#8a5cff', bolt: '#ff9a3c', circle: '#3ccf7a', triangle: '#4f8dff', square: '#ff6fae', diamond: '#3fc2c9'};
	return canvasTexture(`memo:${symbol}`, (ctx, w, h) => {
		ctx.fillStyle = '#fff8ec';
		roundRect(ctx, 0, 0, w, h, 30);
		ctx.fill();
		ctx.fillStyle = colors[symbol] ?? '#2a1747';
		ctx.strokeStyle = '#2a1747';
		ctx.lineWidth = 10;
		const cx = w / 2;
		const cy = h / 2;
		const r = 70;
		ctx.beginPath();
		if (symbol === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
		else if (symbol === 'square') roundRect(ctx, cx - r, cy - r, r * 2, r * 2, 16);
		else if (symbol === 'triangle') {
			ctx.moveTo(cx, cy - r);
			ctx.lineTo(cx + r, cy + r * 0.8);
			ctx.lineTo(cx - r, cy + r * 0.8);
			ctx.closePath();
		} else if (symbol === 'diamond') {
			ctx.moveTo(cx, cy - r * 1.1);
			ctx.lineTo(cx + r * 0.8, cy);
			ctx.lineTo(cx, cy + r * 1.1);
			ctx.lineTo(cx - r * 0.8, cy);
			ctx.closePath();
		} else if (symbol === 'star') {
			for (let i = 0; i < 10; i++) {
				const a = -Math.PI / 2 + (i * Math.PI) / 5;
				const rr = i % 2 ? r * 0.45 : r;
				ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
			}
			ctx.closePath();
		} else if (symbol === 'heart') {
			ctx.moveTo(cx, cy + r * 0.9);
			ctx.bezierCurveTo(cx - r * 1.6, cy - r * 0.2, cx - r * 0.6, cy - r * 1.3, cx, cy - r * 0.45);
			ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.3, cx + r * 1.6, cy - r * 0.2, cx, cy + r * 0.9);
		} else if (symbol === 'moon') {
			ctx.arc(cx, cy, r, Math.PI * 0.25, Math.PI * 1.75, false);
			ctx.arc(cx + r * 0.45, cy - r * 0.1, r * 0.75, Math.PI * 1.6, Math.PI * 0.4, true);
			ctx.closePath();
		} else if (symbol === 'bolt') {
			const pts = [[0.15, -1], [-0.55, 0.15], [-0.05, 0.15], [-0.25, 1], [0.55, -0.2], [0.05, -0.2]];
			pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x * r, cy + y * r) : ctx.moveTo(cx + x * r, cy + y * r)));
			ctx.closePath();
		}
		ctx.fill();
		ctx.stroke();
	}, 256, 256);
}

const edgeMat = new THREE.MeshStandardMaterial({color: 0xfff1dc, roughness: 0.6});

function cardMesh(front: THREE.Texture, back: THREE.Texture, w = CARD_W, h = CARD_H): THREE.Mesh {
	const geometry = new THREE.BoxGeometry(w, CARD_T, h);
	// Caras sin iluminación ni tone mapping: los colores de las cartas se ven tal cual (con luz salían desteñidos).
	const mats = [edgeMat, edgeMat, new THREE.MeshBasicMaterial({map: front, toneMapped: false}), new THREE.MeshBasicMaterial({map: back, toneMapped: false}), edgeMat, edgeMat];
	const mesh = new THREE.Mesh(geometry, mats);
	mesh.castShadow = true;
	return mesh;
}

function label(text: string, active: boolean): CSS2DObject {
	const el = document.createElement('div');
	el.className = `w-seat-tag${active ? ' is-turn' : ''}`;
	el.textContent = text;
	return new CSS2DObject(el);
}

/** Todo lo de la mesa se ve 1.45 veces más grande (antes quedaba chiquito en el medio). */
const SCALE = 1.45;

interface Tween {
	obj: THREE.Object3D;
	fromP: THREE.Vector3;
	toP: THREE.Vector3;
	fromQ: THREE.Quaternion;
	toQ: THREE.Quaternion;
	fromS: number;
	t: number;
	dur: number;
	arc: number;
	delay: number;
	bounce: boolean;
}

export class TableView {
	private group = new THREE.Group();
	/** Dónde estaba cada cosa en el dibujo anterior (para animar de ahí a donde va ahora). */
	private prev = new Map<string, {p: THREE.Vector3; q: THREE.Quaternion}>();
	private tweens: Tween[] = [];
	private pulses: THREE.Object3D[] = [];
	private floaters: THREE.Object3D[] = [];
	private confetti: Array<{mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; life: number}> = [];
	private lastWinner: string | null = null;
	private lastSessionId = '';
	private time = 0;

	constructor(root: THREE.Object3D) {
		this.group.scale.setScalar(SCALE);
		root.add(this.group);
	}

	clear(): void {
		this.prev.clear();
		for (const child of this.group.children) {
			const key = child.userData.key as string | undefined;
			// Si estaba a mitad de una animación, se recuerda a dónde iba (no dónde quedó a medias).
			const tween = this.tweens.find((tw) => tw.obj === child);
			if (key) this.prev.set(key, {p: (tween?.toP ?? child.position).clone(), q: (tween?.toQ ?? child.quaternion).clone()});
		}
		for (const child of [...this.group.children]) if (!child.userData.confetti) child.removeFromParent();
		this.tweens = [];
		this.pulses = [];
		this.floaters = [];
	}

	/** Anima un objeto recién dibujado: desde donde estaba antes, o desde `from` si es nuevo. */
	private animate(obj: THREE.Object3D, key: string, opts: {from?: THREE.Vector3; fromQ?: THREE.Quaternion; pop?: boolean; arc?: number; dur?: number; delay?: number; bounce?: boolean} = {}): void {
		obj.userData.key = key;
		const before = this.prev.get(key);
		const toP = obj.position.clone();
		const toQ = obj.quaternion.clone();
		let fromP: THREE.Vector3 | null = null;
		let fromQ = toQ.clone();
		let fromS = 1;
		if (before) {
			if (before.p.distanceTo(toP) < 0.002 && before.q.angleTo(toQ) < 0.01) return;
			fromP = before.p;
			fromQ = before.q;
		} else if (opts.from) {
			fromP = opts.from.clone();
			if (opts.fromQ) fromQ = opts.fromQ;
		} else if (opts.pop) {
			fromP = toP.clone().add(new THREE.Vector3(0, 0.2, 0));
			fromS = 0.01;
		}
		if (!fromP) return;
		obj.position.copy(fromP);
		obj.quaternion.copy(fromQ);
		obj.scale.setScalar(fromS);
		this.tweens.push({obj, fromP, toP, fromQ, toQ, fromS, t: 0, dur: opts.dur ?? 0.38, arc: opts.arc ?? (before ? 0.04 : 0.12), delay: opts.delay ?? 0, bounce: Boolean(opts.bounce)});
	}

	/** Se llama en cada cuadro (desde el motor). */
	tick(dt: number): void {
		this.time += dt;
		const ease = (x: number) => 1 - Math.pow(1 - x, 3);
		const back = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
		const bounce = (x: number) => {
			const n = 7.5625;
			const d = 2.75;
			if (x < 1 / d) return n * x * x;
			if (x < 2 / d) return n * (x - 1.5 / d) * (x - 1.5 / d) + 0.75;
			if (x < 2.5 / d) return n * (x - 2.25 / d) * (x - 2.25 / d) + 0.9375;
			return n * (x - 2.625 / d) * (x - 2.625 / d) + 0.984375;
		};
		this.tweens = this.tweens.filter((tw) => {
			if (tw.delay > 0) {
				tw.delay -= dt;
				return true;
			}
			tw.t = Math.min(1, tw.t + dt / tw.dur);
			const k = tw.bounce ? bounce(tw.t) : ease(tw.t);
			tw.obj.position.lerpVectors(tw.fromP, tw.toP, k);
			if (!tw.bounce) tw.obj.position.y += Math.sin(tw.t * Math.PI) * tw.arc;
			tw.obj.quaternion.slerpQuaternions(tw.fromQ, tw.toQ, ease(tw.t));
			tw.obj.scale.setScalar(tw.fromS < 1 ? Math.max(0.01, back(tw.t)) : 1);
			if (tw.t >= 1) tw.obj.scale.setScalar(1);
			return tw.t < 1;
		});
		for (const p of this.pulses) {
			const s = 1 + Math.sin(this.time * 5) * 0.12;
			p.scale.set(s, s, s);
		}
		for (const f of this.floaters) {
			if (this.tweens.some((tw) => tw.obj === f)) continue;
			f.position.y = (f.userData.baseY as number) + Math.sin(this.time * 3.2 + (f.userData.phase as number)) * 0.012;
		}
		this.confetti = this.confetti.filter((c) => {
			c.life -= dt;
			c.v.y -= 2.2 * dt;
			c.mesh.position.addScaledVector(c.v, dt);
			c.mesh.rotation.x += c.spin.x * dt;
			c.mesh.rotation.y += c.spin.y * dt;
			if (c.mesh.position.y < 0.01) {
				c.mesh.position.y = 0.01;
				c.v.multiplyScalar(0.3);
			}
			if (c.life <= 0) {
				c.mesh.removeFromParent();
				return false;
			}
			return true;
		});
	}

	/** Confeti cuando alguien gana. */
	private celebrate(): void {
		const colors = [0xff4d5e, 0xffc93c, 0x3ccf7a, 0x4f8dff, 0xff6fae, 0xffffff];
		for (let i = 0; i < 90; i++) {
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.018), new THREE.MeshBasicMaterial({color: colors[i % colors.length], side: THREE.DoubleSide, toneMapped: false}));
			mesh.position.set(0, 0.15, 0);
			mesh.userData.confetti = true;
			this.group.add(mesh);
			const a = Math.random() * Math.PI * 2;
			const sp = 0.4 + Math.random() * 0.8;
			this.confetti.push({mesh, v: new THREE.Vector3(Math.cos(a) * sp, 1.2 + Math.random() * 1.1, Math.sin(a) * sp), spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, 0), life: 2.4 + Math.random()});
		}
	}

	/**
	 * Redibuja la partida. `angleOf(player)` = ángulo de la silla de cada jugador alrededor de la
	 * mesa; todo se rota para que MI silla quede en +Z (adelante, hacia la cámara).
	 */
	render(session: TableSession | null, me: string, angleOf: (player: string) => number, names: (id: string) => string): void {
		this.clear();
		if (!session) {
			this.lastWinner = null;
			return;
		}
		if (session.id !== this.lastSessionId) {
			this.lastSessionId = session.id;
			this.prev.clear();
			this.lastWinner = null;
		}
		if (session.winner && session.winner !== this.lastWinner) this.celebrate();
		this.lastWinner = session.winner;
		const myAngle = session.players.includes(me) ? angleOf(me) : angleOf(session.players[0]);
		this.group.rotation.y = myAngle;
		const local = (player: string) => angleOf(player) - myAngle;
		const turnPlayer = session.players[session.turn];
		const myTurn = turnPlayer === me && !session.winner && !session.draw;

		// Nombres alrededor de la mesa y el aro del turno.
		session.players.forEach((player) => {
			const a = local(player);
			const count = session.game === 'cards' ? ` · ${session.hands?.[player]?.length ?? 0}` : session.game === 'memo' ? ` · ${session.score?.[player] ?? 0}` : '';
			const tag = label(`${player === me ? 'Vos' : names(player)}${count}`, player === turnPlayer && !session.winner);
			tag.position.set(Math.sin(a) * 0.86, 0.3, Math.cos(a) * 0.86);
			this.group.add(tag);
			if (player === turnPlayer && !session.winner && !session.draw) {
				const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 8, 32), new THREE.MeshBasicMaterial({color: 0x66e6b3, toneMapped: false}));
				ring.rotation.x = -Math.PI / 2;
				ring.position.set(Math.sin(a) * 0.62, 0.012, Math.cos(a) * 0.62);
				this.group.add(ring);
				this.pulses.push(ring);
			}
		});

		if (session.game === 'cards') this.renderCards(session, me, local, myTurn);
		else if (session.game === 'tateti') this.renderTateti(session, myTurn);
		else if (session.game === 'cuatro') this.renderCuatro(session, myTurn);
		else this.renderMemo(session, myTurn);
	}

	private renderCards(s: TableSession, me: string, local: (p: string) => number, myTurn: boolean): void {
		const back = cardBack();
		// Mazo para levantar.
		const pile = new THREE.Group();
		for (let i = 0; i < 6; i++) {
			const m = cardMesh(back, back);
			m.position.y = i * CARD_T;
			m.rotation.y = (i % 2 ? 0.04 : -0.03);
			pile.add(m);
		}
		pile.position.set(-0.17, 0.005, -0.02);
		pile.userData.pick = {type: 'draw'};
		this.group.add(pile);
		// Pila de descarte (las últimas 3 cartas, la de arriba bien visible) y el color actual.
		const discard = s.discard ?? [];
		const deckPos = new THREE.Vector3(-0.17, 0.03, -0.02);
		discard.slice(-3).forEach((card, i, arr) => {
			const m = cardMesh(cardFace(card), back);
			m.position.set(0.12 + i * 0.006, 0.006 + i * CARD_T, 0.0);
			m.rotation.y = (i - arr.length + 1) * 0.18;
			this.group.add(m);
			// Recién jugada: vuela desde la mano de quien la tiró (la mía, desde donde estaba en mi mano).
			const owner = s.players[(s.turn - (s.direction ?? 1) + s.players.length * 4) % s.players.length];
			const a = local(owner);
			const from = new THREE.Vector3(Math.sin(a) * 0.62, 0.25, Math.cos(a) * 0.62);
			this.animate(m, `card:${card.id}`, {from, fromQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a + 2.4, 0)), arc: 0.22, dur: 0.45});
		});
		const colorRing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 8, 40), new THREE.MeshBasicMaterial({color: CARD_COLOR_HEX[s.color ?? 'r']}));
		colorRing.rotation.x = -Math.PI / 2;
		colorRing.position.set(0.12, 0.004, 0);
		this.group.add(colorRing);

		for (const player of s.players) {
			const hand = s.hands?.[player] ?? [];
			const a = local(player);
			if (player === me) {
				// Mi mano: en abanico, paradita y mirando a la cámara. Las que puedo jugar se levantan.
				const n = hand.length;
				const spread = Math.min(0.11, 0.9 / Math.max(1, n));
				hand.forEach((card, i) => {
					const m = cardMesh(cardFace(card), back, CARD_W * 1.15, CARD_H * 1.15);
					const holder = new THREE.Group();
					holder.add(m);
					const x = (i - (n - 1) / 2) * spread;
					const playable = myTurn && canPlay(s, card);
					holder.position.set(x, 0.14 + (playable ? 0.05 : 0) + Math.abs(x) * -0.05, 0.62 + Math.abs(x) * 0.05);
					holder.rotation.set(1.05, 0, 0);
					holder.rotation.order = 'YXZ';
					holder.rotation.y = -x * 0.6;
					holder.userData.pick = {type: 'card', id: card.id};
					this.group.add(holder);
					// Las que levanto salen volando del mazo; las que puedo jugar flotan un poquito.
					const baseY = holder.position.y;
					this.animate(holder, `card:${card.id}`, {from: deckPos, fromQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)), arc: 0.2, dur: 0.42, delay: i * 0.015});
					if (playable) {
						holder.userData.baseY = baseY;
						holder.userData.phase = i * 0.7;
						this.floaters.push(holder);
					}
				});
			} else {
				// Los demás: el dorso de sus cartas en abanico frente a su silla.
				const show = Math.min(10, hand.length);
				for (let i = 0; i < show; i++) {
					const m = cardMesh(back, back);
					const off = (i - (show - 1) / 2) * 0.035;
					m.position.set(Math.sin(a) * 0.72 + Math.cos(a) * off, 0.01 + i * 0.001, Math.cos(a) * 0.72 - Math.sin(a) * off);
					m.rotation.y = a + off * 3;
					this.group.add(m);
					this.animate(m, `back:${player}:${i}`, {from: deckPos, arc: 0.15, dur: 0.4});
				}
			}
		}
	}

	private renderTateti(s: TableSession, myTurn: boolean): void {
		const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.62), new THREE.MeshStandardMaterial({color: 0xc98a52, roughness: 0.8}));
		board.position.y = 0.015;
		board.receiveShadow = true;
		this.group.add(board);
		const lineMat = new THREE.MeshStandardMaterial({color: 0x5a3216});
		for (const k of [-1, 1]) {
			const v = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.012, 0.58), lineMat);
			v.position.set(k * 0.1, 0.036, 0);
			const h = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.012, 0.015), lineMat);
			h.position.set(0, 0.036, k * 0.1);
			this.group.add(v, h);
		}
		const colorA = new THREE.MeshStandardMaterial({color: 0xff4d5e, roughness: 0.7});
		const colorB = new THREE.MeshStandardMaterial({color: 0x4f8dff, roughness: 0.7});
		s.board!.forEach((owner, i) => {
			const x = ((i % 3) - 1) * 0.2;
			const z = (Math.floor(i / 3) - 1) * 0.2;
			const cell = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.18), new THREE.MeshBasicMaterial({visible: false}));
			cell.position.set(x, 0.05, z);
			if (myTurn && !owner) cell.userData.pick = {type: 'cell', i};
			this.group.add(cell);
			if (!owner) return;
			if (owner === s.players[0]) {
				for (const r of [Math.PI / 4, -Math.PI / 4]) {
					const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.13, 6, 12), colorA);
					bar.rotation.set(Math.PI / 2, 0, r);
					bar.position.set(x, 0.06, z);
					bar.castShadow = true;
					this.group.add(bar);
					this.animate(bar, `ttt:${i}:${r}`, {pop: true, dur: 0.34});
				}
			} else {
				const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.02, 12, 28), colorB);
				ring.rotation.x = Math.PI / 2;
				ring.position.set(x, 0.06, z);
				ring.castShadow = true;
				this.group.add(ring);
				this.animate(ring, `ttt:${i}`, {pop: true, dur: 0.34});
			}
		});
	}

	private renderCuatro(s: TableSession, myTurn: boolean): void {
		const cols = 7;
		const rows = 6;
		const step = 0.1;
		const plate = new THREE.Mesh(new THREE.BoxGeometry(cols * step + 0.06, 0.03, rows * step + 0.06), new THREE.MeshStandardMaterial({color: 0x3a5bd9, roughness: 0.7}));
		plate.position.y = 0.015;
		this.group.add(plate);
		const hole = new THREE.MeshStandardMaterial({color: 0x1c2a6b});
		const red = new THREE.MeshStandardMaterial({color: 0xff4d5e, roughness: 0.6});
		const yellow = new THREE.MeshStandardMaterial({color: 0xffc93c, roughness: 0.6});
		const board = s.board!;
		for (let i = 0; i < cols * rows; i++) {
			const c = i % cols;
			const r = Math.floor(i / cols);
			const x = (c - (cols - 1) / 2) * step;
			// La fila de "abajo" (donde caen las fichas) queda del lado de la cámara.
			const z = ((rows - 1) / 2 - r) * step * -1 * -1;
			const owner = board[i];
			const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, owner ? 0.025 : 0.006, 20), owner ? (owner === s.players[0] ? red : yellow) : hole);
			disc.position.set(x, owner ? 0.045 : 0.033, z);
			this.group.add(disc);
			if (owner) {
				disc.castShadow = true;
				// La ficha cae desde arriba de su columna y rebota.
				this.animate(disc, `c4:${i}`, {from: new THREE.Vector3(x, 0.55, z), dur: 0.6, bounce: true, arc: 0});
			}
		}
		for (let c = 0; c < cols; c++) {
			if (!myTurn || cuatroDrop(board, c) < 0) continue;
			const column = new THREE.Mesh(new THREE.BoxGeometry(step * 0.95, 0.08, rows * step), new THREE.MeshBasicMaterial({visible: false}));
			column.position.set((c - (cols - 1) / 2) * step, 0.06, 0);
			column.userData.pick = {type: 'cell', i: c};
			this.group.add(column);
		}
	}

	private renderMemo(s: TableSession, myTurn: boolean): void {
		const back = cardBack();
		s.cards!.forEach((symbol, i) => {
			const up = s.matched![i] !== undefined || s.revealed!.includes(i);
			const m = cardMesh(symbolFace(symbol), back, 0.13, 0.13);
			m.position.set(((i % 4) - 1.5) * 0.16, 0.01, (Math.floor(i / 4) - 1.5) * 0.16);
			// Boca abajo se ve el dorso; dada vuelta, la figura.
			m.rotation.z = up ? 0 : Math.PI;
			if (myTurn && !up) m.userData.pick = {type: 'cell', i};
			if (s.matched![i] !== undefined) m.position.y = 0.006;
			this.group.add(m);
			this.animate(m, `memo:${i}`, {arc: 0.1, dur: 0.35});
		});
	}

	dispose(): void {
		this.clear();
		this.group.removeFromParent();
	}
}
