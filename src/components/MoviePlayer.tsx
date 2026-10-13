import {useCallback, useEffect, useRef, useState} from 'react';
import {Loader2, Maximize, Pause, Play, RotateCcw, Volume2, VolumeX, X} from 'lucide-react';
import {type TmdbMovie} from '@/lib/desktop';

/**
 * El reproductor del video. Es NUESTRO: controles propios (play/pausa, barra, volumen, pantalla
 * completa) y el embed sólo aporta el video.
 *
 * Dos cosas importantes:
 *  - El video NO recibe clics (el puente le pone pointer-events: none). Así nunca se abre
 *    publicidad ni se sale de la película: los clics los recibe esta capa.
 *  - Los subtítulos se piden en español al abrir (el embed los tiene, hay que seleccionarlos).
 */

/** Lo mínimo que usamos del <webview> (así no dependemos de los tipos de Electron acá). */
interface MovieView extends HTMLElement {
	send(channel: string, ...args: unknown[]): void;
}

/** 7753 → "2:09:13" */
function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const rest = total % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
		: `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function MoviePlayer({
	movie,
	startAtSeconds = 0,
	onClose,
}: {
	movie: TmdbMovie;
	startAtSeconds?: number;
	onClose: () => void;
}): JSX.Element {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<MovieView | null>(null);
	const playerRef = useRef<HTMLDivElement | null>(null);
	const [loading, setLoading] = useState(true);
	/** El <webview> sólo acepta comandos después de su evento dom-ready (si no, tira error). */
	const [ready, setReady] = useState(false);
	const [error, setError] = useState('');
	const [paused, setPaused] = useState(true);
	const [position, setPosition] = useState(startAtSeconds);
	const [duration, setDuration] = useState(0);
	const [volume, setVolume] = useState(1);
	const [muted, setMuted] = useState(false);
	const [subsOk, setSubsOk] = useState<boolean | null>(null);

	/** Le manda un comando al reproductor de adentro (sólo cuando el <webview> ya está listo). */
	const send = useCallback(
		(command: string, args: unknown[] = []) => {
			const view = viewRef.current;
			// El <webview> sólo existe en Electron, y sólo acepta comandos después de dom-ready.
			if (!ready || !view || typeof view.send !== 'function') return;
			try {
				view.send('pelacord:movie-command', {command, args});
			} catch {
				// Si se adelantó, se ignora: los efectos se vuelven a aplicar solos cuando esté listo.
			}
		},
		[ready],
	);

	// El <webview> se crea una sola vez por película (cambiarle el src lo recargaría).
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const view = document.createElement('webview') as MovieView;
		const url =
			`https://cinesrc.st/embed/${movie.mediaType}/${movie.id}` +
			`?controls=false&color=%23e50914&autoplay=false&muted=false&continueprompt=false` +
			`&t=${Math.max(0, Math.floor(startAtSeconds))}`;
		view.setAttribute('src', url);
		view.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
		view.className = 'movie-webview';
		host.appendChild(view);
		viewRef.current = view;

		const onIpc = (event: Event) => {
			const detail = event as Event & {channel?: string; args?: unknown[]};
			const channel = detail.channel;
			const payload = (detail.args ?? [])[0] as Record<string, unknown> | undefined;
			if (!payload) return;
		if (channel === 'pelacord:movie-subtitles') {
				setSubsOk(Boolean(payload.ok));
				return;
			}
			const type = String(payload.type ?? '');
			if (payload.currentTime !== undefined && typeof payload.currentTime === 'number') setPosition(payload.currentTime);
			if (payload.duration !== undefined && typeof payload.duration === 'number' && payload.duration > 0) setDuration(payload.duration);
			if (type === 'cinesrc:play') setPaused(false);
			if (type === 'cinesrc:pause') setPaused(true);
			if (type === 'cinesrc:ready') setLoading(false);
			if (type === 'cinesrc:loadedmetadata') setLoading(false);
			if (type === 'cinesrc:error') {
				setLoading(false);
				setError('El reproductor no pudo cargar la película. Probá más tarde o con otra película.');
			}
		};
		const onReady = () => {
			setLoading(false);
			setReady(true);
			try {
				// Subtítulos en español, automático.
				view.send('pelacord:movie-subtitles-es');
			} catch {
				// si el puente todavía no está, no pasa nada
			}
		};
		view.addEventListener('ipc-message', onIpc);
		view.addEventListener('dom-ready', onReady);

		return () => {
			view.removeEventListener('ipc-message', onIpc);
			view.removeEventListener('dom-ready', onReady);
			try {
				view.remove();
			} catch {
				// ya estaba afuera
			}
			viewRef.current = null;
		};
		// startAtSeconds sólo cuenta al abrir: no se rearma el reproductor si cambia.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [movie.id, movie.mediaType]);

	// El volumen se aplica apenas el reproductor está listo.
	useEffect(() => {
		if (!ready) return;
		send('setVolume', [muted ? 0 : volume]);
	}, [muted, volume, ready, send]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
			if (event.code === 'Space') {
				event.preventDefault();
				send(paused ? 'play' : 'pause');
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose, paused, send]);

	async function fullscreen(): Promise<void> {
		try {
			await playerRef.current?.requestFullscreen();
		} catch {
			// si el navegador no deja, no pasa nada
		}
	}

	return (
		<div className="movie-overlay" ref={playerRef}>
			<header className="movie-top">
				<span className="movie-top-title">{movie.title}</span>
				{movie.year ? <span className="movie-top-year">{movie.year}</span> : null}
				<button type="button" className="movie-icon-button" title="Cerrar" onClick={onClose}>
					<X size={18} />
				</button>
			</header>

			{/* Acá adentro vive el video. Los clics NO llegan: los recibe esta capa. */}
			<div className="movie-stage" ref={hostRef} />

			{/* Esta capa tapa el video y recibe todos los clics (así no se abre publicidad). */}
			{!paused ? null : (
				<button
					type="button"
					className="movie-click-shield"
					title={loading ? 'Cargando…' : 'Reproducir'}
					onClick={() => send('play')}>
					{loading ? <Loader2 size={54} className="music-spin" /> : <Play size={64} />}
				</button>
			)}

			{error ? <p className="movie-error">{error}</p> : null}

			<footer className="movie-controls">
				<button
					type="button"
					className="movie-icon-button"
					title={paused ? 'Reproducir' : 'Pausar'}
					disabled={Boolean(error)}
					onClick={() => send(paused ? 'play' : 'pause')}>
					{paused ? <Play size={20} /> : <Pause size={20} />}
				</button>
				<button
					type="button"
					className="movie-icon-button"
					title="Volver al principio"
					disabled={Boolean(error)}
					onClick={() => {
						send('seek', [0]);
						setPosition(0);
					}}>
					<RotateCcw size={18} />
				</button>
				<span className="movie-time">{formatTime(position)}</span>
				<input
					className="movie-seek"
					type="range"
					min={0}
					max={Math.max(1, Math.floor(duration))}
					value={Math.min(Math.floor(position), Math.max(1, Math.floor(duration)))}
					onChange={(event) => {
						const value = Number(event.target.value);
						setPosition(value);
						send('seek', [value]);
					}}
				/>
				<span className="movie-time">{formatTime(duration)}</span>
				<button
					type="button"
					className="movie-icon-button"
					title={muted ? 'Activar sonido' : 'Silenciar'}
					onClick={() => {
						setMuted((value) => !value);
						send('setMuted', [!muted]);
					}}>
					{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
				</button>
				<input
					className="movie-volume"
					type="range"
					min={0}
					max={1}
					step={0.05}
					value={volume}
					title="Volumen"
					onChange={(event) => {
						const value = Number(event.target.value);
						setVolume(value);
						send('setVolume', [value]);
					}}
				/>
				<button type="button" className="movie-icon-button" title="Pantalla completa" onClick={() => void fullscreen()}>
					<Maximize size={18} />
				</button>
			</footer>

			{subsOk === false ? <p className="movie-hint">No se pudieron activar los subtítulos en español; probá desde el menú del reproductor.</p> : null}
		</div>
	);
}
