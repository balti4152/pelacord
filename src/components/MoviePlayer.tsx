import {useCallback, useEffect, useRef, useState} from 'react';
import {Loader2, Maximize, Pause, Play, RotateCcw, Users, Volume2, VolumeX, X} from 'lucide-react';
import {getDesktopTransport} from '@/lib/desktop';
import {MOVIE_DRIFT_TOLERANCE_MS, type MovieRoomCommand, positionOf} from '@/lib/movieRooms';
import {useStore} from '@/state/store';

/**
 * El reproductor de Pelaflix: el video lo pone el embed y los controles son nuestros.
 *
 * Dos cosas importantes:
 *  - El video NO recibe clics (el puente le apaga el `pointer-events`). Así nunca se abre
 *    publicidad: los clics los recibe nuestra capa.
 *  - Está SINCRONIZADO por la malla: el host marca el tiempo y los demás siguen. Si alguien se
 *    desvía más de 2 segundos, se lo corrige.
 */

/** Lo mínimo que usamos del <webview> (así no dependemos de los tipos de Electron acá). */
interface MovieView extends HTMLElement {
	send(channel: string, ...args: unknown[]): void;
	getWebContentsId(): number;
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

export function MoviePlayer(): JSX.Element | null {
	const {state, myJoinedMovieRoom, movieCommand, movieHostSync, movieLeave, movieRoomViewers} = useStore();
	const room = myJoinedMovieRoom;
	const isHost = Boolean(room && room.hostId === state.me.id);
	const media = room?.media ?? null;

	const hostRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<MovieView | null>(null);
	const playerRef = useRef<HTMLDivElement | null>(null);
	const [loading, setLoading] = useState(true);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState('');
	const [paused, setPaused] = useState(true);
	const [position, setPosition] = useState(0);
	const [duration, setDuration] = useState(0);
	const [volume, setVolume] = useState(1);
	const [muted, setMuted] = useState(false);
	const [subsOk, setSubsOk] = useState<boolean | null>(null);
	/** Para que el host pueda leer su posición real sin depender del render. */
	const positionRef = useRef(0);
	positionRef.current = position;
	const pausedRef = useRef(true);
	pausedRef.current = paused;

	/** Le manda un comando al reproductor de adentro (sólo cuando el <webview> ya está listo). */
	const send = useCallback(
		(command: string, args: unknown[] = []) => {
			const view = viewRef.current;
			if (!ready || !view || typeof view.send !== 'function') return;
			try {
				view.send('pelacord:movie-command', {command, args});
			} catch {
				// Si se adelantó, se ignora: los efectos se vuelven a aplicar solos.
			}
		},
		[ready],
	);

	/** Una acción del usuario: se aplica acá (respuesta inmediata) y se manda a la sala. */
	const act = useCallback(
		(command: MovieRoomCommand) => {
			if (command.kind === 'play') send('play');
			else if (command.kind === 'pause') send('pause');
			else if (command.kind === 'seek') send('seek', [Math.round(command.positionMs / 1000)]);
			movieCommand(command);
			// El host, después de mover algo, manda su posición real para que todos queden iguales.
			if (isHost) {
				setTimeout(() => movieHostSync(positionRef.current, pausedRef.current), 400);
			}
		},
		[isHost, movieCommand, movieHostSync, send],
	);

	// El <webview> se crea una sola vez por película (cambiarle el src lo recargaría).
	useEffect(() => {
		const host = hostRef.current;
		if (!host || !media || !room) return;
		setLoading(true);
		setError('');
		setSubsOk(null);
		const startSeconds = Math.max(0, Math.floor(positionOf(room) / 1000));
		setPosition(startSeconds);
		const view = document.createElement('webview') as MovieView;
		const url =
			`https://cinesrc.st/embed/${media.mediaType}/${media.tmdbId}` +
			// controls=true es necesario para que exista el botón de subtítulos (el puente esconde su
			// barra con CSS, así que no se ve nada de su interfaz).
			`?controls=true&color=%23e50914&autoplay=false&muted=false&continueprompt=false` +
			`&t=${startSeconds}`;
		view.setAttribute('src', url);
		view.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
		view.className = 'movie-webview';
		host.appendChild(view);
		viewRef.current = view;

		const onIpc = (event: Event) => {
			const detail = event as Event & {channel?: string; args?: unknown[]};
			const payload = (detail.args ?? [])[0] as Record<string, unknown> | undefined;
			if (!payload) return;
			const type = String(payload.type ?? '');
			if (typeof payload.currentTime === 'number') setPosition(payload.currentTime);
			if (typeof payload.duration === 'number' && payload.duration > 0) setDuration(payload.duration);
			if (type === 'cinesrc:play') setPaused(false);
			if (type === 'cinesrc:pause') setPaused(true);
			if (type === 'cinesrc:ready' || type === 'cinesrc:loadedmetadata') setLoading(false);
			if (type === 'cinesrc:error') {
				setLoading(false);
				setError('El reproductor no pudo cargar la película. Probá más tarde o con otra.');
			}
		};
		const onReady = () => {
			setLoading(false);
			setReady(true);
			// Subtítulos en español: los pone el proceso principal, porque el reproductor sólo acepta
			// clics de verdad.
			const viewId = typeof view.getWebContentsId === 'function' ? view.getWebContentsId() : 0;
			if (!viewId) return;
			void getDesktopTransport()
				?.movieSubtitles(viewId)
				.then((result) => setSubsOk(Boolean(result?.ok)))
				.catch(() => setSubsOk(false));
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
			setReady(false);
		};
		// Se rearma sólo si cambia la película.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [media?.tmdbId, media?.mediaType]);

	// Los que NO son host siguen al host: si se desviaron mucho, se corrigen.
	useEffect(() => {
		if (!room || isHost) return;
		const expected = positionOf(room);
		const drift = positionRef.current * 1000 - expected;
		if (room.paused !== pausedRef.current) {
			send(room.paused ? 'pause' : 'play');
			return;
		}
		if (Math.abs(drift) > MOVIE_DRIFT_TOLERANCE_MS) {
			send('seek', [Math.round(expected / 1000)]);
		}
	}, [isHost, room, room?.updatedAt, room?.paused, room?.positionMs, send]);

	// El host reafirma su posición cada 4 s (así el que entra tarde se sincroniza enseguida).
	useEffect(() => {
		if (!isHost) return;
		const timer = setInterval(() => movieHostSync(positionRef.current, pausedRef.current), 4000);
		return () => clearInterval(timer);
	}, [isHost, movieHostSync]);

	// El volumen se aplica apenas el reproductor está listo.
	useEffect(() => {
		if (!ready) return;
		send('setVolume', [muted ? 0 : volume]);
	}, [muted, volume, ready, send]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') movieLeave();
			if (event.code === 'Space') {
				event.preventDefault();
				act(paused ? {kind: 'play'} : {kind: 'pause'});
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [act, movieLeave, paused]);

	if (!room || !media) return null;

	const viewers = movieRoomViewers(room.id).length + (isHost ? 1 : 0);

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
				<span className={`movie-live${isHost ? ' is-host' : ''}`} />
				<span className="movie-top-title">{media.title}</span>
				{media.year ? <span className="movie-top-year">{media.year}</span> : null}
				{!isHost ? <span className="movie-top-badge">Siguiendo a {room.hostName}</span> : <span className="movie-top-badge is-host">La estás compartiendo</span>}
				<span className="movie-viewers" title={viewers === 1 ? 'Estás mirando solo' : `${viewers} mirando`}>
					<Users size={14} /> {viewers}
				</span>
				<button type="button" className="movie-icon-button" title="Salir" onClick={movieLeave}>
					<X size={18} />
				</button>
			</header>

			<div className="movie-stage" ref={hostRef}>
				{!paused ? null : (
					<button
						type="button"
						className="movie-click-shield"
						title={loading ? 'Cargando…' : 'Reproducir'}
						onClick={() => act({kind: 'play'})}>
						{loading ? <Loader2 size={54} className="music-spin" /> : <Play size={64} />}
					</button>
				)}
			</div>

			{error ? <p className="movie-error">{error}</p> : null}

			<footer className="movie-controls">
				<button
					type="button"
					className="movie-icon-button"
					title={paused ? 'Reproducir' : 'Pausar'}
					disabled={Boolean(error)}
					onClick={() => act(paused ? {kind: 'play'} : {kind: 'pause'})}>
					{paused ? <Play size={20} /> : <Pause size={20} />}
				</button>
				<button
					type="button"
					className="movie-icon-button"
					title="Volver al principio"
					disabled={Boolean(error)}
					onClick={() => act({kind: 'seek', positionMs: 0})}>
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
						const seconds = Number(event.target.value);
						setPosition(seconds);
						act({kind: 'seek', positionMs: seconds * 1000});
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

			{subsOk === false ? (
				<p className="movie-hint">No se pudieron activar los subtítulos en español; probá desde el menú del reproductor.</p>
			) : null}
		</div>
	);
}
