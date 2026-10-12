import {type ChangeEvent, type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState} from 'react';
import {EmojiChooser} from '@/components/EmojiChooser';
import {GifPicker} from '@/components/GifPicker';
import {Icon} from '@/components/primitives';
import {subscribeAttach} from '@/lib/attach';
import {getDesktopTransport} from '@/lib/desktop';
import {type GifResult} from '@/lib/giphy';
import {uid, useStore} from '@/state/store';
import type {Attachment} from '@/types';

function attachmentKind(file: File): Attachment['kind'] {
	const name = (file.name || '').toLowerCase();
	if (file.type.startsWith('image/')) return 'image';
	if (file.type.startsWith('video/')) return 'video';
	if (file.type.startsWith('audio/')) return 'audio';
	if (
		file.type.startsWith('text/') ||
		/\.(txt|md|markdown|json|log|csv|xml|yml|yaml|ini|cfg|conf|ts|tsx|js|jsx|css|html|sh|bat|ps1|py|rs|go|java|c|cpp|h)$/.test(
			name,
		)
	) {
		return 'text';
	}
	return 'file';
}

/** Miniatura del primer cuadro de un video (data URL), para previsualizar sin descargarlo. */
function videoThumbnail(file: File): Promise<string | undefined> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement('video');
		video.preload = 'metadata';
		video.muted = true;
		video.src = url;
		let done = false;
		const finish = (value?: string) => {
			if (done) return;
			done = true;
			URL.revokeObjectURL(url);
			resolve(value);
		};
		const timer = setTimeout(() => finish(undefined), 6000);
		video.onloadeddata = () => {
			try {
				video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
			} catch {
				finish(undefined);
			}
		};
		video.onseeked = () => {
			try {
				const width = video.videoWidth || 320;
				const height = video.videoHeight || 180;
				const scale = Math.min(1, 320 / width);
				const canvas = document.createElement('canvas');
				canvas.width = Math.max(1, Math.round(width * scale));
				canvas.height = Math.max(1, Math.round(height * scale));
				const context = canvas.getContext('2d');
				if (!context) return finish(undefined);
				context.drawImage(video, 0, 0, canvas.width, canvas.height);
				clearTimeout(timer);
				finish(canvas.toDataURL('image/jpeg', 0.7));
			} catch {
				finish(undefined);
			}
		};
		video.onerror = () => finish(undefined);
	});
}

/** Registra el archivo en el servidor P2P local; los demás lo descargan de tu máquina. */
async function buildAttachment(file: File, ownerId: string): Promise<Attachment> {
	const kind = attachmentKind(file);
	const mime = file.type || 'application/octet-stream';
	const name = file.name || 'archivo';
	const thumbnail = kind === 'video' ? await videoThumbnail(file) : undefined;
	const transport = getDesktopTransport();
	if (transport) {
		try {
			const endpoint = await transport.getFileEndpoint();
			const filePath = transport.getPathForFile(file);
			const id = filePath
				? await transport.shareFile({filePath, name, mime, size: file.size})
				: await transport.shareBuffer({name, mime, data: await file.arrayBuffer()});
			if (id) {
				return {
					id,
					name,
					size: file.size,
					mime,
					kind,
					url: `http://${endpoint.host}:${endpoint.port}/file/${id}`,
					ownerId,
					ownerHost: endpoint.host,
					ownerPort: endpoint.port,
					thumbnail,
				};
			}
		} catch {
			// cae al modo local
		}
	}
	return {id: uid(), name, size: file.size, mime, kind, url: URL.createObjectURL(file), ownerId, thumbnail};
}

