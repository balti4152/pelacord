import * as THREE from 'three';

const TRAIL_POINTS = 28;
const SPARKS = 36;
const TRAIL_LIFE = .58;

interface TrailPoint {
	x: number;
	y: number;
	z: number;
	ry: number;
	age: number;
}

interface Spark {
	x: number;
	y: number;
	z: number;
	dx: number;
	dz: number;
	age: number;
	life: number;
	size: number;
}

const vertexPrelude = `
	attribute float strength;
	varying float vStrength;
`;
const fragmentPrelude = `
	uniform vec3 tint;
	varying float vStrength;
`;

export class MountTrail {
	private points: TrailPoint[] = [];
	private sparks: Spark[] = [];
	private ribbonGeometry = new THREE.BufferGeometry();
	private sparkGeometry = new THREE.BufferGeometry();
	private tint = {value: new THREE.Color()};
	private ribbon = new THREE.Mesh(this.ribbonGeometry, new THREE.ShaderMaterial({
		uniforms: {tint: this.tint}, transparent: true, depthWrite: false, side: THREE.DoubleSide,
		vertexShader: vertexPrelude + `
			attribute float edge;
			varying float vEdge;
			void main() {
				vStrength = strength;
				vEdge = edge;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
			}
		`,
		fragmentShader: fragmentPrelude + `
			varying float vEdge;
			void main() {
				float center = 1. - smoothstep(0., 1., abs(vEdge));
				gl_FragColor = vec4(mix(tint, vec3(1.), pow(center, 6.) * .55), vStrength * center);
				#include <colorspace_fragment>
			}
		`,
	}));
	private glitter = new THREE.Points(this.sparkGeometry, new THREE.ShaderMaterial({
		uniforms: {tint: this.tint}, transparent: true, depthWrite: false,
		vertexShader: vertexPrelude + `
			attribute float size;
			void main() {
				vStrength = strength;
				vec4 at = modelViewMatrix * vec4(position, 1.);
				gl_Position = projectionMatrix * at;
				gl_PointSize = clamp(size * 440. / max(1., -at.z), 2., 14.);
			}
		`,
		fragmentShader: fragmentPrelude + `
			void main() {
				vec2 p = abs(gl_PointCoord * 2. - 1.);
				float star = 1. - smoothstep(.24, .95, pow(p.x, .6) + pow(p.y, .6));
				gl_FragColor = vec4(mix(tint, vec3(1.), star * .62), vStrength * star);
				#include <colorspace_fragment>
			}
		`,
	}));
	private ribbonPos = new THREE.Float32BufferAttribute(TRAIL_POINTS * 9, 3).setUsage(THREE.DynamicDrawUsage);
	private ribbonAlpha = new THREE.Float32BufferAttribute(TRAIL_POINTS * 3, 1).setUsage(THREE.DynamicDrawUsage);
	private sparkPos = new THREE.Float32BufferAttribute(SPARKS * 3, 3).setUsage(THREE.DynamicDrawUsage);
	private sparkAlpha = new THREE.Float32BufferAttribute(SPARKS, 1).setUsage(THREE.DynamicDrawUsage);
	private sparkSize = new THREE.Float32BufferAttribute(SPARKS, 1).setUsage(THREE.DynamicDrawUsage);
	private emitIn = 0;
	private segmentIn = 0;

	constructor(parent: THREE.Group, color: string) {
		this.setColor(color);
		const indices = [];
		const edges = [];
		for (let i = 0; i < TRAIL_POINTS; i++) {
			edges.push(-1, 0, 1);
			if (!i) continue;
			const row = i * 3;
			indices.push(row - 3, row, row - 2, row - 2, row, row + 1, row - 2, row + 1, row - 1, row - 1, row + 1, row + 2);
		}
		this.ribbonGeometry.setIndex(indices);
		this.ribbonGeometry.setAttribute('position', this.ribbonPos);
		this.ribbonGeometry.setAttribute('edge', new THREE.Float32BufferAttribute(edges, 1));
		this.ribbonGeometry.setAttribute('strength', this.ribbonAlpha);
		this.sparkGeometry.setAttribute('position', this.sparkPos);
		this.sparkGeometry.setAttribute('strength', this.sparkAlpha);
		this.sparkGeometry.setAttribute('size', this.sparkSize);
		this.ribbon.frustumCulled = false;
		this.glitter.frustumCulled = false;
		this.ribbon.renderOrder = 2;
		this.glitter.renderOrder = 3;
		this.reset();
		parent.add(this.ribbon, this.glitter);
	}

