/**
 * El casino lleno: muchas más máquinas (contra las dos paredes y en islas), dos mesas de cartas más,
 * sogas de terciopelo y plantas. Las máquinas extra van como InstancedMesh: aunque sean muchas, son
 * pocas llamadas de dibujo (no se pone lento en PCs flojas).
 */
import * as THREE from 'three';

interface Part {
	geometry: THREE.BufferGeometry;
	material: THREE.Material;
	matrix: THREE.Matrix4;
	/** Usa el color de cada máquina. */
	tinted?: boolean;
}

const at = (x: number, y: number, z: number, rx = 0): THREE.Matrix4 =>
	new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1));

function slotsSign(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 96;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, 256, 96);
	ctx.fillStyle = '#2a0f24';
	ctx.fillRect(10, 10, 236, 76);
	ctx.fillStyle = '#ffffff';
	ctx.font = '900 50px Nunito, "Arial Rounded MT Bold", sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText('SLOTS', 128, 50);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

function machineParts(): Part[] {
	const dark = new THREE.MeshStandardMaterial({color: 0x1a0d16, roughness: 0.6});
	const tint = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.35, metalness: 0.1});
	const gold = new THREE.MeshStandardMaterial({color: 0xffc94a, roughness: 0.25, metalness: 0.75});
	const chrome = new THREE.MeshStandardMaterial({color: 0xdfe3ea, roughness: 0.2, metalness: 0.9});
	const red = new THREE.MeshStandardMaterial({color: 0xff3b4f, emissive: 0xff2040, emissiveIntensity: 0.6, roughness: 0.3});
	const glow = new THREE.MeshBasicMaterial({color: 0xffffff, toneMapped: false});
	const sign = new THREE.MeshBasicMaterial({map: slotsSign(), color: 0xffffff, toneMapped: false});
	const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
	return [
		{geometry: box(0.72, 0.62, 0.6), material: dark, matrix: at(0, 0.31, 0)},
		{geometry: box(0.68, 0.84, 0.52), material: tint, matrix: at(0, 1.04, 0.02), tinted: true},
		{geometry: box(0.74, 0.06, 0.58), material: gold, matrix: at(0, 0.64, 0.02)},
		{geometry: box(0.74, 0.06, 0.58), material: gold, matrix: at(0, 1.47, 0.02)},
		{geometry: box(0.66, 0.05, 0.22), material: gold, matrix: at(0, 0.78, 0.3, 0.35)},
		{geometry: new THREE.CylinderGeometry(0.055, 0.055, 0.04, 16), material: red, matrix: at(0.12, 0.82, 0.32, 0.35)},
		{geometry: box(0.58, 0.32, 0.03), material: chrome, matrix: at(0, 1.12, 0.28)},
		{geometry: box(0.7, 0.36, 0.4), material: tint, matrix: at(0, 1.68, -0.02), tinted: true},
		{geometry: new THREE.PlaneGeometry(0.62, 0.26), material: sign, matrix: at(0, 1.68, 0.185), tinted: true},
		{geometry: box(0.66, 0.035, 0.035), material: glow, matrix: at(0, 1.885, 0.17), tinted: true},
		{geometry: box(0.66, 0.035, 0.035), material: glow, matrix: at(0, 1.485, 0.32), tinted: true},
		{geometry: new THREE.CylinderGeometry(0.015, 0.015, 0.42, 8), material: chrome, matrix: at(0.38, 1.26, 0.05)},
		{geometry: new THREE.SphereGeometry(0.05, 12, 8), material: red, matrix: at(0.38, 1.49, 0.05)},
	];
}

const MACHINE_COLORS = [0xd93a4a, 0x7a3fd1, 0x1f9e8f, 0xff8a2a, 0x2f6fd8, 0xe0368f, 0x3aa35a];

