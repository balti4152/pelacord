import {type PointerEvent, useRef, useState} from 'react';
import {useLocalScreen, useMeshRemotes} from '@/components/RemoteMedia';
import {useStore} from '@/state/store';

const WIDTH = 320;
const HEIGHT = 200;

/** Ventanita flotante con la transmisión cuando salís de la grilla de la llamada. */
export function FloatingStream(): JSX.Element | null {
	const {state, dispatch} = useStore();
	const remotes = useMeshRemotes();
	const localScreen = useLocalScreen();
	const [position, setPosition] = useState(() => ({
		x: Math.max(8, window.innerWidth - WIDTH - 20),
		y: Math.max(8, window.innerHeight - HEIGHT - 20),
	}));
	const drag = useRef<{offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean} | null>(null);

	const remote = remotes.find((entry) => entry.video && entry.video.getVideoTracks()[0]?.readyState === 'live');
	const stream = remote?.video ?? (state.voice.sharing ? localScreen : null);

	if (!state.voice.channelId || state.voice.stageOpen || !stream) return null;

	function clamp(x: number, y: number): {x: number; y: number} {
		return {
			x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - WIDTH - 8)),
			y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - HEIGHT - 8)),
		};
	}

	function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag.current = {
			offsetX: event.clientX - position.x,
			offsetY: event.clientY - position.y,
			startX: event.clientX,
			startY: event.clientY,
			moved: false,
		};
	}

	function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
		const state_ = drag.current;
		if (!state_) return;
		if (Math.abs(event.clientX - state_.startX) > 4 || Math.abs(event.clientY - state_.startY) > 4) state_.moved = true;
		setPosition(clamp(event.clientX - state_.offsetX, event.clientY - state_.offsetY));
	}

	function onPointerUp(): void {
		const state_ = drag.current;
		drag.current = null;
		if (state_ && !state_.moved) dispatch({type: 'openVoiceStage'});
	}

	const videoRef = useRef<HTMLVideoElement>(null);
	// Asigna el stream al <video> (se re-ejecuta en cada render, es idempotente).
	if (videoRef.current && videoRef.current.srcObject !== stream) {
		videoRef.current.srcObject = stream;
		void videoRef.current.play().catch(() => {});
	}

	return (
		<div
			className="floating-stream"
			style={{left: position.x, top: position.y}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			title="Click para volver a la llamada">
			<video ref={videoRef} autoPlay playsInline muted />
			<span className="floating-stream-hint">En vivo · click para abrir</span>
		</div>
	);
}
