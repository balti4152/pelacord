import {type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState} from 'react';
import {Composer} from '@/components/Composer';
import {Avatar, formatBytes, Icon, IconButton} from '@/components/primitives';
import {getDesktopTransport} from '@/lib/desktop';
import {resolveMember, splitMentions, useStore} from '@/state/store';
import {findMediaLinks, stripMediaUrls, type MediaLink} from '@/lib/mediaLinks';
import type {AppState, Attachment, Message} from '@/types';

const FALLBACK_COLOR = 'hsl(0, 0%, 40%)';

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function formatDay(ts: number): string {
	return new Date(ts).toLocaleDateString([], {month: 'long', day: 'numeric', year: 'numeric'});
}

/** Resolves the author of a message, falling back to the name/color embedded in the message. */
function authorFor(state: AppState, message: Message): {member: ReturnType<typeof resolveMember>; isMe: boolean} {
	if (message.authorId === state.me.id) return {member: state.me, isMe: true};
	const found = state.members.find((m) => m.id === message.authorId);
	if (found) return {member: found, isMe: false};
	return {
		member: {
			id: message.authorId,
			name: message.authorName || 'Desconocido',
			tag: '0000',
			presence: 'offline',
			avatarColor: message.authorColor || FALLBACK_COLOR,
			accentColor: 'hsl(242, 70%, 55%)',
		},
		isMe: false,
	};
}

function VideoAttachment({attachment, url, onFailed}: {attachment: Attachment; url: string; onFailed: () => void}): JSX.Element {
	const [src, setSrc] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function play(): Promise<void> {
		const transport = getDesktopTransport();
		if (!transport) {
			setSrc(url);
			return;
		}
		setLoading(true);
		const result = await transport.cacheMedia({url, name: attachment.name});
		setLoading(false);
		if (result.ok && result.name) setSrc(`pelacord-media://local/${encodeURIComponent(result.name)}`);
		else onFailed();
	}

	if (src) {
		return <video className="attachment-video" src={src} controls autoPlay onError={onFailed} />;
	}
	return (
		<button type="button" className="attachment-video-poster" onClick={() => void play()} disabled={loading}>
			{attachment.thumbnail ? (
				<img src={attachment.thumbnail} alt={attachment.name} />
			) : (
				<span className="attachment-video-blank" />
			)}
			<span className="attachment-video-play">{loading ? 'Cargando…' : <Icon name="video" size={28} />}</span>
			<span className="attachment-video-name">{attachment.name}</span>
		</button>
	);
}

function formatSpeed(bytesPerSecond: number): string {
	if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
	if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
	return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

/** Resalta todas las apariciones del término buscado. */
function highlightTerm(content: string, term: string): ReactNode {
	if (!term) return content;
	const index = content.toLowerCase().indexOf(term);
	if (index === -1) return content;
	return (
		<>
			{content.slice(0, index)}
			<mark className="search-hit">{content.slice(index, index + term.length)}</mark>
			{highlightTerm(content.slice(index + term.length), term)}
		</>
	);
}

/**
 * Audio: se reproduce en línea, sin descargarlo antes. El servidor P2P del dueño
 * responde a los pedidos por rango, así que la barra de progreso y "adelantar" funcionan.
 */
/**
 * ¿El mensaje es sólo emojis (menos de 3)? Entonces se muestran grandes, como en WhatsApp.
 * Con 3 o más vuelven al tamaño normal.
 */
function isJumboEmojis(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || /[0-9A-Za-z]/.test(trimmed)) return false;
	const segments = Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(trimmed));
	if (segments.length === 0 || segments.length >= 3) return false;
	return segments.every(
		(part) =>
			/\p{Extended_Pictographic}/u.test(part.segment) ||
			// Banderas: son dos "regional indicators" y no cuentan como pictográficos.
			/[\u{1F1E6}-\u{1F1FF}]/u.test(part.segment) ||
			/^\s+$/.test(part.segment),
	);
}

/** "1:05" a partir de segundos. */function formatClock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60);
	return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Tarjeta de audio con reproductor propio (nada del `<audio controls>` de Chrome).
 * Se usa para los adjuntos de audio y también para los links directos a un audio.
 */