function addMachineCrowd(scene: THREE.Object3D, spots: Array<{x: number; z: number; ry: number}>): void {
	const loader = new THREE.TextureLoader();
	const symbols = ['cherry', 'lemon', 'bell', 'star', 'diamond', 'seven'].map((art) => {
		const texture = loader.load(`casino/${art}.png`);
		texture.colorSpace = THREE.SRGBColorSpace;
		return new THREE.MeshBasicMaterial({map: texture, transparent: true, toneMapped: false});
	});
	const place = new THREE.Matrix4();
	const color = new THREE.Color();
	const machines = spots.map((s) => new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.ry, 0)), new THREE.Vector3(1, 1, 1)));
	for (const part of machineParts()) {
		const mesh = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
		machines.forEach((m, i) => {
			mesh.setMatrixAt(i, place.multiplyMatrices(m, part.matrix));
			if (part.tinted) mesh.setColorAt(i, color.setHex(MACHINE_COLORS[(i * 3 + Math.floor(i / 2)) % MACHINE_COLORS.length]));
		});
		mesh.receiveShadow = true;
		mesh.name = 'CasinoCrowd';
		scene.add(mesh);
	}
	// Rodillos: un fondo crema y, encima, el dibujo de cada uno.
	const bg = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.155, 0.22), new THREE.MeshBasicMaterial({color: 0xfff6e0}), spots.length * 3);
	const bySymbol = symbols.map(() => [] as THREE.Matrix4[]);
	machines.forEach((m, i) => [-1, 0, 1].forEach((r, k) => {
		const reel = new THREE.Matrix4().multiplyMatrices(m, at(r * 0.17, 1.12, 0.297));
		bg.setMatrixAt(i * 3 + k, reel);
		bySymbol[(i * 7 + k * 5 + (i % 3)) % symbols.length].push(reel.clone().multiply(at(0, 0, 0.003)));
	}));
	bg.name = 'CasinoCrowd';
	scene.add(bg);
	const icon = new THREE.PlaneGeometry(0.14, 0.14);
	symbols.forEach((material, s) => {
		if (!bySymbol[s].length) return;
		const mesh = new THREE.InstancedMesh(icon, material, bySymbol[s].length);
		bySymbol[s].forEach((m, i) => mesh.setMatrixAt(i, m));
		mesh.name = 'CasinoCrowd';
		scene.add(mesh);
	});
}

function cardTable(scene: THREE.Object3D, x: number, z: number): void {
	const g = new THREE.Group();
	g.position.set(x, 0, z);
	const felt = new THREE.MeshStandardMaterial({color: 0x1f6b47, roughness: 0.85});
	const wood = new THREE.MeshStandardMaterial({color: 0x5a2c1c, roughness: 0.5});
	const gold = new THREE.MeshStandardMaterial({color: 0xffc94a, roughness: 0.25, metalness: 0.75});
	const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.08, 36), felt);
	top.position.y = 0.86;
	const rim = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.07, 10, 40), wood);
	rim.rotation.x = Math.PI / 2;
	rim.position.y = 0.9;
	const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.82, 16), wood);
	stem.position.y = 0.41;
	const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.012, 6, 40), gold);
	ring.rotation.x = Math.PI / 2;
	ring.position.y = 0.905;
	g.add(top, rim, stem, ring);
	const cardMat = new THREE.MeshStandardMaterial({color: 0xfffaf0, roughness: 0.6});
	for (let i = 0; i < 5; i++) {
		const card = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.004, 0.16), cardMat);
		card.position.set(-0.3 + i * 0.15, 0.905, 0.05);
		card.rotation.y = (i - 2) * 0.08;
		g.add(card);
	}
	const chipColors = [0xe0365a, 0x2f6fd8, 0x1f9e8f, 0x222222, 0xffc94a];
	const chipGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.018, 16);
	for (let s = 0; s < 4; s++) {
		const a = s * 1.57 + 0.5;
		for (let k = 0; k < 3 + s; k++) {
			const chip = new THREE.Mesh(chipGeo, new THREE.MeshStandardMaterial({color: chipColors[(s + k) % 5], roughness: 0.4}));
			chip.position.set(Math.cos(a) * 0.6, 0.91 + k * 0.019, Math.sin(a) * 0.6);
			g.add(chip);
		}
	}
	const velvet = new THREE.MeshStandardMaterial({color: 0x7a1f2b, roughness: 0.7});
	for (let i = 0; i < 5; i++) {
		const a = Math.PI / 2 + (i - 2) * 0.62;
		const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 18), velvet);
		seat.position.set(Math.cos(a) * 1.45, 0.5, Math.sin(a) * 1.45);
		const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), gold);
		leg.position.set(Math.cos(a) * 1.45, 0.23, Math.sin(a) * 1.45);
		g.add(seat, leg);
	}
	g.traverse((o) => {
		if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
	});
	top.castShadow = rim.castShadow = true;
	scene.add(g);
}

