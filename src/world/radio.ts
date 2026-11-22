/**
 * La radio del campamento: una radio retro sobre un tronco. Su pantallita se llama `Screen`, así el
 * motor la trata como la tele de la sala (la música suena más fuerte cerca, y la pantalla muestra el tema).
 * El frente mira a +Z local.
 */
import * as THREE from 'three';

const mat = (color: number, roughness = 0.5, metalness = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({color, roughness, metalness});

export function buildRadio(): THREE.Group {
	const group = new THREE.Group();
	group.name = 'CampRadio';
	// Tronco.
	const bark = mat(0x7a5134, 0.9);
	const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.5, 18), bark);
	stump.position.y = 0.25;
	const top = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.02, 18), mat(0xd9b07a, 0.8));
	top.position.y = 0.505;
	group.add(stump, top);
	// Cuerpo de la radio.
	const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.26), mat(0xe2574c, 0.4));
	body.position.set(0, 0.72, 0);
	group.add(body);
	const face = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.34, 0.02), mat(0xf6e7cf, 0.6));
	face.position.set(0, 0.72, 0.13);
	group.add(face);
	// Parlantes.
	const grille = mat(0x3a2a33, 0.7);
	for (const side of [-1, 1]) {
		const speaker = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 24), grille);
		speaker.rotation.x = Math.PI / 2;
		speaker.position.set(side * 0.19, 0.69, 0.145);
		group.add(speaker);
		const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 16), mat(0xffc94a, 0.3, 0.6));
		cap.rotation.x = Math.PI / 2;
		cap.position.set(side * 0.19, 0.69, 0.152);
		group.add(cap);
	}
	// Pantallita (la tele de la sala).
	const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.1), new THREE.MeshBasicMaterial({color: 0x2b3a2f}));
	screen.name = 'Screen';
	screen.position.set(0, 0.8, 0.142);
	group.add(screen);
	// Perillas, manija y antena.
	for (const side of [-1, 1]) {
		const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), mat(0x3a2a33, 0.4));
		knob.rotation.x = Math.PI / 2;
		knob.position.set(side * 0.05, 0.62, 0.15);
		group.add(knob);
	}
	const handle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 24, Math.PI), mat(0x3a2a33, 0.4));
	handle.position.set(0, 0.92, 0);
	group.add(handle);
	const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.55, 6), mat(0xcfd3dc, 0.25, 0.8));
	antenna.position.set(0.24, 1.15, -0.05);
	antenna.rotation.z = -0.45;
	const tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), mat(0xcfd3dc, 0.25, 0.8));
	tip.position.set(0.36, 1.4, -0.05);
	group.add(antenna, tip);
	group.traverse((o) => {
		const m = o as THREE.Mesh;
		if (m.isMesh && m !== screen) {
			m.castShadow = true;
			m.receiveShadow = true;
		}
	});
	return group;
}