function AudioCard({src, name, onError}: {src: string; name: string; onError?: () => void}): JSX.Element {
	const audioRef = useRef<HTMLAudioElement>(null);
	const [playing, setPlaying] = useState(false);
	const [current, setCurrent] = useState(0);
	const [duration, setDuration] = useState(0);

	function toggle(): void {
		const audio = audioRef.current;
		if (!audio) return;
		if (audio.paused) void audio.play().catch(() => {});
		else audio.pause();
	}

	/** Click en la barra: salta a esa parte. */
	function seek(event: ReactMouseEvent<HTMLDivElement>): void {
		const audio = audioRef.current;
		if (!audio || !duration) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
		audio.currentTime = ratio * duration;
		setCurrent(audio.currentTime);
	}

	const percent = duration > 0 ? (current / duration) * 100 : 0;

	return (
		<div className="audio-card">
			<audio
				ref={audioRef}
				src={src}
				preload="metadata"
				onError={onError}
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => {
					setPlaying(false);
					setCurrent(0);
				}}
				onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
				onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
			/>
			<button type="button" className="audio-card-play" onClick={toggle} title={playing ? 'Pausar' : 'Reproducir'}>
				<Icon name={playing ? 'pause' : 'play'} size={18} />
			</button>
			<div className="audio-card-body">
				<span className="audio-card-name" title={name}>
					{name}
				</span>
				<div className="audio-card-track" onClick={seek} role="presentation">
					<div className="audio-card-progress" style={{width: `${percent}%`}} />
				</div>
				<span className="audio-card-time">
					{formatClock(current)} / {formatClock(duration)}
				</span>
			</div>
		</div>
	);
}

function AudioAttachment({
	attachment,
	url,
	onFailed,
}: {
	attachment: Attachment;
	url: string;
	onFailed: () => void;
}): JSX.Element {
	return <AudioCard src={url} name={attachment.name} onError={onFailed} />;
}

/**
 * Links del texto que apuntan directo a una imagen, un video o un audio: se muestran como media
 * en vez de dejar sólo el link.
 */
function MediaLinks({links}: {links: MediaLink[]}): JSX.Element | null {
	if (links.length === 0) return null;
	return (
		<div className="media-links">
			{links.map((link) =>
				link.kind === 'image' ? (
					<a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="media-link-image">
						<img src={link.url} alt={link.name} loading="lazy" />
					</a>
				) : link.kind === 'video' ? (
					<video key={link.url} className="media-link-video" src={link.url} controls preload="metadata" />
				) : (
					<AudioCard key={link.url} src={link.url} name={link.name} />
				),
			)}
		</div>
	);
}