function stanchions(scene: THREE.Object3D, x: number, z0: number, z1: number): void {
	const gold = new THREE.MeshStandardMaterial({color: 0xffc94a, roughness: 0.25, metalness: 0.8});
	const rope = new THREE.MeshStandardMaterial({color: 0xa3122e, roughness: 0.6});
	const count = 4;
	let prev: THREE.Vector3 | null = null;
	for (let i = 0; i < count; i++) {
		const z = z0 + ((z1 - z0) * i) / (count - 1);
		const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 10), gold);
		post.position.set(x, 0.45, z);
		const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.04, 16), gold);
		foot.position.set(x, 0.02, z);
		const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), gold);
		ball.position.set(x, 0.93, z);
		scene.add(post, foot, ball);
		const here = new THREE.Vector3(x, 0.82, z);
		if (prev) {
			const curve = new THREE.QuadraticBezierCurve3(prev, new THREE.Vector3(x, 0.62, (prev.z + z) / 2), here);
			scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.025, 6), rope));
		}
		prev = here;
	}
}

function palm(scene: THREE.Object3D, x: number, z: number): void {
	const g = new THREE.Group();
	g.position.set(x, 0, z);
	const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.55, 18), new THREE.MeshStandardMaterial({color: 0xffc94a, roughness: 0.3, metalness: 0.6}));
	pot.position.y = 0.275;
	const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.3, 8), new THREE.MeshStandardMaterial({color: 0x8a5a3c, roughness: 0.9}));
	trunk.position.y = 1.2;
	g.add(pot, trunk);
	const leaf = new THREE.MeshStandardMaterial({color: 0x2f9a4f, roughness: 0.6});
	for (let i = 0; i < 7; i++) {
		const blade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.95, 6), leaf);
		const a = (i / 7) * Math.PI * 2;
		blade.position.set(Math.cos(a) * 0.32, 1.85, Math.sin(a) * 0.32);
		blade.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
		g.add(blade);
	}
	g.traverse((o) => {
		if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
	});
	scene.add(g);
}

/** Llena el salón. Devuelve dónde se juega (las indicaciones con E) y lo que no se atraviesa. */
export function fillCasino(scene: THREE.Object3D): {hotspots: Array<{kind: string; pos: THREE.Vector3}>; obstacles: Array<{x: number; z: number; r: number}>} {
	const spots: Array<{x: number; z: number; ry: number}> = [];
	const hotspots: Array<{kind: string; pos: THREE.Vector3}> = [];
	const obstacles: Array<{x: number; z: number; r: number}> = [];
	// Contra las paredes de los costados (dejando libre la puerta de salida).
	for (let z = -5.6; z <= 4.9; z += 0.82) {
		for (const side of [-1, 1]) {
			if (side < 0 && z > -4.6 && z < -2.2) continue;
			spots.push({x: side * 7.42, z, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2});
			obstacles.push({x: side * 7.3, z, r: 0.42});
			if (Math.round((z + 5.6) / 0.82) % 3 === 1) hotspots.push({kind: 'casino-slots', pos: new THREE.Vector3(side * 6.45, 0, z)});
		}
	}
	// Islas de cuatro máquinas espalda con espalda, adelante a los costados.
	for (const side of [-1, 1]) {
		const cx = side * 5.0;
		const cz = -4.4;
		for (const dx of [-0.37, 0.37]) {
			spots.push({x: cx + dx, z: cz - 0.32, ry: Math.PI});
			spots.push({x: cx + dx, z: cz + 0.32, ry: 0});
		}
		obstacles.push({x: cx - 0.37, z: cz, r: 0.62}, {x: cx + 0.37, z: cz, r: 0.62});
		hotspots.push({kind: 'casino-slots', pos: new THREE.Vector3(cx, 0, cz - 1.0)});
	}
	addMachineCrowd(scene, spots);
	// Dos mesas de cartas más (abren el blackjack).
	for (const side of [-1, 1]) {
		const x = side * 4.7;
		const z = -1.3;
		cardTable(scene, x, z);
		obstacles.push({x, z, r: 1.25});
		hotspots.push({kind: 'casino-blackjack', pos: new THREE.Vector3(x, 0, z - 1.55)});
	}
	// Sogas de terciopelo a los costados de la alfombra de entrada, y plantas.
	stanchions(scene, -2.95, -6.0, -1.2);
	stanchions(scene, 2.95, -6.0, -1.2);
	for (const [x, z] of [[-6.7, 5.6], [6.7, 5.6], [-2.2, 4.4], [2.2, 4.4], [-3.4, -6.0], [3.4, -6.0]] as const) {
		palm(scene, x, z);
		obstacles.push({x, z, r: 0.38});
	}
	scene.updateMatrixWorld(true);
	return {hotspots, obstacles};
}
