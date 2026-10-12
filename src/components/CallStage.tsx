import {useEffect, useRef, useState} from 'react';
import {ColorAvatar, Icon, IconButton} from '@/components/primitives';
import {
	useLocalScreen,
	useMeshRemotes,
	useMeshStates,
	useOutputVolume,
	usePeerVolume,
	useSpeakingIds,
} from '@/components/RemoteMedia';
import {ProfilePopover, UserContextMenu, type UserLike} from '@/components/UserMenu';
import {voiceMesh} from '@/lib/media';
import {openSharePicker} from '@/lib/sharePicker';
import {setOutputVolume} from '@/lib/sounds';
import {useStore} from '@/state/store';
import type {VoiceParticipant} from '@/types';

const STATE_TITLE: Record<string, string> = {
	new: 'Conectando',
	connecting: 'Conectando',
	connected: 'Conectado',
	disconnected: 'Sin conexión',
	failed: 'Falló',
	closed: 'Cerrado',
};

/** Video solo-imagen: el audio va aparte (RemoteAudio), así el volumen por persona afecta a todo. */
function VideoSurface({stream}: {stream: MediaStream}): JSX.Element {
	const ref = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (!ref.current) return;
		ref.current.srcObject = stream;
		void ref.current.play().catch(() => {});
	}, [stream]);
	return <video ref={ref} autoPlay playsInline muted />;
}

function ParticipantCard({
	participant,
	isMe,
	video,
	speaking,
	state,
	compact,
	onExpand,
	onMenu,
}: {
	participant: VoiceParticipant;
	isMe: boolean;
	video: MediaStream | null;
	speaking: boolean;
	state: string;
	compact: boolean;
	onExpand: () => void;
	onMenu: (x: number, y: number) => void;
}): JSX.Element {
	const classes = ['pcard'];
	if (speaking) classes.push('is-speaking');
	if (compact) classes.push('is-compact');
	if (video) classes.push('has-video');
	return (
		<div
			className={classes.join(' ')}
			onClick={() => {
				if (video) onExpand();
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				onMenu(event.clientX, event.clientY);
			}}
			role={video ? 'button' : undefined}
			title={video ? 'Click para ampliar · Click derecho para volumen' : 'Click derecho para volumen'}>
			<div className="pcard-media">
				{video ? (
					<VideoSurface stream={video} />
				) : (
					<ColorAvatar name={participant.name} color={participant.color} url={participant.avatarUrl} size={compact ? 48 : 88} />
				)}
			</div>
			<div className="pcard-footer">
				<span className="pcard-name">
					{video ? <Icon name="screenShare" size={12} /> : null}
					{isMe ? `${participant.name} (vos)` : participant.name}
				</span>
				{participant.muted ? <Icon name="micOff" size={14} /> : null}
			</div>
			{!isMe ? (
				<span className={`pcard-status is-${state}`} title={STATE_TITLE[state] ?? state} />
			) : null}
		</div>
	);
}

function useElapsed(joinedAt: number | null): string {
	const [, force] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => force((value) => value + 1), 1000);
		return () => clearInterval(timer);
	}, []);
	if (!joinedAt) return '00:00';
	const total = Math.max(0, Math.floor((Date.now() - joinedAt) / 1000));
	const seconds = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	const pad = (value: number) => String(value).padStart(2, '0');
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function VolumeRow({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
}): JSX.Element {
	return (
		<label className="call-sound-row">
			<span className="call-sound-label">{label}</span>
			<input
				type="range"
				min={0}
				max={1}
				step={0.01}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
			<span className="call-sound-value">{Math.round(value * 100)}%</span>
		</label>
	);
}

/** Controles de sonido: volumen general de salida + el de quien está compartiendo. */
function VolumeMenu({presenter}: {presenter: {id: string; name: string} | null}): JSX.Element {
	const output = useOutputVolume();
	const presenterVolume = usePeerVolume(presenter?.id ?? '');
	return (
		<div className="call-sound" onClick={(event) => event.stopPropagation()}>
			<span className="call-sound-title">Sonido</span>
			<VolumeRow label="Salida general" value={output} onChange={setOutputVolume} />
			{presenter ? (
				<VolumeRow
					label={presenter.name}
					value={presenterVolume}
					onChange={(value) => voiceMesh.setPeerVolume(presenter.id, value)}
				/>
			) : null}
		</div>
	);
}