function AttachmentView({attachment}: {attachment: Attachment}): JSX.Element {
	const [status, setStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');
	const [progress, setProgress] = useState({received: 0, total: attachment.size});
	const [speed, setSpeed] = useState(0);
	const [downloadId, setDownloadId] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [zoom, setZoom] = useState(false);
	const [text, setText] = useState<string | null>(null);
	const [textFailed, setTextFailed] = useState(false);
	const [copiado, setCopiado] = useState(false);
	const url =
		attachment.ownerHost && attachment.ownerPort
			? `http://${attachment.ownerHost}:${attachment.ownerPort}/file/${attachment.id}`
			: attachment.url;

	useEffect(() => {
		if (attachment.kind !== 'text' || !url) return;
		let active = true;
		fetch(url, {headers: {Range: 'bytes=0-40000'}})
			.then((response) => response.text())
			.then((value) => {
				if (active) setText(value.slice(0, 40000));
			})
			.catch(() => {
				if (active) setTextFailed(true);
			});
		return () => {
			active = false;
		};
	}, [attachment.kind, url]);

	async function download(): Promise<void> {
		const transport = getDesktopTransport();
		if (!transport) {
			if (url) window.open(url, '_blank');
			return;
		}
		setStatus('downloading');
		setSpeed(0);
		const off = transport.onDownloadProgress((message) => {
			if (message.name !== attachment.name) return;
			if (message.cancelled) {
				setStatus('idle');
				setSpeed(0);
				off();
				return;
			}
			if (message.error) {
				setStatus('error');
				off();
				return;
			}
			setDownloadId(message.id);
			setProgress({received: message.received ?? 0, total: message.total || attachment.size});
			if (typeof message.speed === 'number') setSpeed(message.speed);
			if (message.done) {
				setStatus('done');
				setSpeed(0);
				off();
			}
		});
		const result = await transport.downloadFile({url, name: attachment.name, size: attachment.size});
		off();
		if (result.cancelled) setStatus('idle');
		else setStatus(result.ok ? 'done' : 'error');
	}

	async function cancel(): Promise<void> {
		if (downloadId) await getDesktopTransport()?.cancelDownload(downloadId);
	}

	// Vista previa en línea de imágenes (también pegadas): se transmiten desde el servidor del dueño.
	if (attachment.kind === 'image' && url && !failed) {
		return (
			<>
				<div className="attachment-image">
					<img src={url} alt={attachment.name} onClick={() => setZoom(true)} onError={() => setFailed(true)} />
				</div>
				{zoom ? (
					<div className="lightbox" onClick={() => setZoom(false)}>
						<img src={url} alt="" />
					</div>
				) : null}
			</>
		);
	}

	// Video: se muestra solo la miniatura; al dar play se descarga temporalmente y se reproduce.
	if (attachment.kind === 'video' && url && !failed) {
		return <VideoAttachment attachment={attachment} url={url} onFailed={() => setFailed(true)} />;
	}

	// Audio: reproductor en línea, igual que Discord.
	if (attachment.kind === 'audio' && url && !failed) {
		return <AudioAttachment attachment={attachment} url={url} onFailed={() => setFailed(true)} />;
	}

	// Previsualización de texto plano: en una caja tipo código, con copiar y descargar.
	if (attachment.kind === 'text' && url && !textFailed) {
		return (
			<div className="code-card">
				<div className="code-card-head">
					<span className="code-card-name" title={attachment.name}>
						{attachment.name}
					</span>
					<div className="code-card-actions">
						<button
							type="button"
							className="button secondary"
							onClick={() => {
								void navigator.clipboard.writeText(text ?? '');
								setCopiado(true);
								window.setTimeout(() => setCopiado(false), 1500);
							}}>
							{copiado ? '¡Copiado!' : 'Copiar'}
						</button>
						<button type="button" className="button secondary" onClick={() => void download()}>
							Descargar .txt
						</button>
					</div>
				</div>
				<pre className="code-card-body">{text ?? 'Cargando…'}</pre>
			</div>
		);
	}

	const percent = progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : 0;
	return (
		<div className="attachment-file">
			<span className="attachment-file-icon">
				<Icon name="file" size={20} />
			</span>
			<span className="attachment-file-info">
				<span className="attachment-file-name">{attachment.name}</span>
				<span className="attachment-file-size">
					{formatBytes(attachment.size)}
					{status === 'downloading'
						? ` · ${percent}%${speed > 0 ? ` · ${formatSpeed(speed)}` : ''}`
						: status === 'done'
							? ' · descargado'
							: status === 'error'
								? ' · se cortó, podés reanudar'
								: ''}
				</span>
			</span>
			{status === 'downloading' ? (
				<button type="button" className="button danger" onClick={() => void cancel()}>
					Cancelar
				</button>
			) : (
				<button type="button" className="button secondary" onClick={() => void download()}>
					{status === 'done' ? 'Descargado' : status === 'error' ? 'Reanudar' : 'Descargar'}
				</button>
			)}
		</div>
	);
}

export function ChatView(): JSX.Element {
	const {state, dispatch, updateSettings, editMessage, removeMessage} = useStore();
	const channel = state.channels.find((c) => c.id === state.activeChannelId);
	const messages = state.messages[state.activeChannelId] ?? [];
	const mentionNames = state.members.map((member) => member.name);
	const muted = state.mutedChannels.includes(state.activeChannelId);
	const [menu, setMenu] = useState<{message: Message; isMe: boolean; x: number; y: number} | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [search, setSearch] = useState<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const searching = search !== null;
	const term = (search ?? '').trim().toLowerCase();
	// Con búsqueda activa se muestran sólo los mensajes que coinciden.
	const visible = term ? messages.filter((message) => (message.content ?? '').toLowerCase().includes(term)) : messages;

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages.length, state.activeChannelId]);

	useEffect(() => {
		if (!menu) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setMenu(null);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [menu]);

	if (!channel) {
		return (
			<div className="chat">
				<div className="chat-header">
					<span className="chat-header-title">Sin canal</span>
				</div>
			</div>
		);
	}

	let lastAuthorId = '';
	let lastTimestamp = 0;
	const rendered: JSX.Element[] = [];

	for (const message of visible) {
		const {member, isMe} = authorFor(state, message);
		const grouped = message.authorId === lastAuthorId && message.createdAt - lastTimestamp < 5 * 60 * 1000;
		const compact = state.settings.messageDisplay === 'compact';
		lastAuthorId = message.authorId;
		lastTimestamp = message.createdAt;
		rendered.push(
			<MessageRow
				key={message.id}
				message={message}
				member={member}
				isMe={isMe}
				grouped={grouped && !compact}
				compact={compact}
				editing={editingId === message.id}
				mentionNames={mentionNames}
				searchTerm={term}
				onMenu={(x, y) => setMenu({message, isMe, x, y})}
				onSaveEdit={(content) => {
					if (content.trim() && content !== message.content) editMessage(message.id, content);
					setEditingId(null);
				}}
				onCancelEdit={() => setEditingId(null)}
			/>,
		);
	}

	return (
		<main className="chat">
			<header className="chat-header">
				<div className="chat-header-title">
					<Icon name="hash" size={20} />
					<span>{channel.name}</span>
					{channel.topic ? <span className="chat-header-topic">{channel.topic}</span> : null}
				</div>
				<div className="chat-header-tools">
					{searching ? (
						<>
							<input
								className="input chat-search-input"
								autoFocus
								placeholder="Buscar en el canal…"
								value={search ?? ''}
								onChange={(event) => setSearch(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Escape') setSearch(null);
								}}
							/>
							<span className="chat-search-count">
								{term ? `${visible.length} ${visible.length === 1 ? 'resultado' : 'resultados'}` : 'Escribí para buscar'}
							</span>
							<IconButton icon="x" label="Cerrar búsqueda" onClick={() => setSearch(null)} />
						</>
					) : (
						<>
							<IconButton
								icon={muted ? 'bellOff' : 'bell'}
								label={muted ? 'Activar las notificaciones del canal' : 'Silenciar el canal'}
								active={muted}
								onClick={() => dispatch({type: 'toggleChannelMute', channelId: state.activeChannelId})}
							/>
							<IconButton
								icon="members"
								label="Mostrar lista de miembros"
								active={state.settings.showMembers}
								onClick={() => updateSettings({showMembers: !state.settings.showMembers})}
							/>
							<IconButton icon="search" label="Buscar en el canal" onClick={() => setSearch('')} />
							<IconButton icon="inbox" label="Bandeja de entrada" />
							<IconButton icon="help" label="Ayuda" />
						</>
					)}
				</div>
			</header>

			<div className="chat-body" ref={scrollRef}>
				<div className="chat-intro">
					<div className="chat-intro-icon">
						<Icon name="hash" size={40} />
					</div>
					<h2>¡Bienvenido a #{channel.name}!</h2>
					<p>{channel.topic ?? `Este es el comienzo del canal #${channel.name}.`}</p>
				</div>
				<div className="divider">{formatDay(messages[0]?.createdAt ?? Date.now())}</div>
				<div className="messages">{rendered}</div>
			</div>

			<Composer />

			{menu ? (
				<MessageMenu
					message={menu.message}
					isMe={menu.isMe}
					x={menu.x}
					y={menu.y}
					onClose={() => setMenu(null)}
					onEdit={() => setEditingId(menu.message.id)}
					onDelete={() => removeMessage(menu.message.id)}
				/>
			) : null}
		</main>
	);
}

