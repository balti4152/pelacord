import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {type MeshRemote, voiceMesh} from '@/lib/media';
import {getOutputVolume, routeMediaOutput, subscribeOutputVolume} from '@/lib/sounds';
import {useStore} from '@/state/store';

export interface MediaDevices {
	inputs: MediaDeviceInfo[];
	outputs: MediaDeviceInfo[];
}

/** Lista micrófonos y altavoces; se actualiza cuando cambian los dispositivos. */
export function useMediaDevices(): MediaDevices {
	const [devices, setDevices] = useState<MediaDevices>({inputs: [], outputs: []});
	useEffect(() => {
		let active = true;
		async function refresh(): Promise<void> {
			try {
				const list = await navigator.mediaDevices.enumerateDevices();
				if (!active) return;
				setDevices({
					inputs: list.filter((device) => device.kind === 'audioinput'),
					outputs: list.filter((device) => device.kind === 'audiooutput'),
				});
			} catch {
				// sin acceso a dispositivos
			}
		}
		void refresh();
		navigator.mediaDevices.addEventListener('devicechange', refresh);
		return () => {
			active = false;
			navigator.mediaDevices.removeEventListener('devicechange', refresh);
		};
	}, []);
	return devices;
}

export function useOutputVolume(): number {
	const [volume, setVolume] = useState(getOutputVolume());
	useEffect(() => subscribeOutputVolume(() => setVolume(getOutputVolume())), []);
	return volume;
}

/**
 * Se suscribe a la malla pero sólo re-renderiza si el valor cambió DE VERDAD.
 *
 * La malla avisa por cualquier cosa (cada candidato ICE, cada cambio de "hablando"): sin este
 * filtro, cada aviso re-renderizaba la llamada, la barra lateral y el panel de voz.
 */
function useMeshValue<T>(read: () => T, equal: (a: T, b: T) => boolean): T {
	const [value, setValue] = useState<T>(read);
	useEffect(() => {
		const update = () => {
			const next = read();
			setValue((previous) => (equal(previous, next) ? previous : next));
		};
		update();
		return voiceMesh.subscribe(update);
		// `read` y `equal` son funciones fijas de cada hook.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return value;
}

/** Qué stream tiene cada uno y en qué estado está su pista (la pantalla se corta con "mute"). */
function trackFingerprint(stream: MediaStream | null, kind: 'audio' | 'video'): string {
	if (!stream) return '-';
	const track = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
	return `${stream.id}/${track?.id ?? '-'}/${track?.readyState ?? '-'}/${track?.muted ? 'm' : 'u'}`;
}

const remoteFingerprint = (remotes: MeshRemote[]): string =>
	remotes.map(({peerId, audio, video}) => `${peerId}:${trackFingerprint(audio, 'audio')}:${trackFingerprint(video, 'video')}`).join('|');

export function useMeshRemotes(): MeshRemote[] {
	// Los objetos de la malla se modifican en el lugar: se compara por contenido (ids de los streams).
	const [state, setState] = useState(() => ({list: voiceMesh.getRemotes().map((remote) => ({...remote}))}));
	useEffect(() => {
		const update = () => {
			const next = voiceMesh.getRemotes();
			setState((previous) =>
				remoteFingerprint(previous.list) === remoteFingerprint(next) ? previous : {list: next.map((remote) => ({...remote}))},
			);
		};
		update();
		return voiceMesh.subscribe(update);
	}, []);
	return state.list;
}

function sameRecord<V>(a: Record<string, V>, b: Record<string, V>): boolean {
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	return keys.every((key) => a[key] === b[key]);
}

export function useMeshStates(): Record<string, RTCPeerConnectionState> {
	return useMeshValue(() => voiceMesh.getStates(), sameRecord);
}

export function useMeshDiagnostics(): Record<string, {sent: number; received: number; ice: RTCIceConnectionState}> {
	const [diagnostics, setDiagnostics] = useState(voiceMesh.getDiagnostics());
	useEffect(() => voiceMesh.subscribe(() => setDiagnostics(voiceMesh.getDiagnostics())), []);
	return diagnostics;
}

export function useLocalStream(): MediaStream | null {
	return useMeshValue(() => voiceMesh.getLocal(), Object.is);
}

export function useMeshDeafened(): boolean {
	return useMeshValue(() => voiceMesh.isDeafened(), Object.is);
}

function AudioPlayer({
	stream,
	muted,
	volume,
	sinkId,
}: {
	stream: MediaStream;
	muted: boolean;
	volume: number;
	sinkId: string;
}): JSX.Element {
	const ref = useRef<HTMLAudioElement>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.srcObject = stream;
		return () => {
			element.pause();
			element.srcObject = null;
		};
	}, [stream]);
	useLayoutEffect(() => {
		if (ref.current) ref.current.volume = volume;
	}, [volume]);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		let active = true;
		void routeMediaOutput(element, sinkId).then(() => {
			if (active && element.srcObject === stream && element.paused) void element.play().catch(() => {});
		});
		return () => { active = false; };
	}, [sinkId, stream]);
	return <audio ref={ref} muted={muted} />;
}

/** Reproduce el audio de todos los peers conectados (la música ya no viene por acá: cada uno la
 * reproduce localmente, ver musicPlayer.ts). */
export function RemoteAudio(): JSX.Element {
	const remotes = useMeshRemotes();
	const deafened = useMeshDeafened();
	const volume = useOutputVolume();
	const peerVolumes = useMeshValue(() => voiceMesh.getPeerVolumes(), sameRecord);
	const {state} = useStore();
	const sinkId = state.settings.outputDeviceId;
	return (
		<>
			{remotes.map(({peerId, audio}) => audio && (
				<AudioPlayer key={peerId} stream={audio} muted={deafened} volume={volume * (peerVolumes[peerId] ?? 1)} sinkId={sinkId} />
			))}
		</>
	);
}

/** Volumen de un peer (para el control de la vista enfocada). */
export function usePeerVolume(peerId: string): number {
	const [volume, setVolume] = useState(voiceMesh.getPeerVolume(peerId));
	useEffect(() => {
		setVolume(voiceMesh.getPeerVolume(peerId));
		return voiceMesh.subscribe(() => setVolume(voiceMesh.getPeerVolume(peerId)));
	}, [peerId]);
	return volume;
}

/** Ids que están hablando ahora (incluye el propio). */
export function useSpeakingIds(): string[] {
	return useMeshValue(
		() => voiceMesh.getSpeaking(),
		(a, b) => a.length === b.length && a.every((id) => b.includes(id)),
	);
}

/** Devuelve el primer video remoto disponible y vivo (pantalla compartida por otro). */
export function useRemoteVideo(): MediaStream | null {
	const remotes = useMeshRemotes();
	for (const remote of remotes) {
		const track = remote.video?.getVideoTracks()[0];
		// `muted` = el otro dejó de mandar (se corta con replaceTrack, sin renegociar).
		if (remote.video && track && track.readyState === 'live' && !track.muted) return remote.video;
	}
	return null;
}

/** Devuelve la pantalla local si este peer está compartiendo (y viva). */
export function useLocalScreen(): MediaStream | null {
	// Se mira también si la pista sigue viva: cuando termina hay que dejar de mostrarla.
	const snapshot = useMeshValue(
		() => {
			const stream = voiceMesh.getScreen();
			return {stream, live: stream?.getVideoTracks()[0]?.readyState === 'live'};
		},
		(a, b) => a.stream === b.stream && a.live === b.live,
	);
	return snapshot.live ? snapshot.stream : null;
}
