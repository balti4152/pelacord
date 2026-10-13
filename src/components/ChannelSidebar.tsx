import {useEffect, useState} from 'react';
import {ColorAvatar, Icon} from '@/components/primitives';
import {useSpeakingIds} from '@/components/RemoteMedia';
import {installUpdate, useUpdater} from '@/lib/updater';
import {VoicePanel} from '@/components/VoicePanel';
import {VOICE_CATEGORY, useStore} from '@/state/store';
import type {Channel} from '@/types';

function UserPanel({onOpenSettings}: {onOpenSettings: () => void}): JSX.Element {
	const {state} = useStore();
	return (
		<div className="user-panel" data-flx="user-panel">
			<button type="button" className="user-panel-main" onClick={onOpenSettings}>
				<ColorAvatar
					name={state.me.name}
					color={state.me.avatarColor}
					url={state.me.avatarUrl}
					crop={state.me.avatarCrop}
					effect={state.me.effect}
					decoration={state.me.decoration}
					decorationColor={state.me.decorationColor}
					customDeco={state.me.customDeco}
					decoImage={state.me.decoImage}
					decoSize={state.me.decoSize}
					original={state.me.particleOriginal}
					size={32}
					status={state.me.presence}
					statusBorderColor="var(--background-secondary-alt)"
				/>
				<span className="user-panel-info">
					<span className="user-panel-name">{state.me.name}</span>
					<span className="user-panel-sub">#{state.me.tag}</span>
				</span>
			</button>
			<div className="user-panel-actions">
				<button type="button" className="icon-btn" title="Ajustes" onClick={onOpenSettings}>
					<Icon name="settings" size={20} />
				</button>
			</div>
		</div>
	);
}

/** The connected people listed under a voice channel: small avatar + name, like Discord. */
function VoiceChannelMembers({channelId}: {channelId: string}): JSX.Element | null {
	const {state} = useStore();
	const speakingIds = useSpeakingIds();
	const participants = state.voiceMembers[channelId] ?? [];
	if (participants.length === 0) return null;
	return (
		<div className="voice-members">
			{participants.map((participant) => {
				const isMe = participant.id === state.me.id;
				const speaking = speakingIds.includes(participant.id);
				return (
					<div className={`voice-member${speaking ? ' is-speaking' : ''}`} key={participant.id}>
						<ColorAvatar
							name={participant.name}
							color={participant.color}
							url={participant.avatarUrl}
							crop={participant.avatarCrop}
							decoration={participant.decoration}
							decorationColor={participant.decorationColor}
							customDeco={participant.customDeco}
							decoImage={participant.decoImage}
							decoSize={participant.decoSize}
							original={participant.original}
							size={22}
						/>
						<span className="voice-member-name">{isMe ? 'Tú' : participant.name}</span>
						{participant.sharing ? <span className="live-badge">EN VIVO</span> : null}
						{participant.deafened ? <Icon name="headphonesOff" size={13} /> : null}
						{participant.muted && !participant.deafened ? <Icon name="micOff" size={13} /> : null}
					</div>
				);
			})}
		</div>
	);
}

function UpdateBanner(): JSX.Element | null {
	const status = useUpdater();
	const {state} = useStore();
	// No se reinicia con una llamada en curso: se espera a salir de la llamada.
	const inCall = state.voice.channelId !== null;
	const [countdown, setCountdown] = useState<number | null>(null);

	useEffect(() => {
		if (status.state !== 'downloaded' || inCall) {
			setCountdown(null);
			return;
		}
		setCountdown(5);
		const timer = setInterval(() => {
			setCountdown((value) => {
				if (value === null) return null;
				if (value <= 1) {
					clearInterval(timer);
					installUpdate();
					return 0;
				}
				return value - 1;
			});
		}, 1000);
		return () => clearInterval(timer);
	}, [status.state, inCall]);

	if (status.state === 'downloaded') {
		if (inCall) {
			return (
				<div className="update-banner is-ready">
					<Icon name="download" size={14} /> Actualización lista · se reinicia al salir de la llamada
				</div>
			);
		}
		return (
			<button type="button" className="update-banner is-ready" onClick={installUpdate}>
				<Icon name="download" size={14} /> Reiniciando en {countdown ?? 0}… (click para reiniciar ya)
			</button>
		);
	}
	if (status.state === 'downloading' || status.state === 'available') {
		return (
			<div className="update-banner">
				<Icon name="download" size={14} /> Descargando actualización… {status.percent ?? 0}%
			</div>
		);
	}
	return null;
}

