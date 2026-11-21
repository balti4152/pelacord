import {RefreshCw} from 'lucide-react';
import {useMeshStates} from '@/components/RemoteMedia';
import {Icon, IconButton} from '@/components/primitives';
import {isDesktop} from '@/lib/desktop';
import {voiceMesh} from '@/lib/media';
import {openSharePicker} from '@/lib/sharePicker';
import {useStore} from '@/state/store';

/**
 * The bottom-left "Voice Connected" panel. Always visible while in a call, whether or not the
 * full-screen call view is open.
 */
export function VoicePanel({onOpenVoice}: {onOpenVoice: () => void}): JSX.Element | null {
	const {state, dispatch} = useStore();
	const connections = useMeshStates();
	const {voice} = state;

	if (!voice.channelId) return null;
	const channel = state.channels.find((c) => c.id === voice.channelId);
	if (!channel) return null;
	const others = (state.voiceMembers[channel.id] ?? []).filter(({id}) => id !== state.me.id);
	const connected = others.filter(({id}) => connections[id] === 'connected').length;
	const recovering = others.some(({id}) => connections[id] === 'disconnected' || connections[id] === 'failed');
	const status = !isDesktop() ? 'Voz en la app de escritorio' : others.length === 0 ? 'Estás solo en el canal' :
		connected === others.length ? 'Voz conectada' : recovering ? 'Reconectando…' : connected ? `${connected} de ${others.length} en llamada` : 'Conectando…';

	return (
		<div className="voice-panel" data-flx="voice-panel">
			<div className="voice-panel-top">
				<button type="button" className="voice-panel-info" onClick={onOpenVoice} title="Abrir la llamada">
					<span className={`voice-panel-signal${connected ? ' is-connected' : ''}${recovering ? ' is-recovering' : ''}`}>
						<Icon name="speaker" size={16} />
					</span>
					<span className="voice-panel-text">
						<span className="voice-panel-title">{channel.name}</span>
						<span className="voice-panel-sub" role="status">{status}</span>
					</span>
				</button>
				<IconButton icon="phoneOff" label="Desconectar" onClick={() => dispatch({type: 'leaveVoice'})} size={18} />
			</div>
			<div className="voice-panel-controls">
				<button
					type="button"
					className={`voice-mini${voice.sharing ? ' is-active' : ''}`}
					aria-pressed={voice.sharing}
					title={voice.sharing ? 'Dejar de compartir' : 'Compartir pantalla'}
					onClick={() => {
						// Desde la interfaz sí se elige: se abre el selector con pantallas, ventanas y calidad.
						if (voice.sharing) dispatch({type: 'toggleVoiceFlag', flag: 'sharing'});
						else openSharePicker();
					}}>
					<Icon name="screenShare" size={18} />
				</button>
				<button
					type="button"
					className={`voice-mini${voice.muted ? ' is-danger' : ''}`}
					aria-pressed={voice.muted}
					title={voice.muted ? (voice.deafened ? 'Activar micrófono y audio' : 'Activar micrófono') : 'Silenciar'}
					onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'muted'})}>
					<Icon name={voice.muted ? 'micOff' : 'mic'} size={18} />
				</button>
				<button
					type="button"
					className={`voice-mini${voice.deafened ? ' is-danger' : ''}`}
					aria-pressed={voice.deafened}
					title={voice.deafened ? 'Activar audio' : 'Ensordecer y silenciar el micrófono'}
					onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'deafened'})}>
					<Icon name={voice.deafened ? 'headphonesOff' : 'headphones'} size={18} />
				</button>
				<button type="button" className="voice-mini" aria-label="Reconectar voz" title="Reconectar voz" disabled={!others.length} onClick={() => void voiceMesh.reconnect()}>
					<RefreshCw size={17} />
				</button>
			</div>
		</div>
	);
}
