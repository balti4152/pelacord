import * as THREE from 'three';

const CYCLE_MS = 5 * 60_000;
const SKY_WIDTH = 768;
const SKY_HEIGHT = 432;

type OutdoorRoom = 'city' | 'port' | 'campfire';

function skyLayer(colors: string[]): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = SKY_WIDTH;
	canvas.height = SKY_HEIGHT;
	const ctx = canvas.getContext('2d')!;
	const gradient = ctx.createLinearGradient(0, 0, 0, SKY_HEIGHT);
	colors.forEach((color, i) => gradient.addColorStop(i / (colors.length - 1), color));
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, SKY_WIDTH, SKY_HEIGHT);
	return canvas;
}

function nightSky(): HTMLCanvasElement {
	const canvas = skyLayer(['#14162f', '#303663', '#565382', '#93739b']);
	const ctx = canvas.getContext('2d')!;
	const x = SKY_WIDTH * .476;
	const y = SKY_HEIGHT * .058;
	const halo = ctx.createRadialGradient(x, y, 4, x, y, 52);
	halo.addColorStop(0, 'rgba(219, 225, 255, .36)');
	halo.addColorStop(1, 'rgba(219, 225, 255, 0)');
	ctx.fillStyle = halo;
	ctx.fillRect(0, 0, SKY_WIDTH, SKY_HEIGHT);

	// Keep the constellations fixed as the sky fades in and out.
	let seed = 5173;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	for (let i = 0; i < 126; i++) {
		const sx = random() * SKY_WIDTH;
		const sy = random() ** 1.35 * SKY_HEIGHT * .58;
		const size = .48 + random() ** 2 * 1.14;
		if (Math.hypot(sx - x, sy - y) < 24) continue;
		ctx.globalAlpha = (.36 + random() * .6) * (1 - sy / SKY_HEIGHT);
		ctx.fillStyle = i % 3 === 0 ? '#ffdeb9' : '#e2e6ff';
		ctx.beginPath();
		ctx.arc(sx, sy, size, 0, Math.PI * 2);
		ctx.fill();
		if (i % 19 === 0) {
			ctx.fillRect(sx - 2.7, sy - .35, 5.4, .7);
			ctx.fillRect(sx - .35, sy - 3.5, .7, 7);
		}
	}
	ctx.globalAlpha = 1;
	ctx.fillStyle = '#fff1d2';
	ctx.beginPath();
	ctx.moveTo(x + 3, y - 17);
	ctx.bezierCurveTo(x - 24, y - 12, x - 15, y + 26, x + 10, y + 14);
	ctx.quadraticCurveTo(x + 16, y + 11, x + 17, y + 5);
	ctx.bezierCurveTo(x + 4, y + 15, x - 9, y - 3, x + 3, y - 17);
	ctx.fill();
	return canvas;
}

const DAY_FOG = new THREE.Color(0xe7b9a9);
const NIGHT_FOG = new THREE.Color(0x5f628d);
const DAY_SKY_FILL = new THREE.Color(0xf5d9ff);
const NIGHT_SKY_FILL = new THREE.Color(0xb5c1ff);
const DAY_GROUND_FILL = new THREE.Color(0xb08480);
const NIGHT_GROUND_FILL = new THREE.Color(0x62557f);
const SUN_COLOR = new THREE.Color(0xffc895);
const MOON_COLOR = new THREE.Color(0xb0c5ff);

export class OutdoorLighting {
	private startedAt: number | null = null;
	private day: HTMLCanvasElement | null = null;
	private night: HTMLCanvasElement | null = null;
	private backdrop: THREE.CanvasTexture | null = null;
	private context: CanvasRenderingContext2D | null = null;
	private fog: THREE.Fog | null = null;
	private lamps: Array<{light: THREE.PointLight | THREE.DirectionalLight; intensity: number}> = [];
	private lastBlend = -1;

	constructor(private scene: THREE.Scene, private sun: THREE.DirectionalLight, private fill: THREE.HemisphereLight) {}

	enter(room: OutdoorRoom, root: THREE.Object3D): void {
		this.startedAt ??= performance.now();
		this.day ??= skyLayer(['#b794c7', '#e59cbb', '#f4b398', '#ffdab1']);
		this.night ??= nightSky();
		const canvas = document.createElement('canvas');
		canvas.width = SKY_WIDTH;
		canvas.height = SKY_HEIGHT;
		this.context = canvas.getContext('2d')!;
		this.backdrop = new THREE.CanvasTexture(canvas);
		this.backdrop.colorSpace = THREE.SRGBColorSpace;
		this.backdrop.magFilter = THREE.LinearFilter;
		this.backdrop.minFilter = THREE.LinearFilter;
		this.backdrop.generateMipmaps = false;
		this.scene.background = this.backdrop;
		this.fog = new THREE.Fog(DAY_FOG, room === 'city' ? 27 : 22, room === 'city' ? 69 : 60);
		this.scene.fog = this.fog;
		this.sun.shadow.normalBias = room === 'city' ? .034 : 0;
		root.traverse((obj) => {
			if (obj.name === 'Stars' || obj.name === 'Moon') obj.visible = false;
			const light = obj as THREE.PointLight | THREE.DirectionalLight;
			if ((light as THREE.PointLight).isPointLight || (light as THREE.DirectionalLight).isDirectionalLight) {
				this.lamps.push({light, intensity: light.intensity});
			}
		});
		this.update();
	}

	update(): number {
		if (!this.fog || !this.backdrop || !this.context || this.startedAt === null) return 0;
		// Por la hora (no desde que entraste): así es de día o de noche al mismo tiempo para todos.
		const phase = (Date.now() % CYCLE_MS) / CYCLE_MS;
		const night = THREE.MathUtils.smoothstep(phase, .33, .48) * (1 - THREE.MathUtils.smoothstep(phase, .82, 1));
		const blend = Math.round(night * 144) / 144;
		if (blend !== this.lastBlend) {
			this.lastBlend = blend;
			this.context.globalAlpha = 1;
			this.context.drawImage(this.day!, 0, 0);
			if (blend > 0) {
				this.context.globalAlpha = blend;
				this.context.drawImage(this.night!, 0, 0);
			}
			this.backdrop.needsUpdate = true;
			this.fog.color.lerpColors(DAY_FOG, NIGHT_FOG, blend);
			this.fill.color.lerpColors(DAY_SKY_FILL, NIGHT_SKY_FILL, blend);
			this.fill.groundColor.lerpColors(DAY_GROUND_FILL, NIGHT_GROUND_FILL, blend);
			this.fill.intensity = THREE.MathUtils.lerp(1.51, .83, blend);
			this.sun.color.lerpColors(SUN_COLOR, MOON_COLOR, blend);
			this.sun.intensity = THREE.MathUtils.lerp(2.25, .56, blend);
			for (const {light, intensity} of this.lamps) {
				light.intensity = intensity * (light.type === 'PointLight'
					? THREE.MathUtils.lerp(.58, .83, blend)
					: THREE.MathUtils.lerp(1, .14, blend));
			}
		}
		return blend;
	}

	clear(): void {
		this.backdrop?.dispose();
		if (this.scene.background === this.backdrop) this.scene.background = null;
		if (this.scene.fog === this.fog) this.scene.fog = null;
		this.backdrop = null;
		this.context = null;
		this.fog = null;
		this.lamps = [];
		this.lastBlend = -1;
	}
}