export function ChannelSidebar({
	onOpenSettings,
	onOpenVoice,
}: {
	onOpenSettings: () => void;
	onOpenVoice: () => void;
}): JSX.Element {
	const {state, dispatch, addChannel, removeChannel} = useStore();
	/** Categoría en la que se está creando un canal (null = no hay diálogo abierto). */
	const [creating, setCreating] = useState<Channel['type'] | null>(null);
	const [newName, setNewName] = useState('');
	/** Menú del clic derecho sobre un canal. */
	const [menu, setMenu] = useState<{channelId: string; name: string; x: number; y: number} | null>(null);
	const [deleting, setDeleting] = useState<{channelId: string; name: string} | null>(null);

	const categories = Array.from(new Set(state.channels.map((c) => c.category)));

	// El menú del clic derecho se cierra con un clic en cualquier lado o con Escape.
	// Ojo: NO se cierra con `contextmenu`, porque si no, abrir el menú de otro canal no andaría.
	useEffect(() => {
		if (!menu) return;
		const close = () => setMenu(null);
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setMenu(null);
		};
		window.addEventListener('click', close);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('click', close);
			window.removeEventListener('keydown', onKey);
		};
	}, [menu]);

	function openChannel(channel: Channel): void {
		if (channel.type === 'text') {
			dispatch({type: 'selectChannel', channelId: channel.id});
			return;
		}
		if (state.voice.channelId === channel.id) {
			onOpenVoice();
		} else {
			dispatch({type: 'joinVoice', channelId: channel.id});
		}
	}

	function submitCreate(): void {
		if (!creating || !newName.trim()) return;
		addChannel(creating, newName);
		setCreating(null);
		setNewName('');
	}

	return (
		<div className="sidebar">
			<button type="button" className="sidebar-header">
				<span className="sidebar-header-title">Pelacord</span>
			</button>
			<UpdateBanner />
			<div className="sidebar-scroll">
				{categories.map((category, index) => (
					<div className="channel-category" key={category} style={index === 0 ? {marginTop: 0} : undefined}>
						<div className="channel-category-header">
							<Icon name="chevronDown" size={12} />
							<span>{category}</span>
							<button
								type="button"
								className="channel-add"
								title={category === VOICE_CATEGORY ? 'Crear canal de voz' : 'Crear canal de texto'}
								onClick={() => {
									setNewName('');
									setCreating(category === VOICE_CATEGORY ? 'voice' : 'text');
								}}>
								<Icon name="plus" size={14} />
							</button>
						</div>
						{state.channels
							.filter((c) => c.category === category)
							.map((channel) => {
								const isActive = channel.type === 'text' && state.activeChannelId === channel.id;
								const isConnected = channel.type === 'voice' && state.voice.channelId === channel.id;
								return (
									<div key={channel.id}>
										<button
											type="button"
											className={`channel${isActive || isConnected ? ' is-active' : ''}${state.unread[channel.id] ? ' is-unread' : ''}`}
											onClick={() => openChannel(channel)}
											onContextMenu={(event) => {
												event.preventDefault();
												setMenu({channelId: channel.id, name: channel.name, x: event.clientX, y: event.clientY});
											}}>
											<span className="channel-icon">
												<Icon name={channel.type === 'text' ? 'hash' : 'speaker'} size={18} />
											</span>
											<span className="channel-name">{channel.name}</span>
											{state.unread[channel.id] ? <span className="channel-unread" title="Mensajes sin leer" /> : null}
										</button>
										{channel.type === 'voice' ? <VoiceChannelMembers channelId={channel.id} /> : null}
									</div>
								);
							})}
					</div>
				))}
			</div>
			<VoicePanel onOpenVoice={onOpenVoice} />
			<UserPanel onOpenSettings={onOpenSettings} />
			{menu ? (
				<div className="context-menu" style={{left: menu.x, top: menu.y}} onClick={(event) => event.stopPropagation()}>
					<button
						type="button"
						className="is-danger"
						disabled={state.channels.length <= 1}
						title={state.channels.length <= 1 ? 'No podés quedarte sin canales' : undefined}
						onClick={() => {
							setDeleting({channelId: menu.channelId, name: menu.name});
							setMenu(null);
						}}>
						<Icon name="trash" size={15} />
						Eliminar canal
					</button>
				</div>
			) : null}
			{creating ? (
				<div className="modal-backdrop" onClick={() => setCreating(null)}>
					<div className="dialog" onClick={(event) => event.stopPropagation()}>
						<h2 className="dialog-title">{creating === 'voice' ? 'Crear canal de voz' : 'Crear canal de texto'}</h2>
						<div className="dialog-field">
							<span>Nombre del canal</span>
							<input
								autoFocus
								value={newName}
								maxLength={60}
								placeholder={creating === 'voice' ? 'ej. Charla' : 'ej. anuncios'}
								onChange={(event) => setNewName(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') submitCreate();
									if (event.key === 'Escape') setCreating(null);
								}}
							/>
						</div>
						<div className="dialog-actions">
							<button type="button" className="button secondary" onClick={() => setCreating(null)}>
								Cancelar
							</button>
							<button type="button" className="button primary" disabled={!newName.trim()} onClick={submitCreate}>
								Crear canal
							</button>
						</div>
					</div>
				</div>
			) : null}
			{deleting ? (
				<div className="modal-backdrop" onClick={() => setDeleting(null)}>
					<div className="dialog" onClick={(event) => event.stopPropagation()}>
						<h2 className="dialog-title">Eliminar canal</h2>
						<p className="dialog-text">
							¿Seguro que querés eliminar <strong>{deleting.name}</strong>? Se borra de la lista para todos y no se puede
							deshacer.
						</p>
						<div className="dialog-actions">
							<button type="button" className="button secondary" onClick={() => setDeleting(null)}>
								Cancelar
							</button>
							<button
								type="button"
								className="button danger"
								onClick={() => {
									removeChannel(deleting.channelId);
									setDeleting(null);
								}}>
								Eliminar
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