export function CallStage(): JSX.Element | null {
	const {state, dispatch} = useStore();
	const {voice} = state;
	const remotes = useMeshRemotes();
	const meshStates = useMeshStates();
	const localScreen = useLocalScreen();
	const speakingIds = useSpeakingIds();
	const elapsed = useElapsed(voice.joinedAt);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [menu, setMenu] = useState<{id: string; x: number; y: number} | null>(null);
	const [profile, setProfile] = useState<UserLike | null>(null);
	const [hideStrip, setHideStrip] = useState(false);
	const [showVolume, setShowVolume] = useState(false);
	const stageRef = useRef<HTMLDivElement>(null);
	if (!voice.channelId) return null;

	const channel = state.channels.find((c) => c.id === voice.channelId);
	const me: VoiceParticipant = {
		id: state.me.id,
		name: state.me.name,
		color: state.me.avatarColor,
		avatarUrl: state.me.avatarUrl,
		muted: voice.muted,
		deafened: voice.deafened,
		sharing: voice.sharing,
	};
	const connected = state.voiceMembers[voice.channelId] ?? [];
	const roster = connected.some((p) => p.id === state.me.id) ? connected : [...connected, me];

	function videoFor(id: string): MediaStream | null {
		// Si la persona ya no está compartiendo (según su presencia), no hay video.
		const participant = roster.find((p) => p.id === id);
		if (id !== state.me.id && participant && !participant.sharing) return null;
		const stream = id === state.me.id ? localScreen : remotes.find((remote) => remote.peerId === id)?.video ?? null;
		if (!stream) return null;
		// Solo si la pista sigue viva (evita el recuadro negro cuando deja de compartir).
		const track = stream.getVideoTracks()[0];
		return track && track.readyState === 'live' ? stream : null;
	}
	function stateFor(id: string): string {
		if (id === state.me.id) return 'connected';
		return meshStates[id] ?? 'new';
	}

	const expanded = expandedId ? roster.find((p) => p.id === expandedId) ?? null : null;
	const menuParticipant = menu ? roster.find((p) => p.id === menu.id) ?? null : null;
	// El volumen de quien comparte solo se controla si es otra persona.
	const presenter = expanded && expanded.id !== state.me.id ? {id: expanded.id, name: expanded.name} : null;

	function toggleFullscreen(): void {
		const element = stageRef.current ?? document.documentElement;
		if (document.fullscreenElement) void document.exitFullscreen();
		else void element.requestFullscreen();
	}

	const columnCount = roster.length <= 1 ? 1 : roster.length <= 4 ? 2 : roster.length <= 9 ? 3 : 4;

	return (
		<main className="call-stage" data-flx="call-stage" ref={stageRef}>
			<header className="call-stage-header">
				<div className="call-stage-title">
					<Icon name="speaker" size={18} />
					<span>{channel?.name ?? 'Voz'}</span>
					{expanded ? (
						<span className="call-stage-sub">
							Compartiendo: {expanded.id === state.me.id ? `${expanded.name} (vos)` : expanded.name}
						</span>
					) : (
						<span className="call-stage-sub">{roster.length} conectados</span>
					)}
					<span className="call-stage-timer">{elapsed}</span>
				</div>
				<div className="call-stage-header-tools">
					{expanded ? <IconButton icon="grid" label="Volver a la grilla" onClick={() => setExpandedId(null)} /> : null}
					{expanded ? (
						<IconButton
							icon={hideStrip ? 'eyeOff' : 'eye'}
							label={hideStrip ? 'Mostrar participantes' : 'Ocultar participantes'}
							active={hideStrip}
							onClick={() => setHideStrip((value) => !value)}
						/>
					) : null}
					<div className="call-sound-wrap">
						<IconButton icon="speaker" label="Controles de sonido" active={showVolume} onClick={() => setShowVolume((value) => !value)} />
						{showVolume ? (
							<>
								<div className="call-sound-backdrop" onClick={() => setShowVolume(false)} />
								<VolumeMenu presenter={presenter} />
							</>
						) : null}
					</div>
					<IconButton icon="chat" label="Volver al chat" onClick={() => dispatch({type: 'minimizeVoice'})} />
					<IconButton icon="maximize" label="Pantalla completa" onClick={toggleFullscreen} />
				</div>
			</header>

			<div className="call-stage-body">
				{expanded ? (
					<div className="call-expanded">
						<div className="call-presentation">
							{videoFor(expanded.id) ? (
								<VideoSurface stream={videoFor(expanded.id)!} />
							) : (
								<ColorAvatar name={expanded.name} color={expanded.color} url={expanded.avatarUrl} size={140} />
							)}
						</div>
						{hideStrip ? null : (
							<div className="call-strip">
								{roster.map((participant) => (
									<ParticipantCard
										key={participant.id}
										participant={participant}
										isMe={participant.id === state.me.id}
										video={videoFor(participant.id)}
										speaking={speakingIds.includes(participant.id)}
										state={stateFor(participant.id)}
										compact
										onExpand={() => setExpandedId(participant.id)}
										onMenu={(x, y) => setMenu({id: participant.id, x, y})}
									/>
								))}
							</div>
						)}
					</div>
				) : (
					<div className="call-grid" style={{gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`}}>
						{roster.map((participant) => (
							<ParticipantCard
								key={participant.id}
								participant={participant}
								isMe={participant.id === state.me.id}
								video={videoFor(participant.id)}
								speaking={speakingIds.includes(participant.id)}
								state={stateFor(participant.id)}
								compact={false}
								onExpand={() => setExpandedId(participant.id)}
								onMenu={(x, y) => setMenu({id: participant.id, x, y})}
							/>
						))}
					</div>
				)}
			</div>

			<footer className="call-stage-controls">
				<button
					type="button"
					className={`call-control${voice.muted ? ' is-active' : ''}`}
					title={voice.muted ? 'Activar micrófono' : 'Silenciar'}
					onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'muted'})}>
					<Icon name={voice.muted ? 'micOff' : 'mic'} size={22} />
				</button>
				<button
					type="button"
					className={`call-control${voice.video ? ' is-active' : ''}`}
					title="Cámara"
					onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'video'})}>
					<Icon name="video" size={22} />
				</button>
				<button
					type="button"
					className={`call-control${voice.sharing ? ' is-active' : ''}`}
					title="Compartir pantalla"
					onClick={() => {
						if (voice.sharing) dispatch({type: 'toggleVoiceFlag', flag: 'sharing'});
						else openSharePicker();
					}}>
					<Icon name="screenShare" size={22} />
				</button>
				<button
					type="button"
					className={`call-control${voice.deafened ? ' is-active' : ''}`}
					title={voice.deafened ? 'Activar audio' : 'Ensordecer'}
					onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'deafened'})}>
					<Icon name={voice.deafened ? 'headphonesOff' : 'headphones'} size={22} />
				</button>
				<button
					type="button"
					className="call-control is-danger"
					title="Desconectar"
					onClick={() => dispatch({type: 'leaveVoice'})}>
					<Icon name="phoneOff" size={22} />
				</button>
			</footer>

			{menu && menuParticipant ? (
				<UserContextMenu
					user={{id: menuParticipant.id, name: menuParticipant.name, color: menuParticipant.color, avatarUrl: menuParticipant.avatarUrl}}
					x={menu.x}
					y={menu.y}
					canVolume={menu.id !== state.me.id}
					onClose={() => setMenu(null)}
					onViewProfile={() =>
						setProfile({id: menuParticipant.id, name: menuParticipant.name, color: menuParticipant.color, avatarUrl: menuParticipant.avatarUrl})
					}
				/>
			) : null}
			{profile ? <ProfilePopover user={profile} canVolume onClose={() => setProfile(null)} /> : null}
		</main>
	);
}