	setColor(color: string): void {
		this.tint.value.set(color);
	}

	reset(): void {
		this.points.length = 0;
		this.sparks.length = 0;
		this.emitIn = 0;
		this.segmentIn = 0;
		this.ribbonGeometry.setDrawRange(0, 0);
		this.sparkGeometry.setDrawRange(0, 0);
	}

	update(at: THREE.Vector3, heading: number, moving: boolean, dt: number): void {
		const sy = Math.sin(heading);
		const cy = Math.cos(heading);
		const x = at.x - sy * .91;
		const y = at.y + .16;
		const z = at.z - cy * .91;
		for (const point of this.points) point.age += dt;
		while (this.points[0] && this.points[0].age >= TRAIL_LIFE) this.points.shift();
		this.segmentIn -= dt;
		if (moving && this.segmentIn <= 0) {
			this.points.push({x, y, z, ry: heading, age: 0});
			if (this.points.length > TRAIL_POINTS) this.points.shift();
			this.segmentIn = .027;
		}
		const count = Math.min(this.points.length + Number(moving), TRAIL_POINTS);
		for (let i = 0; i < count; i++) {
			const point = this.points[i] ?? {x, y, z, ry: heading, age: 0};
			const remaining = Math.max(0, 1 - point.age / TRAIL_LIFE);
			const spread = .045 + (1 - remaining) * .11;
			const sideX = Math.cos(point.ry);
			const sideZ = -Math.sin(point.ry);
			for (let j = 0; j < 3; j++) {
				const stride = (j - 1) * spread;
				this.ribbonPos.setXYZ(i * 3 + j, point.x + sideX * stride, point.y + .02, point.z + sideZ * stride);
				this.ribbonAlpha.setX(i * 3 + j, remaining ** 1.65 * .74);
			}
		}
		this.ribbonGeometry.setDrawRange(0, Math.max(0, count - 1) * 12);
		this.ribbonPos.needsUpdate = true;
		this.ribbonAlpha.needsUpdate = true;

		for (const spark of this.sparks) spark.age += dt;
		this.sparks = this.sparks.filter((spark) => spark.age < spark.life);
		this.emitIn -= dt;
		if (this.emitIn <= 0 && this.sparks.length < SPARKS) {
			const side = (Math.random() - .5) * .25;
			this.sparks.push({
				x: x + cy * side, y: y + Math.random() * .12, z: z - sy * side,
				dx: -sy * .28 + cy * side, dz: -cy * .28 - sy * side,
				age: 0, life: .36 + Math.random() * .42, size: .085 + Math.random() * .07,
			});
			this.emitIn = moving ? .03 : .19;
		}
		for (const [i, spark] of this.sparks.entries()) {
			this.sparkPos.setXYZ(i, spark.x + spark.dx * spark.age, spark.y + .29 * spark.age, spark.z + spark.dz * spark.age);
			this.sparkAlpha.setX(i, (1 - spark.age / spark.life) * .92);
			this.sparkSize.setX(i, spark.size);
		}
		this.sparkGeometry.setDrawRange(0, this.sparks.length);
		this.sparkPos.needsUpdate = true;
		this.sparkAlpha.needsUpdate = true;
		this.sparkSize.needsUpdate = true;
	}

	dispose(): void {
		this.ribbon.removeFromParent();
		this.glitter.removeFromParent();
		this.ribbonGeometry.dispose();
		this.sparkGeometry.dispose();
		this.ribbon.material.dispose();
		this.glitter.material.dispose();
	}
}
