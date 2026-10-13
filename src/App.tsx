import {useEffect, useMemo, useRef, useState} from 'react';
import {CallStage} from '@/components/CallStage';
import {ChannelSidebar} from '@/components/ChannelSidebar';
import {ChatView} from '@/components/ChatView';
import {MemberList} from '@/components/MemberList';
import {Onboarding} from '@/components/Onboarding';
import {FloatingStream} from '@/components/FloatingStream';
import {Icon} from '@/components/primitives';
import {RemoteAudio} from '@/components/RemoteMedia';
import {ScreenSharePicker} from '@/components/ScreenSharePicker';
import {SettingsModal} from '@/components/SettingsModal';
import {getDesktopTransport, isDesktop} from '@/lib/desktop';
import {hasChosenName} from '@/lib/identity';
import {attachFiles} from '@/lib/attach';
import {voiceMesh} from '@/lib/media';
import {initUpdater} from '@/lib/updater';
import {openSharePicker, subscribeSharePicker} from '@/lib/sharePicker';
import {playSound} from '@/lib/sounds';
import {useStore} from '@/state/store';

export function App(): JSX.Element {
	const {state, dispatch} = useStore();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [sharePickerOpen, setSharePickerOpen] = useState(false);
	const [dragging, setDragging] = useState(false);

	useEffect(() => subscribeSharePicker(() => setSharePickerOpen(true)), []);

	useEffect(() => {
		initUpdater();
	}, []);

	// Arrastrar y soltar archivos en cualquier parte de la ventana.
	useEffect(() => {
		const resetDrag = () => setDragging(false);
		const onDragOver = (event: DragEvent) => {
			if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) {
				event.preventDefault();
				setDragging(true);
			}
		};
		const onDragLeave = (event: DragEvent) => {
			if (event.relatedTarget === null) setDragging(false);
		};
		const onDrop = (event: DragEvent) => {
			if (!event.dataTransfer || event.dataTransfer.files.length === 0) return;
			event.preventDefault();
			setDragging(false);
			attachFiles(Array.from(event.dataTransfer.files));
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
	}, []);

	const showStage = state.voice.channelId !== null && state.voice.stageOpen;
	const showMembers = !showStage && state.settings.showMembers;

	// Malla de voz: arranca al entrar a un canal y se apaga al salir.
	useEffect(() => {
		if (!isDesktop()) return;
		if (!state.voice.channelId) {
			voiceMesh.stop();
			return;
		}
		void voiceMesh.start(state.me.id);
	}, [state.voice.channelId, state.me.id]);

	const peersInChannel = useMemo(
		() =>
			state.voice.channelId
				? (state.voiceMembers[state.voice.channelId] ?? []).map((p) => p.id).filter((id) => id !== state.me.id)
				: [],
		[state.voiceMembers, state.voice.channelId, state.me.id],
	);
	const peersKey = peersInChannel.join(',');

	// Conecta con quien está en el canal y corta con quien se fue.
	useEffect(() => {
		if (!isDesktop() || !state.voice.channelId) return;
		for (const id of peersInChannel) void voiceMesh.connect(id);
		for (const remote of voiceMesh.getRemotes()) {
			if (!peersInChannel.includes(remote.peerId)) voiceMesh.disconnect(remote.peerId);
		}
		// peersKey resume peersInChannel; no se incluye el array para no reejecutar en cada render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [peersKey, state.voice.channelId]);

	// Compartir pantalla.
	useEffect(() => {
		if (!isDesktop()) return;
		if (state.voice.sharing) void voiceMesh.startScreen();
		else voiceMesh.stopScreen();
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

	// Sonido cuando otra persona entra al mismo canal de voz.
	const remoteInChannel = state.voice.channelId
		? (state.voiceMembers[state.voice.channelId] ?? []).filter((p) => p.id !== state.me.id).length
		: 0;
	const prevRemote = useRef(remoteInChannel);
	useEffect(() => {
		if (state.voice.channelId && remoteInChannel > prevRemote.current) playSound('userJoined');
		prevRemote.current = remoteInChannel;
	}, [remoteInChannel, state.voice.channelId]);

	/** ¿Estoy compartiendo pantalla? Se guarda en un ref para que los atajos lo lean siempre al día. */
	const sharingRef = useRef(state.voice.sharing);
	sharingRef.current = state.voice.sharing;

	/** Comparte la ventana que el usuario tenía enfocada, sin abrir el selector. */
	async function shareFocusedWindow(): Promise<void> {
		const transport = getDesktopTransport();
		if (!transport) return;
		try {
			const sources = await transport.getDesktopSources();
			// Chromium devuelve las ventanas por uso reciente: la primera es la que estaba adelante.
			const target = sources.find((source) => source.kind === 'window') ?? sources[0];
			if (!target) return;
			transport.selectSource(target.id);
			voiceMesh.setScreenOptions({width: 1920, height: 1080, frameRate: 60, audio: false});
			dispatch({type: 'toggleVoiceFlag', flag: 'sharing'});
		} catch {
			// sin fuentes disponibles: no pasa nada
		}
	}

	// Atajos globales (funcionan aunque la app esté en segundo plano).
	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		return transport.onHotkey(({action}) => {
			if (action === 'mute') dispatch({type: 'toggleVoiceFlag', flag: 'muted'});
			else if (action === 'deafen') dispatch({type: 'toggleVoiceFlag', flag: 'deafened'});
			else if (action === 'shareScreen') {
				// Es un interruptor: si ya estás compartiendo, el mismo atajo corta la transmisión.
				if (sharingRef.current) dispatch({type: 'toggleVoiceFlag', flag: 'sharing'});
				else {
					// El selector tiene que verse: se trae la ventana al frente.
					transport.showWindow();
					openSharePicker();
				}
			} else if (action === 'shareFocused') {
				if (sharingRef.current) dispatch({type: 'toggleVoiceFlag', flag: 'sharing'});
				else void shareFocusedWindow();
			}
		});
		// Se registran una sola vez: el estado se lee del ref, no del render.
	}, []);

	if (!hasChosenName()) return <Onboarding />;

	return (
		<>
			<div className={`app-shell${showMembers ? '' : ' is-members-hidden'}`}>
				<ChannelSidebar
					onOpenSettings={() => setSettingsOpen(true)}
					onOpenVoice={() => dispatch({type: 'openVoiceStage'})}
				/>
				{showStage ? <CallStage /> : <ChatView />}
				{showMembers ? <MemberList /> : null}
			</div>
			<RemoteAudio />
			<FloatingStream />
			{settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
			{sharePickerOpen ? (
				<ScreenSharePicker
					onCancel={() => setSharePickerOpen(false)}
					onPick={(sourceId, options) => {
						setSharePickerOpen(false);
						getDesktopTransport()?.selectSource(sourceId);
						voiceMesh.setScreenOptions(options);
						if (!state.voice.sharing) dispatch({type: 'toggleVoiceFlag', flag: 'sharing'});
					}}
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