export function Composer(): JSX.Element {
	const {sendMessage, state} = useStore();
	const [text, setText] = useState('');
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [showEmoji, setShowEmoji] = useState(false);
	const [showGifs, setShowGifs] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const textarea = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		return subscribeAttach((files) => {
			void Promise.all(files.map((file) => buildAttachment(file, state.me.id))).then((next) => {
				setAttachments((prev) => [...prev, ...next]);
			});
		});
	}, [state.me.id]);

	async function handleFiles(event: ChangeEvent<HTMLInputElement>): Promise<void> {
		const files = event.target.files;
		if (!files || files.length === 0) return;
		// Capturar la lista ANTES de limpiar el input (limpiar vacía la FileList).
		const list = Array.from(files);
		event.target.value = '';
		const next = await Promise.all(list.map((file) => buildAttachment(file, state.me.id)));
		setAttachments((prev) => [...prev, ...next]);
	}

	function submit(): void {
		if (!text.trim() && attachments.length === 0) return;
		sendMessage(text, attachments);
		setText('');
		setAttachments([]);
		setShowEmoji(false);
		if (textarea.current) {
			textarea.current.style.height = 'auto';
			textarea.current.focus();
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	}

	function handleInput(event: ChangeEvent<HTMLTextAreaElement>): void {
		setText(event.target.value);
		const el = event.target;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
	}

	/** Pegar imágenes (Ctrl+V) las adjunta directamente. */
	async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
		const files = event.clipboardData?.files;
		if (!files || files.length === 0) return;
		event.preventDefault();
		const list = Array.from(files);
		const next = await Promise.all(list.map((file) => buildAttachment(file, state.me.id)));
		setAttachments((prev) => [...prev, ...next]);
	}

	return (
		<div className="composer">
			{showGifs ? (
				<GifPicker
					onClose={() => setShowGifs(false)}
					onSelect={(gif: GifResult) => {
						setShowGifs(false);
						const attachment: Attachment = {
							id: uid(),
							name: gif.title || 'giphy.gif',
							size: 0,
							mime: 'image/gif',
							kind: 'image',
							url: gif.url,
						};
						sendMessage('', [attachment]);
					}}
				/>
			) : null}
			{showEmoji ? (
				<EmojiChooser
					onClose={() => setShowEmoji(false)}
					onSelect={(emoji: string) => {
						setText((prev) => prev + emoji);
						textarea.current?.focus();
					}}
				/>
			) : null}
			{attachments.length > 0 ? (
				<div className="composer-attachments">
					{attachments.map((attachment) => (
						<div className="composer-attachment" key={attachment.id}>
							{attachment.kind === 'image' ? (
								<img className="composer-attachment-thumb" src={attachment.url} alt="" />
							) : (
								<span className="composer-attachment-thumb" style={{display: 'grid', placeItems: 'center'}}>
									<Icon name="file" size={16} />
								</span>
							)}
							<span className="composer-attachment-name">{attachment.name}</span>
							<button
								type="button"
								className="composer-attachment-remove"
								title="Quitar"
								onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))}>
								×
							</button>
						</div>
					))}
				</div>
			) : null}

			<div className={`composer-box${attachments.length > 0 ? ' is-open' : ''}`}>
				<div className="composer-actions">
					<button
						type="button"
						className="composer-btn"
						title="Subir un archivo"
						onClick={() => fileInput.current?.click()}>
						<Icon name="attach" size={20} />
					</button>
					<input ref={fileInput} type="file" multiple hidden onChange={handleFiles} />
					<button type="button" className="composer-btn is-gif" title="GIF" onClick={() => setShowGifs((value) => !value)}>
						GIF
					</button>
					<button
						type="button"
						className="composer-btn"
						title="Emoji"
						onClick={() => setShowEmoji((value) => !value)}>
						<Icon name="emoji" size={20} />
					</button>
				</div>

				<textarea
					ref={textarea}
					className="composer-input"
					placeholder="Escribe un mensaje"
					rows={1}
					value={text}
					onChange={handleInput}
					onKeyDown={handleKeyDown}
					onPaste={handlePaste}
				/>

				<div className="composer-actions">
					<button
						type="button"
						className="composer-btn is-send"
						title="Enviar"
						onClick={submit}
						disabled={!text.trim() && attachments.length === 0}>
						<Icon name="send" size={20} />
					</button>
				</div>
			</div>
		</div>
	);
}
