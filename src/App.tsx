import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {CallStage} from '@/components/CallStage';
import {ChannelSidebar} from '@/components/ChannelSidebar';
import {ChatView} from '@/components/ChatView';
import {MemberList} from '@/components/MemberList';
import {MusicView} from '@/components/MusicView';
import {MoviesView} from '@/components/MoviesView';
import {Onboarding} from '@/components/Onboarding';
import {FloatingStream} from '@/components/FloatingStream';
import {Icon} from '@/components/primitives';
import {RemoteAudio} from '@/components/RemoteMedia';
import {ScreenSharePicker} from '@/components/ScreenSharePicker';
import {SettingsModal} from '@/components/SettingsModal';
import {getDesktopTransport, isDesktop, voiceSessionId} from '@/lib/desktop';
import {hasChosenName} from '@/lib/identity';
import {attachFiles} from '@/lib/attach';
import {voiceMesh} from '@/lib/media';
import {initUpdater} from '@/lib/updater';
import {DEFAULT_SHARE_OPTIONS, findShareSource, type ShareKind, type ShareOptions} from '@/lib/screenShare';
import {subscribeSharePicker} from '@/lib/sharePicker';
import {playSound} from '@/lib/sounds';
import {useStore} from '@/state/store';

export function App(): JSX.Element {
	const {state, dispatch} = useStore();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [musicOpen, setMusicOpen] = useState(false);
	const [moviesOpen, setMoviesOpen] = useState(false);
	const [sharePickerOpen, setSharePickerOpen] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);

	// El selector de pantalla se puede abrir desde cualquier lado (botón del sidebar, llamada…).
	useEffect(() => subscribeSharePicker(() => setSharePickerOpen(true)), []);

	useEffect(() => {
		initUpdater();
	}, []);

	// Arrastrar y soltar archivos en cualquier parte de la ventana.
	useEffect(() => {
		const resetDrag = () => setDragging(false);
		const onDragOver = (event: DragEvent) => {
			if (!hasChosenName()) return;
			if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) {
				event.preventDefault();
				setDragging(true);
			}
		};
		const onDragLeave = (event: DragEvent) => {
			if (event.relatedTarget === null) setDragging(false);
		};
		const onDrop = (event: DragEvent) => {
			if (!hasChosenName() || !event.dataTransfer || event.dataTransfer.files.length === 0) return;
			event.preventDefault();
			setDragging(false);
			setMusicOpen(false);
			setMoviesOpen(false);
			dispatch({type: 'minimizeVoice'});
			setDroppedFiles(Array.from(event.dataTransfer.files));
		};
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('dragleave', onDragLeave);
		window.addEventListener('drop', onDrop);
		window.addEventListener('dragend', resetDrag);
		window.addEventListener('blur', resetDrag);
		return () => {
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('drop', onDrop);
			window.removeEventListener('dragend', resetDrag);
			window.removeEventListener('blur', resetDrag);
		};
	}, [dispatch]);

	const showStage = state.voice.channelId !== null && state.voice.stageOpen;
	const shareChannel = state.channels.find(({id}) => id === state.voice.channelId);
	const showMembers = !showStage && !musicOpen && !moviesOpen && state.settings.showMembers;
	useEffect(() => {
		if (!droppedFiles || showStage || musicOpen || moviesOpen) return;
		attachFiles(droppedFiles);
		setDroppedFiles(null);
	}, [droppedFiles, showStage, musicOpen, moviesOpen]);

	useLayoutEffect(() => {
		if (!isDesktop()) return;
		const {channelId, joinedAt} = state.voice;
		voiceMesh.setRoom(state.me.id, channelId, voiceSessionId(joinedAt), channelId ? (state.voiceMembers[channelId] ?? []) : []);
	}, [state.me.id, state.voice.channelId, state.voice.joinedAt, state.voiceMembers]);

	useEffect(() => {
		if (isDesktop() && !state.voice.sharing) voiceMesh.stopScreen();
	}, [state.voice.sharing]);

	useEffect(() => setSharePickerOpen(false), [state.voice.joinedAt]);

	// Si la captura termina SOLA (el usuario aprieta "Dejar de compartir" en la barra del sistema, o
	// cierra la ventana que estaba compartiendo), la app tiene que enterarse. Si no, queda para
	// siempre el estado "estoy compartiendo" y la ventanita flotante no se va más (y no se podía
	// cerrar). Se mira cada vez que la malla avisa algo.
	useEffect(() => {
		if (!isDesktop() || !state.voice.sharing) return;
		let captured = Boolean(voiceMesh.getScreen());
		const revisar = () => {
			const track = voiceMesh.getScreen()?.getVideoTracks()[0];
			if (track?.readyState === 'live') captured = true;
			else if (captured) {
				captured = false;
				dispatch({type: 'setSharing', sharing: false});
			}
		};
		return voiceMesh.subscribe(revisar);
	}, [state.voice.sharing]);

	// Silenciar y ensordecer de verdad.
	useEffect(() => {
		if (!isDesktop()) return;
		voiceMesh.setMuted(state.voice.muted);
	}, [state.voice.muted]);

	useEffect(() => {
		if (!isDesktop()) return;
		voiceMesh.setDeafened(state.voice.deafened);
	}, [state.voice.deafened]);

	// Micrófono elegido.
	useEffect(() => {
		void voiceMesh.setInputDevice(state.settings.inputDeviceId);
	}, [state.settings.inputDeviceId]);

	// Sonidos de la interfaz.
	const prevVoice = useRef({channelId: null as string | null, muted: false, deafened: false, sharing: false});
	useEffect(() => {
		const previous = prevVoice.current;
		const voice = state.voice;
		if (voice.channelId !== previous.channelId) {
			if (voice.channelId) playSound('join');
			else playSound('leave');
		} else if (voice.channelId) {
			if (voice.deafened !== previous.deafened) playSound(voice.deafened ? 'deafen' : 'undeafen');
			else if (voice.muted !== previous.muted) playSound(voice.muted ? 'mute' : 'unmute');
			// Sonido propio al empezar o dejar de compartir pantalla.
			if (voice.sharing !== previous.sharing) playSound(voice.sharing ? 'streamStart' : 'streamStop');
		}
		prevVoice.current = {channelId: voice.channelId, muted: voice.muted, deafened: voice.deafened, sharing: voice.sharing};
	}, [state.voice.channelId, state.voice.muted, state.voice.deafened, state.voice.sharing]);

	// Sonido cuando alguien entra o sale del mismo canal de voz.
	const remoteInChannel = state.voice.channelId
		? (state.voiceMembers[state.voice.channelId] ?? []).filter((p) => p.id !== state.me.id).length
		: 0;
	const prevRemote = useRef(remoteInChannel);
	useEffect(() => {
		const previous = prevRemote.current;
		// Sólo cuenta lo que pasa DENTRO de la llamada: si entro o salgo yo, el sonido es el de
		// 'join'/'leave'. Si alguien se desconecta, el de 'userLeft' (y lo escuchan los demás).
		if (state.voice.channelId) {
			if (remoteInChannel > previous) playSound('userJoined');
			else if (remoteInChannel < previous) playSound('userLeft');
		}
		prevRemote.current = remoteInChannel;
	}, [remoteInChannel, state.voice.channelId]);

	/** ¿Estoy compartiendo pantalla? Se guarda en un ref para que los atajos lo lean siempre al día. */
	const sharingRef = useRef(state.voice.sharing);
	sharingRef.current = state.voice.sharing;
	const shareSession = useRef<string | undefined>();
	shareSession.current = state.voice.channelId ? voiceSessionId(state.voice.joinedAt) : undefined;
	const captureStarting = useRef(false);

	async function startShare(sourceId: string, options: ShareOptions): Promise<boolean> {
		const session = shareSession.current;
		if (!session || sharingRef.current || captureStarting.current) return false;
		captureStarting.current = true;
		voiceMesh.setScreenOptions(options);
		try {
			const started = await voiceMesh.startScreen(sourceId);
			if (!started || session !== shareSession.current) return false;
			sharingRef.current = true;
			dispatch({type: 'setSharing', sharing: true});
			setSharePickerOpen(false);
			return true;
		} catch {
			voiceMesh.stopScreen();
			return false;
		} finally {
			captureStarting.current = false;
		}
	}

	/**
	 * Comparte (o corta la transmisión) sin selector. `kind` decide qué se transmite:
	 * el monitor principal o la ventana que estaba adelante.
	 */
	async function toggleShare(kind: ShareKind): Promise<void> {
		if (sharingRef.current) {
			dispatch({type: 'setSharing', sharing: false});
			return;
		}
		const session = shareSession.current;
		if (!session || captureStarting.current) return;
		const source = await findShareSource(kind);
		if (source && session === shareSession.current) await startShare(source.id, DEFAULT_SHARE_OPTIONS);
	}

	// Atajos globales (funcionan aunque la app esté en segundo plano).
	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		return transport.onHotkey(({action}) => {
			if (action === 'mute') dispatch({type: 'toggleVoiceFlag', flag: 'muted'});
			else if (action === 'deafen') dispatch({type: 'toggleVoiceFlag', flag: 'deafened'});
			// Los dos atajos de compartir son un interruptor: el mismo atajo corta la transmisión.
			else if (action === 'shareScreen') void toggleShare('screen');
			else if (action === 'shareFocused') void toggleShare('window');
		});
		// Se registran una sola vez: el estado se lee del ref, no del render.
	}, []);

	if (!hasChosenName()) return <Onboarding />;

	return (
		<>
			<div className={`app-shell${isDesktop() ? ' is-desktop' : ''}${showMembers ? '' : ' is-members-hidden'}`}>
				<ChannelSidebar
					view={moviesOpen ? 'movies' : musicOpen ? 'music' : showStage ? 'call' : 'chat'}
					onOpenSettings={() => setSettingsOpen(true)}
					onOpenVoice={() => dispatch({type: 'openVoiceStage'})}
					onOpenMusic={() => {
						setMoviesOpen(false);
						setMusicOpen(true);
					}}
					onOpenMovies={() => {
						setMusicOpen(false);
						setMoviesOpen(true);
					}}
					onChannelClick={() => {
						setMusicOpen(false);
						setMoviesOpen(false);
					}}
				/>
				{moviesOpen ? (
					<MoviesView onClose={() => setMoviesOpen(false)} />
				) : musicOpen ? (
					<MusicView onClose={() => setMusicOpen(false)} />
				) : showStage ? (
					<CallStage key={state.voice.channelId} />
				) : (
					<ChatView />
				)}
				{showMembers ? <MemberList /> : null}
			</div>
			<RemoteAudio />
			<FloatingStream />
			{settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
			{sharePickerOpen && shareChannel ? (
				<ScreenSharePicker
					channelName={shareChannel.name}
					onCancel={() => {
						if (captureStarting.current) voiceMesh.stopScreen();
						setSharePickerOpen(false);
					}}
					onPick={startShare}
				/>
			) : null}
			{dragging ? (
				<div className="drop-overlay">
					<Icon name="attach" size={44} />
					<span>Soltá los archivos para adjuntarlos</span>
				</div>
			) : null}
		</>
	);
}
