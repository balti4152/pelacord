import {useEffect, useRef, useState} from 'react';
import {Composer} from '@/components/Composer';
import {Avatar, formatBytes, Icon, IconButton} from '@/components/primitives';
import {getDesktopTransport} from '@/lib/desktop';
import {resolveMember, useStore} from '@/state/store';
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

/**
 * Audio: se reproduce en línea, sin descargarlo antes. El servidor P2P del dueño
 * responde a los pedidos por rango, así que la barra de progreso y "adelantar" funcionan.
 */
function AudioAttachment({
	attachment,
	url,
	onFailed,
}: {
	attachment: Attachment;
	url: string;
	onFailed: () => void;
}): JSX.Element {
	return (
		<div className="attachment-audio">
			<span className="attachment-audio-icon">
				<Icon name="music" size={18} />
			</span>
			<div className="attachment-audio-body">
				<span className="attachment-audio-name" title={attachment.name}>
					{attachment.name}
				</span>
				<audio className="attachment-audio-player" src={url} controls preload="metadata" onError={onFailed} />
			</div>
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

	// Previsualización de texto plano.
	if (attachment.kind === 'text' && url && !textFailed) {
		return (
			<div className="attachment-text-wrap">
				<div className="attachment-text-head">{attachment.name}</div>
				<pre className="attachment-text">{text ?? 'Cargando…'}</pre>
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
	const {state, updateSettings, editMessage, removeMessage} = useStore();
	const channel = state.channels.find((c) => c.id === state.activeChannelId);
	const messages = state.messages[state.activeChannelId] ?? [];
	const [menu, setMenu] = useState<{message: Message; isMe: boolean; x: number; y: number} | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

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

	for (const message of messages) {
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
					<IconButton icon="bell" label="Notificaciones" />
					<IconButton
						icon="members"
						label="Mostrar lista de miembros"
						active={state.settings.showMembers}
						onClick={() => updateSettings({showMembers: !state.settings.showMembers})}
					/>
					<IconButton icon="search" label="Buscar" />
					<IconButton icon="inbox" label="Bandeja de entrada" />
					<IconButton icon="help" label="Ayuda" />
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
				) : message.content ? (
					<div className="message-content">{message.content}</div>
				) : null}
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
