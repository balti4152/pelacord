import {useEffect, useRef, useState} from 'react';
import {type MeshRemote, voiceMesh} from '@/lib/media';
import {getOutputVolume, subscribeOutputVolume} from '@/lib/sounds';
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

export function useMeshRemotes(): MeshRemote[] {
	const [remotes, setRemotes] = useState<MeshRemote[]>(voiceMesh.getRemotes());
	useEffect(() => voiceMesh.subscribe(() => setRemotes(voiceMesh.getRemotes())), []);
	return remotes;
}

export function useMeshStates(): Record<string, RTCPeerConnectionState> {
	const [states, setStates] = useState<Record<string, RTCPeerConnectionState>>(voiceMesh.getStates());
	useEffect(() => voiceMesh.subscribe(() => setStates(voiceMesh.getStates())), []);
	return states;
}

export function useMeshDiagnostics(): Record<string, {sent: number; received: number; ice: RTCIceConnectionState}> {
	const [diagnostics, setDiagnostics] = useState(voiceMesh.getDiagnostics());
	useEffect(() => voiceMesh.subscribe(() => setDiagnostics(voiceMesh.getDiagnostics())), []);
	return diagnostics;
}

export function useLocalStream(): MediaStream | null {
	const [stream, setStream] = useState<MediaStream | null>(voiceMesh.getLocal());
	useEffect(() => voiceMesh.subscribe(() => setStream(voiceMesh.getLocal())), []);
	return stream;
}

export function useMeshDeafened(): boolean {
	const [deafened, setDeafened] = useState(voiceMesh.isDeafened());
	useEffect(() => voiceMesh.subscribe(() => setDeafened(voiceMesh.isDeafened())), []);
	return deafened;
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
	useEffect(() => {
		if (!ref.current) return;
		ref.current.srcObject = stream;
		ref.current.muted = muted;
		ref.current.volume = volume;
		void ref.current.play().catch(() => {});
	}, [stream, muted, volume]);
	useEffect(() => {
		const element = ref.current as (HTMLAudioElement & {setSinkId?: (id: string) => Promise<void>}) | null;
		if (!element || !sinkId || sinkId === 'default' || typeof element.setSinkId !== 'function') return;
		void element.setSinkId(sinkId).catch(() => {});
	}, [sinkId]);
	return <audio ref={ref} autoPlay />;
}

/** Reproduce el audio de todos los peers conectados (la música ya no viene por acá: cada uno la
 * reproduce localmente, ver musicPlayer.ts). */
export function RemoteAudio(): JSX.Element {
	const remotes = useMeshRemotes();
	const deafened = useMeshDeafened();
	const volume = useOutputVolume();
	const {state} = useStore();
	const sinkId = state.settings.outputDeviceId;
	return (
		<>
			{remotes.flatMap((remote) => {
				const peerVolume = voiceMesh.getPeerVolume(remote.peerId);
				return remote.audios.map((stream, index) => (
					<AudioPlayer
						key={`${remote.peerId}-${index}`}
						stream={stream}
						muted={deafened}
						volume={volume * peerVolume}
						sinkId={sinkId}
					/>
				));
			})}
		</>
	);
}

/** Volumen de un peer (para el control de la vista enfocada). */
export function usePeerVolume(peerId: string): number {
	const [volume, setVolume] = useState(voiceMesh.getPeerVolume(peerId));
	useEffect(() => voiceMesh.subscribe(() => setVolume(voiceMesh.getPeerVolume(peerId))), [peerId]);
	return volume;
}

/** Ids que están hablando ahora (incluye el propio). */
export function useSpeakingIds(): string[] {
	const [ids, setIds] = useState<string[]>(voiceMesh.getSpeaking());
	useEffect(() => voiceMesh.subscribe(() => setIds(voiceMesh.getSpeaking())), []);
	return ids;
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
	const [screen, setScreen] = useState<MediaStream | null>(voiceMesh.getScreen());
	useEffect(() => voiceMesh.subscribe(() => setScreen(voiceMesh.getScreen())), []);
	const track = screen?.getVideoTracks()[0];
	return screen && track && track.readyState === 'live' ? screen : null;
}