function MessageMenu({
	message,
	isMe,
	x,
	y,
	onClose,
	onEdit,
	onDelete,
}: {
	message: Message;
	isMe: boolean;
	x: number;
	y: number;
	onClose: () => void;
	onEdit: () => void;
	onDelete: () => void;
}): JSX.Element {
	const [confirmDelete, setConfirmDelete] = useState(false);
	const left = Math.min(x, Math.max(0, window.innerWidth - 240));
	const top = Math.min(y, Math.max(0, window.innerHeight - 220));
	return (
		<>
			<div
				className="call-menu-backdrop"
				onClick={onClose}
				onContextMenu={(event) => {
					event.preventDefault();
					onClose();
				}}
			/>
			<div className="call-menu" style={{left, top}} onClick={(event) => event.stopPropagation()}>
				<button
					type="button"
					className="call-menu-item"
					onClick={() => {
						void navigator.clipboard.writeText(message.content);
						onClose();
					}}>
					<span>Copiar texto</span>
				</button>
				<button
					type="button"
					className="call-menu-item"
					onClick={() => {
						void navigator.clipboard.writeText(message.id);
						onClose();
					}}>
					<span>Copiar ID</span>
				</button>
				{isMe ? (
					<>
						<div className="call-menu-divider" />
						<button
							type="button"
							className="call-menu-item"
							onClick={() => {
								onEdit();
								onClose();
							}}>
							<span>Editar mensaje</span>
						</button>
						<button
							type="button"
							className={`call-menu-item${confirmDelete ? ' is-danger' : ''}`}
							onClick={() => {
								if (confirmDelete) {
									onDelete();
									onClose();
								} else {
									setConfirmDelete(true);
								}
							}}>
							<span>{confirmDelete ? 'Confirmar eliminar' : 'Eliminar mensaje'}</span>
						</button>
					</>
				) : null}
			</div>
		</>
	);
}

