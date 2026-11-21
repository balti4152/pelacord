/**
 * Polvito cartoon: nubecitas que salen de los pies al correr (y más chiquitas al caminar), un
 * "puf" al arrancar a correr y otro al frenar. Todo con un pool de sprites (barato).
 */
import * as THREE from 'three';

let puffTexture: THREE.Texture | null = null;

/** Una nubecita blanda tipo dibujito (tres círculos con borde suave). */
function puff(): THREE.Texture {
	if (puffTexture) return puffTexture;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 128;
	const ctx = canvas.getContext('2d')!;
	const blob = (x: number, y: number, r: number) => {
		const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
		g.addColorStop(0, 'rgba(255,255,255,1)');
		g.addColorStop(0.7, 'rgba(255,255,255,0.95)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
	};
	blob(64, 72, 40);
	blob(42, 60, 28);
	blob(86, 58, 30);
	puffTexture = new THREE.CanvasTexture(canvas);
	puffTexture.colorSpace = THREE.SRGBColorSpace;
	return puffTexture;
}

interface Particle {
	sprite: THREE.Sprite;
	vel: THREE.Vector3;
	life: number;
	max: number;
	size: number;
	spin: number;
}

export class Dust {
	private group = new THREE.Group();
	private pool: Particle[] = [];
	private live: Particle[] = [];
	/** Color del polvo según el piso (arena, tierra, pasto, madera). */
	private tint = new THREE.Color(0xf3e6d6);

	constructor(scene: THREE.Scene) {
		scene.add(this.group);
		for (let i = 0; i < 90; i++) {
			const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: puff(), transparent: true, depthWrite: false, opacity: 0}));
			sprite.visible = false;
			this.group.add(sprite);
			this.pool.push({sprite, vel: new THREE.Vector3(), life: 0, max: 1, size: 0.2, spin: 0});
		}
	}

	setTint(hex: number): void {
		this.tint.set(hex);
	}

	/** Larga `count` nubecitas en `at`, tiradas un poco hacia `back` (detrás del que corre). */
	emit(at: THREE.Vector3, count: number, opts: {back?: THREE.Vector3; size?: number; spread?: number; up?: number; life?: number} = {}): void {
		for (let i = 0; i < count; i++) {
			const p = this.pool.pop() ?? this.live.shift();
			if (!p) return;
			const spread = opts.spread ?? 0.6;
			const angle = Math.random() * Math.PI * 2;
			p.vel.set(Math.cos(angle) * spread * Math.random(), (opts.up ?? 0.35) * (0.6 + Math.random() * 0.8), Math.sin(angle) * spread * Math.random());
			if (opts.back) p.vel.addScaledVector(opts.back, 0.9 + Math.random() * 0.6);
			p.sprite.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.12, 0.05 + Math.random() * 0.05, (Math.random() - 0.5) * 0.12));
			p.size = (opts.size ?? 0.22) * (0.7 + Math.random() * 0.6);
			p.max = (opts.life ?? 0.55) * (0.8 + Math.random() * 0.5);
			p.life = 0;
			p.spin = (Math.random() - 0.5) * 3;
			const mat = p.sprite.material as THREE.SpriteMaterial;
			mat.color.copy(this.tint).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
			mat.rotation = Math.random() * Math.PI;
			p.sprite.visible = true;
			this.live.push(p);
		}
	}

	update(dt: number): void {
		this.live = this.live.filter((p) => {
			p.life += dt;
			const t = p.life / p.max;
			if (t >= 1) {
				p.sprite.visible = false;
				this.pool.push(p);
				return false;
			}
			p.vel.multiplyScalar(Math.pow(0.08, dt));
			p.vel.y += 0.25 * dt;
			p.sprite.position.addScaledVector(p.vel, dt);
			// Crece rápido (puf!) y se desvanece.
			const s = p.size * (0.45 + Math.min(1, t * 3) * 0.75 + t * 0.4);
			p.sprite.scale.set(s, s, s);
			const mat = p.sprite.material as THREE.SpriteMaterial;
			mat.opacity = t < 0.15 ? t / 0.15 * 0.9 : 0.9 * (1 - (t - 0.15) / 0.85);
			mat.rotation += p.spin * dt;
			return true;
		});
	}

	dispose(): void {
		this.group.removeFromParent();
		for (const p of [...this.pool, ...this.live]) (p.sprite.material as THREE.Material).dispose();
	}
}
