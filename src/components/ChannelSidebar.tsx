import {useEffect, useState} from 'react';
import {ColorAvatar, Icon} from '@/components/primitives';
import {useSpeakingIds} from '@/components/RemoteMedia';
import {formatBuildTime} from '@/lib/build';
import {installUpdate, useUpdater} from '@/lib/updater';
import {VoicePanel} from '@/components/VoicePanel';
import {useStore} from '@/state/store';
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
	const {state, dispatch} = useStore();

	const categories = Array.from(new Set(state.channels.map((c) => c.category)));

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

	return (
		<div className="sidebar">
			<button type="button" className="sidebar-header">
				<span className="sidebar-header-title">Pelacord</span>
				<span className="build-time" title="Versión: fecha y hora de compilación">
					{formatBuildTime()}
				</span>
				<Icon name="chevronDown" size={18} />
			</button>
			<UpdateBanner />
			<div className="sidebar-scroll">
				{categories.map((category, index) => (
					<div className="channel-category" key={category} style={index === 0 ? {marginTop: 0} : undefined}>
						<div className="channel-category-header">
							<Icon name="chevronDown" size={12} />
							{category}
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
											className={`channel${isActive || isConnected ? ' is-active' : ''}`}
											onClick={() => openChannel(channel)}>
											<span className="channel-icon">
												<Icon name={channel.type === 'text' ? 'hash' : 'speaker'} size={18} />
											</span>
											<span className="channel-name">{channel.name}</span>
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
		</div>
	);
}