function MessageRow({
	message,
	member,
	isMe,
	grouped,
	compact,
	editing,
	mentionNames,
	searchTerm,
	onMenu,
	onSaveEdit,
	onCancelEdit,
}: {
	message: Message;
	member: ReturnType<typeof resolveMember>;
	isMe: boolean;
	grouped: boolean;
	compact: boolean;
	editing: boolean;
	mentionNames: string[];
	searchTerm?: string;
	onMenu: (x: number, y: number) => void;
	onSaveEdit: (content: string) => void;
	onCancelEdit: () => void;
}): JSX.Element {
	const [draft, setDraft] = useState(message.content);
	useEffect(() => {
		if (editing) setDraft(message.content);
	}, [editing, message.content]);

	const classes = ['message'];
	if (grouped) classes.push('is-grouped');
	if (compact) classes.push('is-compact', 'is-grouped');
	// Los links que se muestran como media se sacan del texto (no se ven dos veces).
	const mediaLinks = message.content ? findMediaLinks(message.content) : [];
	const visibleContent = stripMediaUrls(message.content ?? '', mediaLinks);
	return (
		<div
			className={classes.join(' ')}
			onContextMenu={(event) => {
				event.preventDefault();
				onMenu(event.clientX, event.clientY);
			}}>
			{grouped || compact ? (
				<>
					<span className="message-grouped-timestamp">{formatTime(message.createdAt)}</span>
					<div className="message-avatar-spacer" />
				</>
			) : (
				<div className="message-avatar">
					<Avatar member={member} size={40} />
				</div>
			)}
			<div className="message-body">
				{grouped || compact ? null : (
					<div className="message-meta">
						<span className={`message-author${isMe ? ' is-op' : ''}`}>{member.name}</span>
						{member.isBot ? (
							<span
								style={{
									padding: '0 0.25rem',
									borderRadius: '3px',
									backgroundColor: 'var(--brand-primary)',
									color: 'var(--text-on-brand-primary)',
									fontSize: '0.625rem',
									fontWeight: 600,
								}}>
								BOT
							</span>
						) : null}
						<span className="message-timestamp">
							{formatDay(message.createdAt) === formatDay(Date.now()) ? 'Hoy' : formatDay(message.createdAt)} a las{' '}
							{formatTime(message.createdAt)}
							{message.edited ? ' (editado)' : ''}
						</span>
					</div>
				)}
				{editing ? (
					<div className="message-edit">
						<textarea
							className="textarea plain"
							value={draft}
							autoFocus
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && !event.shiftKey) {
									event.preventDefault();
									onSaveEdit(draft);
								}
								if (event.key === 'Escape') onCancelEdit();
							}}
						/>
						<div className="message-edit-actions">
							<button type="button" className="button secondary" onClick={onCancelEdit}>
								Cancelar
							</button>
							<button type="button" className="button primary" onClick={() => onSaveEdit(draft)}>
								Guardar
							</button>
						</div>
					</div>
				) : visibleContent ? (
					<div className={`message-content${isJumboEmojis(visibleContent) ? ' is-jumbo' : ''}`}>
						{searchTerm
							? highlightTerm(visibleContent, searchTerm)
							: splitMentions(visibleContent, mentionNames).map((part, index) =>
									part.mention ? (
										<span className="mention" key={index}>
											{part.text}
										</span>
									) : (
										<span key={index}>{part.text}</span>
									),
								)}
					</div>
				) : null}
				<MediaLinks links={mediaLinks} />
				{message.attachments.length > 0 ? (
					<div className="attachments">
						{message.attachments.map((attachment) => (
							<AttachmentView key={attachment.id} attachment={attachment} />
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}
