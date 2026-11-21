import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {loadGLB} from '@/world/avatars';
import {SPIN_MS, rouletteFrame} from '@/world/casino';

export type WheelTurn = {number: number; at: number};

export function CasinoWheel({turn}: {turn: WheelTurn | null}): JSX.Element {
	const host = useRef<HTMLDivElement>(null);
	const latest = useRef(turn);
	const redraw = useRef<(() => void) | undefined>(undefined);
	latest.current = turn;

	useEffect(() => {
		const element = host.current;
		if (!element) return;
		let renderer: THREE.WebGLRenderer;
		try {
			renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});
		} catch {
			return;
		}
		renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.15;
		renderer.domElement.setAttribute('aria-hidden', 'true');
		element.append(renderer.domElement);

		const camera = new THREE.OrthographicCamera(-1.24, 1.24, 1.24, -1.24, 0.1, 20);
		camera.position.set(0, 4.2, -2.74);
		camera.lookAt(0, 0.05, 0);
		const scene = new THREE.Scene();
		scene.add(new THREE.HemisphereLight(0xffebd4, 0x986b77, 1.6));
		const key = new THREE.DirectionalLight(0xffdbb0, 2.3);
		key.position.set(-2.5, 3.2, -2.7);
		const rim = new THREE.DirectionalLight(0xe1ad9d, 1.2);
		rim.position.set(2.2, 2.1, 2.9);
		scene.add(key, rim);

		let active = true;
		let frameId = 0;
		let rotor: THREE.Object3D | null = null;
		let ball: THREE.Object3D | null = null;
		let played: WheelTurn | null = null;
		let start = Math.PI;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

		function paint(): void {
			if (!active || !rotor || !ball) return;
			const current = latest.current;
			let animate = false;
			if (current) {
				if (played !== current) {
					played = current;
					start = Math.atan2(ball.position.x, ball.position.z);
				}
				const progress = Math.min(1, Math.max(0, (performance.now() - current.at) / SPIN_MS.roulette));
				const frame = rouletteFrame(current.number, start, reduced ? 1 : progress, reduced);
				rotor.rotation.y = frame.rotor;
				ball.position.set(Math.sin(frame.angle) * frame.radius, 0.127 + frame.hop, Math.cos(frame.angle) * frame.radius);
				animate = !reduced && progress < 1;
			}
			renderer.render(scene, camera);
			cancelAnimationFrame(frameId);
			if (animate) frameId = requestAnimationFrame(paint);
		}
		redraw.current = paint;

		function fit(): void {
			const width = element!.clientWidth;
			const height = element!.clientHeight;
			if (!width || !height) return;
			const aspect = width / height;
			const half = Math.max(0.94, 1.02 / aspect);
			camera.left = -half * aspect;
			camera.right = half * aspect;
			camera.top = half;
			camera.bottom = -half;
			camera.updateProjectionMatrix();
			renderer.setSize(width, height, false);
			paint();
		}

		const resize = new ResizeObserver(fit);
		resize.observe(element);
		void loadGLB('models/room_casino.glb').then(({scene: model}) => {
			if (!active) return;
			const source = model.getObjectByName('CasinoWheelRotor');
			const marble = model.getObjectByName('CasinoWheelBall');
			const caseModel = model.getObjectByName('CasinoWheelBase');
			if (!source || !marble || !caseModel) return;
			const origin = source.position.clone();
			rotor = source.clone(true);
			ball = marble.clone(true);
			const surround = caseModel.clone(true);
			for (const part of [rotor, ball, surround]) {
				part.position.sub(origin);
				scene.add(part);
			}
			fit();
			element.dataset.ready = 'true';
		}).catch(() => {});
		return () => {
			active = false;
			resize.disconnect();
			cancelAnimationFrame(frameId);
			redraw.current = undefined;
			renderer.dispose();
			renderer.forceContextLoss();
			renderer.domElement.remove();
		};
	}, []);

	useEffect(() => redraw.current?.(), [turn]);

	return <div className="pc-wheel" ref={host} aria-hidden="true"><div className="pc-wheel-fallback" /></div>;
}

