import {type PointerEvent, useEffect, useRef, useState} from 'react';
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
	const videoRef = useRef<HTMLVideoElement>(null);

	const remote = remotes.find((entry) => entry.video && entry.video.getVideoTracks()[0]?.readyState === 'live');
	const stream = remote?.video ?? (state.voice.sharing ? localScreen : null);
	const visible = Boolean(state.voice.channelId && !state.voice.stageOpen && stream);

	// Asigna el stream al <video> (todos los hooks van arriba, sin returns previos).
	useEffect(() => {
		if (!videoRef.current || !stream) return;
		if (videoRef.current.srcObject !== stream) {
			videoRef.current.srcObject = stream;
			void videoRef.current.play().catch(() => {});
		}
	}, [stream, visible]);

	if (!visible) return null;

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
		const active = drag.current;
		if (!active) return;
		if (Math.abs(event.clientX - active.startX) > 4 || Math.abs(event.clientY - active.startY) > 4) active.moved = true;
		setPosition(clamp(event.clientX - active.offsetX, event.clientY - active.offsetY));
	}

	function onPointerUp(): void {
		const active = drag.current;
		drag.current = null;
		if (active && !active.moved) dispatch({type: 'openVoiceStage'});
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
