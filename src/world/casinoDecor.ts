/**
 * Retoques del casino hechos con código:
 * - El tragamonedas gordo de cinco rodillos se cambia por TRES máquinas finitas, una al lado de la
 *   otra, en el mismo lugar (cada una con tres rodillos, palanca y luces en el cartel).
 * - Las lámparas colgantes que tapaban los carteles se esconden (su luz queda).
 * - Una guirnalda de lamparitas sobre las máquinas.
 * Los rodillos se llaman `SlotsReel_<máquina>_<rodillo>` (los pinta RoomEffects).
 */
import * as THREE from 'three';

export const SLOT_MACHINES = [
	{x: 3.82, color: 0xd93a4a, trim: 0xffc94a, title: 'CEREZA', glow: '#ff5d7a'},
	{x: 4.65, color: 0x7a3fd1, trim: 0xffe08a, title: '777', glow: '#c184ff'},
	{x: 5.48, color: 0x1f9e8f, trim: 0xffd36b, title: 'DIAMANTE', glow: '#5df3e0'},
] as const;
export const SLOT_MACHINE_Z = 2.12;

const HIDE = /^(CasinoMachine|Reel[ _]lining|Marquee[ _]pearl|Casino[ _]lettering[ _]GIRO[ _]CEREZA|Cherry[ _]red[ _]start[ _]button|SlotsReel_\d$|Opal[ _]pendant|Pendant[ _]cap)/;

function signTexture(text: string, glow: string): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 96;
	const ctx = canvas.getContext('2d')!;
	const bg = ctx.createLinearGradient(0, 0, 0, 96);
	bg.addColorStop(0, '#2a0f24');
	bg.addColorStop(1, '#14060f');
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, 256, 96);
	ctx.shadowColor = glow;
	ctx.shadowBlur = 18;
	ctx.fillStyle = '#fff6e0';
	ctx.font = `900 ${text.length > 5 ? 40 : 58}px Nunito, "Arial Rounded MT Bold", sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, 128, 50);
	ctx.shadowBlur = 0;
	ctx.strokeStyle = glow;
	ctx.lineWidth = 5;
	ctx.strokeRect(5, 5, 246, 86);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	return texture;
}

function slotMachine(index: number): THREE.Group {
	const def = SLOT_MACHINES[index];
	const g = new THREE.Group();
	g.name = `SlotMachine_${index}`;
	const body = new THREE.MeshStandardMaterial({color: def.color, roughness: 0.35, metalness: 0.1});
	const trim = new THREE.MeshStandardMaterial({color: def.trim, roughness: 0.25, metalness: 0.75});
	const dark = new THREE.MeshStandardMaterial({color: 0x1a0d16, roughness: 0.6});
	const chrome = new THREE.MeshStandardMaterial({color: 0xdfe3ea, roughness: 0.2, metalness: 0.9});
	const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
		mesh.position.set(x, y, z);
		mesh.castShadow = mesh.receiveShadow = true;
		g.add(mesh);
		return mesh;
	};
	// Base, cuerpo y la parte de arriba un poquito más ancha.
	box(0.72, 0.62, 0.6, dark, 0, 0.31, 0);
	box(0.68, 0.84, 0.52, body, 0, 1.04, 0.02);
	box(0.74, 0.06, 0.58, trim, 0, 0.64, 0.02);
	box(0.74, 0.06, 0.58, trim, 0, 1.47, 0.02);
	// Bandeja de botones (inclinada) y un botón grande.
	const tray = box(0.66, 0.05, 0.22, trim, 0, 0.78, 0.3);
	tray.rotation.x = 0.35;
	const button = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 20), new THREE.MeshStandardMaterial({color: 0xff3b4f, emissive: 0xff2040, emissiveIntensity: 0.6, roughness: 0.3}));
	button.position.set(0.12, 0.82, 0.32);
	button.rotation.x = 0.35;
	g.add(button);
	// Ventana de los rodillos.
	box(0.58, 0.32, 0.03, chrome, 0, 1.12, 0.28);
	box(0.52, 0.26, 0.02, dark, 0, 1.12, 0.295);
	for (let r = 0; r < 3; r++) {
		const reel = new THREE.Mesh(new THREE.PlaneGeometry(0.155, 0.22), new THREE.MeshBasicMaterial({color: 0xffffff}));
		reel.name = `SlotsReel_${index}_${r}`;
		reel.position.set((r - 1) * 0.17, 1.12, 0.307);
		reel.userData.flipY = true;
		g.add(reel);
	}
	// Cartel de arriba (con luz propia) y lamparitas alrededor.
	box(0.7, 0.36, 0.4, body, 0, 1.68, -0.02);
	const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.26), new THREE.MeshBasicMaterial({map: signTexture(def.title, def.glow), toneMapped: false}));
	sign.position.set(0, 1.68, 0.185);
	g.add(sign);
	const bulbMat = new THREE.MeshStandardMaterial({color: 0xfff1c2, emissive: 0xffd36b, emissiveIntensity: 1.6, roughness: 0.3});
	const bulbs: THREE.Mesh[] = [];
	for (let i = 0; i < 8; i++) {
		const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), bulbMat.clone());
		const top = i < 4;
		bulb.position.set(-0.27 + (i % 4) * 0.18, top ? 1.87 : 1.49, 0.2);
		g.add(bulb);
		bulbs.push(bulb);
	}
	g.userData.bulbs = bulbs;
	// Palanca a la derecha (vista desde adelante).
	const lever = new THREE.Group();
	lever.position.set(-0.38, 1.05, 0.05);
	const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 8), chrome);
	arm.position.y = 0.21;
	const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), new THREE.MeshStandardMaterial({color: 0xff3b4f, roughness: 0.25}));
	knob.position.y = 0.44;
	const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12), trim);
	hub.rotation.z = Math.PI / 2;
	lever.add(arm, knob, hub);
	lever.name = `SlotLever_${index}`;
	g.add(lever);
	return g;
}

/** Arma lo nuevo y esconde lo viejo. Devuelve las máquinas (para animar lamparitas y palanca). */
export function upgradeCasino(scene: THREE.Object3D): THREE.Group[] {
	const hide: THREE.Object3D[] = [];
	scene.traverse((o) => {
		if (HIDE.test(o.name)) hide.push(o);
	});
	for (const o of hide) o.visible = false;
	const machines = SLOT_MACHINES.map((def, i) => {
		const m = slotMachine(i);
		// El frente mira a la cámara (-Z).
		m.position.set(def.x, 0, SLOT_MACHINE_Z);
		m.rotation.y = Math.PI;
		scene.add(m);
		return m;
	});
	// Guirnalda de lamparitas de colores sobre las máquinas.
	const colors = [0xff5d7a, 0xffd36b, 0x5df3e0, 0xc184ff];
	for (let i = 0; i < 18; i++) {
		const x = 3.25 + i * 0.16;
		const y = 2.35 - Math.sin((i / 17) * Math.PI) * 0.18;
		const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({color: colors[i % 4], emissive: colors[i % 4], emissiveIntensity: 1.4}));
		bulb.position.set(x, y, SLOT_MACHINE_Z + 0.1);
		bulb.name = 'CasinoGarland';
		scene.add(bulb);
	}
	scene.updateMatrixWorld(true);
	return machines;
}

/** La máquina más cerca de un punto (la que está usando el que juega). */
export function nearestMachine(x: number): number {
	let best = 0;
	for (let i = 1; i < SLOT_MACHINES.length; i++) if (Math.abs(SLOT_MACHINES[i].x - x) < Math.abs(SLOT_MACHINES[best].x - x)) best = i;
	return best;
}
