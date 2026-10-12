import {useEffect, useState} from 'react';
import {Icon, IconButton} from '@/components/primitives';
import {getDesktopTransport} from '@/lib/desktop';
import {openSharePicker} from '@/lib/sharePicker';
import {useStore} from '@/state/store';

/**
 * The bottom-left "Voice Connected" panel. Always visible while in a call, whether or not the
 * full-screen call view is open. Holds the disconnect, mute, deafen, camera and screen-share controls.
 */
export function VoicePanel({onOpenVoice}: {onOpenVoice: () => void}): JSX.Element | null {
	const {state, dispatch} = useStore();
	const [peers, setPeers] = useState<number | null>(null);
	const {voice} = state;

	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		let active = true;
		const poll = async () => {
			try {
				const ids = await transport.getPeers();
				if (active) setPeers(ids.length);
			} catch {
				if (active) setPeers(null);
			}
		};
		void poll();
		const timer = setInterval(poll, 3000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, []);

	if (!voice.channelId) return null;
	const channel = state.channels.find((c) => c.id === voice.channelId);
	if (!channel) return null;

	return (
		<div className="voice-panel" data-flx="voice-panel">
			<div className="voice-panel-top">
				<button type="button" className="voice-panel-info" onClick={onOpenVoice} title="Abrir la llamada">
					<span className="voice-panel-signal">
						<Icon name="speaker" size={16} />
					</span>
					<span className="voice-panel-text">
						<span className="voice-panel-title">Conectado a voz</span>
						<span className="voice-panel-sub">
							{channel.name}
							{peers !== null ? ` · red: ${peers}` : ''}
						</span>
					</span>
				</button>
				<IconButton icon="phoneOff" label="Desconectar" onClick={() => dispatch({type: 'leaveVoice'})} size={18} />
			</div>
			<div className="voice-panel-controls">
				<button
					type="button"
					className={`voice-mini${voice.video ? ' is-active' : ''}`}
					title="Cámara"
					onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'video'})}>
					<Icon name="video" size={18} />
				</button>
				<button
					type="button"
					className={`voice-mini${voice.sharing ? ' is-active' : ''}`}
					title="Compartir pantalla"
					onClick={() => {
						if (voice.sharing) dispatch({type: 'toggleVoiceFlag', flag: 'sharing'});
						else openSharePicker();
					}}>
					<Icon name="screenShare" size={18} />
				</button>
				<button
					type="button"
					className={`voice-mini${voice.muted ? ' is-danger' : ''}`}
					title={voice.muted ? 'Activar micrófono' : 'Silenciar'}
					onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'muted'})}>
					<Icon name={voice.muted ? 'micOff' : 'mic'} size={18} />
				</button>
				<button
					type="button"
					className={`voice-mini${voice.deafened ? ' is-danger' : ''}`}
					title={voice.deafened ? 'Activar audio' : 'Ensordecer'}
					onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'deafened'})}>
					<Icon name={voice.deafened ? 'headphonesOff' : 'headphones'} size={18} />
				</button>
			</div>
		</div>
	);
}
