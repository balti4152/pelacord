/**
 * La puerta de salida de las casas y los edificios: marco, hoja con picaporte, cartelito verde de
 * SALIDA y un felpudo. Se arma con código (no hace falta tocar cada .glb) y se apoya en la pared
 * izquierda, cerca de la entrada, mirando hacia adentro.
 */
import * as THREE from 'three';

const glossy = (color: number, roughness = 0.45): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({color, roughness});

function roundedBox(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

function exitSign(): THREE.Mesh {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 96;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#1fbf6a';
	ctx.beginPath();
	ctx.roundRect(4, 4, 248, 88, 22);
	ctx.fill();
	ctx.strokeStyle = '#ffffff';
	ctx.lineWidth = 6;
	ctx.stroke();
	ctx.fillStyle = '#ffffff';
	ctx.font = '900 46px Nunito, "Arial Rounded MT Bold", sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText('SALIDA', 150, 50);
	// Flechita.
	ctx.beginPath();
	ctx.moveTo(28, 48);
	ctx.lineTo(52, 28);
	ctx.lineTo(52, 40);
	ctx.lineTo(70, 40);
	ctx.lineTo(70, 56);
	ctx.lineTo(52, 56);
	ctx.lineTo(52, 68);
	ctx.closePath();
	ctx.fill();
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.29), new THREE.MeshBasicMaterial({map: texture, transparent: true, toneMapped: false}));
	return sign;
}

/** Arma la puerta (el frente mira a +Z local). `color` es el de la hoja. */
export function buildExitDoor(color = 0x8a5a3c): THREE.Group {
	const group = new THREE.Group();
	group.name = 'ExitDoor';
	const trim = glossy(0xf4ead8, 0.5);
	const leaf = glossy(color, 0.55);
	leaf.name = 'ExitDoorLeaf';
	const brass = new THREE.MeshStandardMaterial({color: 0xffc94a, roughness: 0.25, metalness: 0.7});
	const w = 1.1;
	const h = 2.2;
	// Marco.
	for (const side of [-1, 1]) {
		const post = roundedBox(0.12, h + 0.1, 0.16, trim);
		post.position.set(side * (w / 2 + 0.06), (h + 0.1) / 2, 0);
		group.add(post);
	}
	const lintel = roundedBox(w + 0.36, 0.14, 0.18, trim);
	lintel.position.set(0, h + 0.12, 0);
	group.add(lintel);
	// Hoja con dos paneles en relieve.
	const door = roundedBox(w, h, 0.07, leaf);
	door.position.set(0, h / 2, -0.02);
	group.add(door);
	const panel = glossy(new THREE.Color(color).multiplyScalar(1.18).getHex(), 0.5);
	for (const [y, ph] of [[1.55, 0.8], [0.62, 0.8]] as const) {
		const p = roundedBox(w - 0.3, ph, 0.03, panel);
		p.position.set(0, y, 0.025);
		group.add(p);
	}
	const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), brass);
	knob.position.set(w / 2 - 0.16, 1.05, 0.07);
	group.add(knob);
	// Cartel de SALIDA arriba (brilla un poco).
	const sign = exitSign();
	sign.position.set(0, h + 0.42, 0.06);
	group.add(sign);
	// Felpudo.
	const mat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.025, 0.6), glossy(0x6b4a2b, 0.95));
	mat.position.set(0, 0.0125, 0.45);
	mat.receiveShadow = true;
	group.add(mat);
	group.userData.exitDoor = true;
	return group;
}

/** Dónde va la puerta de salida de cada sala: pared izquierda (x) y altura de la entrada (z). */
export const EXIT_DOORS: Record<string, {x: number; z: number; color: number}> = {
	living: {x: -3.95, z: -1.3, color: 0x6b4fa8},
	cinema: {x: -4.45, z: -2.6, color: 0x9c2b3c},
	shop: {x: -4.95, z: -2.0, color: 0x2f8a6a},
	games: {x: -4.95, z: -0.9, color: 0x4a3aa8},
	house: {x: -4.45, z: -1.6, color: 0x8a5a3c},
	restaurant: {x: -5.45, z: -2.0, color: 0x9c4a2b},
	casino: {x: -7.78, z: -3.4, color: 0x7a1f2b},
	smithy: {x: -4.15, z: -2.0, color: 0x5c3d24},
};
