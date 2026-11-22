/**
 * Decoración de afuera para comprar (casa o patio): las cosas de la plaza de la ciudad (faroles,
 * banco, hortensias, canteros, flores, arbolito) y la guirnalda de lamparitas.
 *
 * Los modelos salen del mismo modelo de la ciudad: `glb: 'city#<nombre del objeto>'` toma ese objeto
 * y lo centra. La guirnalda (`proc:garland`) se arma con código.
 */
import * as THREE from 'three';
import type {CatalogItem} from '@/world/core';

export const OUTDOOR_ITEMS: CatalogItem[] = [
	{id: 'out_garland', name: 'Guirnalda de lamparitas', slot: 'furniture', price: 260, glb: 'proc:garland', category: 'exterior', recolor: null},
	{id: 'out_lamp', name: 'Farol de la plaza', slot: 'furniture', price: 320, glb: 'city#Lamp_0', category: 'exterior', recolor: null},
	{id: 'out_district_lamp', name: 'Farol de barrio', slot: 'furniture', price: 280, glb: 'city#DistrictLamp_0', category: 'exterior', recolor: null},
	{id: 'out_bench', name: 'Banco de la plaza', slot: 'furniture', price: 240, glb: 'city#Bench_0', category: 'exterior', recolor: null, seats: 2},
	{id: 'out_hydrangea', name: 'Hortensias', slot: 'furniture', price: 120, glb: 'city#Hydrangeas 0', category: 'exterior', recolor: null},
	{id: 'out_planter', name: 'Cantero de la plaza', slot: 'furniture', price: 200, glb: 'city#Plaza garden', category: 'exterior', recolor: null},
	{id: 'out_cafe_flowers', name: 'Flores del café', slot: 'furniture', price: 140, glb: 'city#Cafe flowers', category: 'exterior', recolor: null},
	{id: 'out_blossoms', name: 'Arbolito florecido', slot: 'furniture', price: 300, glb: 'city#District blossoms 0', category: 'exterior', recolor: null},
];

const clean = (name: string): string => name.replace(/[\s_.]+/g, '').replace(/\d+$/, '').toLowerCase();

/** Saca un objeto de la ciudad, centrado en el piso. */
export function pieceOf(city: THREE.Object3D, wanted: string): THREE.Group | null {
	const key = clean(wanted);
	let found: THREE.Object3D | null = null;
	city.traverse((o) => {
		if (!found && o.parent === city && clean(o.name).startsWith(key)) found = o;
	});
	if (!found) {
		// Puede estar dentro de un grupo: se busca en cualquier nivel.
		city.traverse((o) => {
			if (!found && clean(o.name).startsWith(key)) found = o;
		});
	}
	if (!found) return null;
	const source = found as THREE.Object3D;
	city.updateMatrixWorld(true);
	const copy = source.clone(true);
	source.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
	const group = new THREE.Group();
	group.add(copy);
	const box = new THREE.Box3().setFromObject(copy);
	const center = box.getCenter(new THREE.Vector3());
	copy.position.x -= center.x;
	copy.position.z -= center.z;
	copy.position.y -= box.min.y;
	// Las marcas de asientos y puertas de la ciudad no sirven acá (los asientos se vuelven a marcar).
	copy.traverse((o) => {
		delete o.userData.pelacord_door;
		delete o.userData.pelacord_hotspot;
	});
	return group;
}

/** Guirnalda: dos postes con un cable que cuelga y lamparitas de colores. */
export function buildGarland(): THREE.Group {
	const group = new THREE.Group();
	const wood = new THREE.MeshStandardMaterial({color: 0x7a5134, roughness: 0.85});
	const span = 3;
	const top = 2.3;
	for (const side of [-1, 1]) {
		const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, top, 10), wood);
		post.position.set(side * span / 2, top / 2, 0);
		post.castShadow = true;
		const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.08, 12), wood);
		foot.position.set(side * span / 2, 0.04, 0);
		group.add(post, foot);
	}
	const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-span / 2, top - 0.05, 0), new THREE.Vector3(0, top - 0.7, 0), new THREE.Vector3(span / 2, top - 0.05, 0));
	const cord = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.008, 5), new THREE.MeshStandardMaterial({color: 0x3a2a33, roughness: 0.7}));
	group.add(cord);
	const colors = [0xffce83, 0xffe8b2, 0xfbb4bb, 0xe8ddfa, 0xc9eabf, 0xff9e6b];
	const count = 11;
	for (let i = 1; i < count; i++) {
		const p = curve.getPoint(i / count);
		const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({color: new THREE.Color(colors[i % colors.length]).multiplyScalar(1.5), toneMapped: false}));
		bulb.scale.y = 1.25;
		bulb.position.copy(p).add(new THREE.Vector3(0, -0.06, 0));
		group.add(bulb);
	}
	const light = new THREE.PointLight(0xffd9a0, 1.4, 4.5, 1.6);
	light.position.set(0, top - 0.9, 0);
	group.add(light);
	return group;
}

const pieces = new Map<string, Promise<{scene: THREE.Object3D} | null>>();

/** Carga el modelo de un mueble: un .glb normal, un pedazo de la ciudad ('city#…') o uno armado con código ('proc:…'). */
export function loadFurnitureModel(glb: string, loadGLB: (url: string) => Promise<{scene: THREE.Object3D}>): Promise<{scene: THREE.Object3D} | null> {
	if (!glb.startsWith('city#') && !glb.startsWith('proc:')) return loadGLB(glb);
	let promise = pieces.get(glb);
	if (!promise) {
		promise = glb === 'proc:garland'
			? Promise.resolve({scene: buildGarland()})
			: loadGLB('models/room_city.glb').then((city) => {
				const piece = pieceOf(city.scene, glb.slice(5));
				return piece ? {scene: piece} : null;
			});
		pieces.set(glb, promise);
	}
	return promise;
}
