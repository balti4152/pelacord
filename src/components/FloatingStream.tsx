import {type PointerEvent, useEffect, useRef, useState} from 'react';
import {Icon} from '@/components/primitives';
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
	const remoteVideo = remote?.video ?? null;
	// Si lo único que hay para ver es MI propia transmisión, no se reproduce acá: mostrar tu
	// propia captura gasta GPU al pedo mientras jugás. La ventanita queda igual (se arrastra y
	// con un click volvés a la llamada).
	const ownShare = !remoteVideo && state.voice.sharing;
	const stream = remoteVideo ?? (state.voice.sharing ? localScreen : null);
	// Alcanza con estar compartiendo para mostrar el flotante: la captura local puede tardar
	// (o no estar), pero la ventanita tiene que estar igual.
	const visible = Boolean(state.voice.channelId && !state.voice.stageOpen && (stream || ownShare));

	// Asigna el stream al <video> (todos los hooks van arriba, sin returns previos).
	useEffect(() => {
		if (ownShare) return;
		if (!videoRef.current || !stream) return;
		if (videoRef.current.srcObject !== stream) {
			videoRef.current.srcObject = stream;
			void videoRef.current.play().catch(() => {});
		}
	}, [stream, visible, ownShare]);

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
			{ownShare ? (
				<div className="floating-stream-off">
					<Icon name="screenShare" size={26} />
					<span>Vista previa desactivada para ahorrar rendimiento</span>
				</div>
			) : (
				<video ref={videoRef} autoPlay playsInline muted />
			)}
			<span className="floating-stream-hint">{ownShare ? 'Compartiendo · click para abrir' : 'En vivo · click para abrir'}</span>
		</div>
	);
}
