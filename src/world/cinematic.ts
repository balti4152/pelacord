/**
 * Look "de cine" del mundo: brillo suave en las luces (bloom), el fondo desenfocado (profundidad de
 * campo enfocada en tu personaje), viñeta y un toque de color cálido.
 *
 * Se puede apagar (PCs flojas) con localStorage `pelacord.world.fx = 0`.
 */
import * as THREE from 'three';
import {BokehPass} from 'three/examples/jsm/postprocessing/BokehPass.js';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const GradeShader = {
	uniforms: {
		tDiffuse: {value: null as THREE.Texture | null},
		vignette: {value: 0.38},
		warmth: {value: 0.05},
		lift: {value: 0.02},
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform float vignette;
		uniform float warmth;
		uniform float lift;
		varying vec2 vUv;
		void main() {
			vec4 color = texture2D(tDiffuse, vUv);
			// Cálido en las luces, un poco violeta en las sombras (atardecer de juguete).
			float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
			color.rgb += vec3(warmth, warmth * 0.45, -warmth * 0.4) * luma;
			color.rgb += vec3(lift * 0.6, lift * 0.2, lift) * (1.0 - luma);
			// Más saturado, tipo juguete.
			color.rgb = mix(vec3(luma), color.rgb, 1.12);
			// Viñeta suave.
			vec2 d = vUv - 0.5;
			float v = smoothstep(0.85, 0.25, length(d * vec2(1.15, 1.0)));
			color.rgb *= mix(1.0 - vignette, 1.0, v);
			gl_FragColor = color;
		}`,
};

export class Cinematic {
	readonly enabled: boolean;
	private composer: EffectComposer | null = null;
	private bokeh: BokehPass | null = null;
	private bloom: UnrealBloomPass | null = null;
	private grade: ShaderPass | null = null;

	constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
		let on = true;
		try {
			on = localStorage.getItem('pelacord.world.fx') !== '0';
		} catch {
			// sin almacenamiento
		}
		this.enabled = on;
		if (!on) return;
		const size = renderer.getSize(new THREE.Vector2());
		// Con anti-alias (MSAA) en el render intermedio: si no, los bordes se veían serruchados.
		const target = new THREE.WebGLRenderTarget(size.x || 1, size.y || 1, {type: THREE.HalfFloatType, samples: 4});
		const composer = new EffectComposer(renderer, target);
		composer.addPass(new RenderPass(scene, camera));
		this.bokeh = new BokehPass(scene, camera, {focus: 9, aperture: 0.0016, maxblur: 0.0075});
		composer.addPass(this.bokeh);
		this.bloom = new UnrealBloomPass(new THREE.Vector2((size.x || 2) / 2, (size.y || 2) / 2), 0.55, 0.65, 0.78);
		composer.addPass(this.bloom);
		this.grade = new ShaderPass(GradeShader);
		composer.addPass(this.grade);
		composer.addPass(new OutputPass());
		this.composer = composer;
	}

	/** Dónde enfocar (distancia de la cámara al personaje) y cuánto desenfocar. */
	setFocus(distance: number, strength: number, night: number): void {
		if (!this.bokeh) return;
		const uniforms = (this.bokeh as unknown as {uniforms: Record<string, {value: number}>}).uniforms;
		uniforms.focus.value += (distance - uniforms.focus.value) * 0.2;
		uniforms.aperture.value = 0.0016 * strength;
		uniforms.maxblur.value = THREE.MathUtils.lerp(.0075, .0032, night);
		if (this.grade) {
			this.grade.uniforms.warmth.value = THREE.MathUtils.lerp(.05, .012, night);
			this.grade.uniforms.lift.value = THREE.MathUtils.lerp(.02, .009, night);
		}
		if (this.bloom) this.bloom.strength = THREE.MathUtils.lerp(.55, .40, night);
	}

	/** El desenfoque y el brillo van sólo afuera; adentro queda la imagen limpia (con el color y la viñeta). */
	setOutdoor(outdoor: boolean, bloom = outdoor): void {
		if (this.bokeh) this.bokeh.enabled = outdoor;
		if (this.bloom) this.bloom.enabled = bloom;
	}

	setSize(width: number, height: number): void {
		this.composer?.setSize(width, height);
		this.bloom?.setSize(width / 2, height / 2);
	}

	render(scene: THREE.Scene, camera: THREE.Camera): void {
		if (this.composer) this.composer.render();
		else this.renderer.render(scene, camera);
	}

	dispose(): void {
		this.composer?.dispose();
	}
}
