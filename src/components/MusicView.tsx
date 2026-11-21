import {type CSSProperties, useEffect, useRef, useState} from 'react';
import {GripVertical, ListMusic, Loader2, Pause, Play, Plus, Search, SkipForward, Trash2, TriangleAlert, Volume2, VolumeX, X} from 'lucide-react';
import {SiSpotify} from 'react-icons/si';
import {type SpotifyPlaylist, type TrackResult, getDesktopTransport} from '@/lib/desktop';
import {currentPositionMs, type MusicState, type MusicTrack} from '@/lib/musicQueue';
import {useSpotifyImport} from '@/lib/spotifyImport';
import {SPOTIFY_GREEN, SpotifyView} from '@/components/SpotifyView';
import {SpotifyPlaylistDetail} from '@/components/SpotifyPlaylistDetail';
import {useStore} from '@/state/store';

/** Convierte un resultado de búsqueda en un tema de la cola. */
function toMusicTrack(track: TrackResult, addedBy: string): MusicTrack {
	return {
		id: track.id,
		title: track.title,
		duration: track.duration,
		thumbnail: track.thumbnail,
		author: track.author,
		url: track.url,
		addedBy,
	};
}

/** "3:45" */
function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
	const total = Math.floor(seconds);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Búsquedas de esta sesión: volver a una búsqueda (o borrar una letra y volver) es instantáneo. */
const searchMemory = new Map<string, TrackResult[]>();
function rememberSearch(key: string, results: TrackResult[]): void {
	searchMemory.delete(key);
	searchMemory.set(key, results);
	while (searchMemory.size > 40) searchMemory.delete(searchMemory.keys().next().value as string);
}

/**
 * Barra de progreso del tema que suena. Va aparte (con su propio reloj) para que el avance de la
 * barra no re-renderice toda la vista de Música cada medio segundo.
 */
function MusicProgress({state}: {state: MusicState}): JSX.Element | null {
	const [, tick] = useState(0);
	const paused = Boolean(state.pausedAt);
	useEffect(() => {
		if (paused || !state.track) return;
		const timer = setInterval(() => tick((value) => value + 1), 500);
		return () => clearInterval(timer);
	}, [paused, state.track]);
	if (!state.track) return null;
	const duration = state.track.duration;
	const position = Math.min(duration > 0 ? duration : Infinity, currentPositionMs(state) / 1000);
	const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
	return (
		<div className="music-progress" aria-label="Progreso del tema">
			<span>{formatDuration(position) === '--:--' ? '0:00' : formatDuration(position)}</span>
			<div className="music-progress-track">
				<div className="music-progress-fill" style={{width: `${percent}%`}} />
			</div>
			<span>{formatDuration(duration)}</span>
		</div>
	);
}

/** Filas "fantasma" mientras llegan los resultados (en vez de una lista vacía). */
function MusicSkeleton(): JSX.Element {
	return (
		<ul className="music-list" aria-hidden="true">
			{Array.from({length: 6}, (_, index) => (
				<li key={index} className="music-row is-skeleton">
					<span className="skeleton skeleton-art" />
					<span className="music-row-info">
						<span className="skeleton skeleton-line" style={{width: `${55 + ((index * 13) % 30)}%`}} />
						<span className="skeleton skeleton-line is-short" />
					</span>
				</li>
			))}
		</ul>
	);
}

/**
 * Música: la Jam del grupo.
 *
 * El layout sigue a Spotify (lista central + barra de reproducción abajo), pero con los colores y
 * el estilo de Pelacord. Los íconos son de `lucide-react`.
 */
export function MusicView({onClose}: {onClose: () => void}): JSX.Element {
	const {state, musicState, musicPlayback, musicRetry, musicPlay, musicEnqueue, musicRemove, musicClearQueue, musicMove, musicSkip, musicTogglePause, musicSetMuted, musicSetVolume} =
		useStore();
	const [query, setQuery] = useState('');
	/** Lo que se busca de verdad: cambia con Enter o después de una pausa larga. */
	const [searchTerm, setSearchTerm] = useState('');
	const [results, setResults] = useState<TrackResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [tab, setTab] = useState<'search' | 'queue' | 'spotify'>('search');
	/** Para reordenar la cola arrastrando: de dónde sale y sobre cuál está. */
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);
	/** El origen del arrastre, en un ref: el estado de React puede no estar actualizado al soltar. */
	const dragFromRef = useRef<number | null>(null);
	/** Playlists destacadas para el buscador (se ven cuando no hay búsqueda). */
	const [discover, setDiscover] = useState<SpotifyPlaylist[]>([]);
	const [discoverLoading, setDiscoverLoading] = useState(true);
	/** Playlist abierta desde el buscador (se ve igual que en la pestaña de Spotify). */
	const [openDiscover, setOpenDiscover] = useState<SpotifyPlaylist | null>(null);
	const spotifyImport = useSpotifyImport();
	const muted = state.settings.musicMuted ?? false;
	const volume = state.settings.musicVolume ?? 0.8;
	/** Para controlar la Jam hay que estar en un canal de voz: si no, no hay dónde sonar. */
	const inVoice = Boolean(state.voice.channelId);
	const voiceChannel = state.channels.find(({id}) => id === state.voice.channelId);

	// Pausa corta: si dejás de escribir, busca solo (sin lanzar una búsqueda por tecla). La búsqueda
	// ahora va por la API rápida de YouTube (no por yt-dlp), así que se puede esperar menos.
	useEffect(() => {
		const timer = setTimeout(() => setSearchTerm(query), 450);
		return () => clearTimeout(timer);
	}, [query]);

	// Busca al apretar Enter o después de la pausa. Lo ya buscado se muestra al instante.
	useEffect(() => {
		const clean = searchTerm.trim();
		if (!clean) {
			setResults([]);
			setLoading(false);
			return;
		}
		const key = clean.toLowerCase();
		const cached = searchMemory.get(key);
		if (cached) {
			setResults(cached);
			setLoading(false);
			return;
		}
		let stale = false;
		setLoading(true);
		void getDesktopTransport()
			?.searchYouTube(clean, 15)
			.then((list) => {
				if (stale) return;
				const found = list ?? [];
				if (found.length > 0) rememberSearch(key, found);
				setResults(found);
			})
			.catch(() => {
				if (!stale) setResults([]);
			})
			.finally(() => {
				if (!stale) setLoading(false);
			});
		return () => {
			stale = true;
		};
	}, [searchTerm]);

	const current = musicState.track;

	// Playlists destacadas del buscador: se piden una sola vez (el proceso principal las guarda 30 min).
	useEffect(() => {
		let alive = true;
		void getDesktopTransport()
			?.spotifyDiscover()
			.then((result) => {
				if (alive) setDiscover(result?.playlists ?? []);
			})
			.catch(() => {})
			.finally(() => {
				if (alive) setDiscoverLoading(false);
			});
		return () => {
			alive = false;
		};
	}, []);

	// La playlist del buscador no se agrega de una: se abre para ver sus canciones (ver el detalle).

	return (
		<div className="music-view">
			<header className="music-header">
				<div className="music-brand"><ListMusic size={20} /><h1>Música</h1></div>
				<nav className="music-tabs" aria-label="Música">
					<button type="button" aria-pressed={tab === 'search'} className={tab === 'search' ? 'is-active' : ''} onClick={() => setTab('search')}>
						<Search size={15} /> Buscar
					</button>
					<button type="button" aria-pressed={tab === 'queue'} className={tab === 'queue' ? 'is-active' : ''} onClick={() => setTab('queue')}>
						<ListMusic size={15} /> Cola
						{musicState.queue.length > 0 ? <span className="music-badge">{musicState.queue.length}</span> : null}
					</button>
					<button
						type="button"
						aria-pressed={tab === 'spotify'}
						className={`spotify-tab${tab === 'spotify' ? ' is-active' : ''}`}
						onClick={() => setTab('spotify')}>
						<SiSpotify size={15} /> Spotify
					</button>
				</nav>
				<button type="button" className="music-close" onClick={onClose} aria-label="Cerrar música" title="Cerrar">
					<X size={18} />
				</button>
			</header>
			<div className="music-session" role="status">
				<span>{voiceChannel ? `Jam en ${voiceChannel.name}` : 'Entrá a un canal de voz para iniciar una Jam'}</span>
				{musicPlayback === 'loading' && <span className="music-session-state"><Loader2 size={15} className="music-spin" /> Cargando audio…</span>}
				{musicPlayback === 'error' && <span className="music-session-state is-error">No se pudo cargar el audio <button type="button" className="button secondary" onClick={musicRetry}>Reintentar</button></span>}
			</div>

			<div className="music-body">
				{/* Una playlist del buscador se abre para ver sus canciones, igual que en la pestaña de Spotify. */}
				{tab === 'search' && openDiscover ? (
					<SpotifyPlaylistDetail
						playlist={openDiscover}
						onBack={() => setOpenDiscover(null)}
						onShowQueue={() => setTab('queue')}
					/>
				) : null}
				{tab === 'search' && !openDiscover ? (
					<>
						<div className="music-search">
							<Search size={16} />
							<input
								className="input"
								placeholder="Buscar una canción, artista o tema… (Enter)"
								value={query}
								autoFocus
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') setSearchTerm(event.currentTarget.value);
								}}
							/>
							{loading ? <Loader2 size={16} className="music-spin" /> : null}
						</div>
						{spotifyImport.busy && spotifyImport.progress.total > 0 ? (
							<div className="spotify-progress">
								<span>
									Agregando a la cola… {spotifyImport.progress.done}/{spotifyImport.progress.total}
								</span>
								<button type="button" className="spotify-ghost" title="Cortar" onClick={spotifyImport.cancel}>
									<X size={15} />
								</button>
							</div>
						) : null}
						{spotifyImport.error ? (
							<p className="spotify-error">
								<TriangleAlert size={15} /> {spotifyImport.error}
							</p>
						) : null}
						{spotifyImport.notice ? <p className="spotify-notice">{spotifyImport.notice}</p> : null}
						{!query.trim() ? (
							<>
								<p className="settings-hint">
									{inVoice ? (
										<>
											Buscá algo y dale play: se reproduce para <strong>todos</strong> los que estén en el canal.
										</>
									) : (
										<>Unite a un canal de voz para escuchar y controlar la música con el grupo.</>
									)}
								</p>
								{discoverLoading ? (
									<p className="settings-hint">
										<Loader2 size={16} className="music-spin" /> Buscando playlists de Spotify…
									</p>
								) : null}
								{discover.length > 0 ? (
									<>
										<span className="music-grid-title">
											<SiSpotify size={15} color={SPOTIFY_GREEN} /> Playlists para escuchar
										</span>
										<div className="music-grid">
											{discover.map((playlist, index) => (
												<button
													key={playlist.id}
													type="button"
													className="music-card"
													style={{'--card-hue': String((index * 47) % 360)} as CSSProperties}
													title={`Ver las canciones de "${playlist.name}"`}
													onClick={() => setOpenDiscover(playlist)}>
													<span className="music-card-art">
														{playlist.image ? (
															<img src={playlist.image} alt="" loading="lazy" />
														) : (
															<SiSpotify size={34} color="#ffffff" />
														)}
													</span>
													<span className="music-card-name" title={playlist.name}>
														{playlist.name}
													</span>
													<span className="music-card-sub">{playlist.owner || 'Spotify'}</span>
												</button>
											))}
										</div>
									</>
								) : null}
							</>
						) : null}
						{!loading && searchTerm.trim() && query.trim() && results.length === 0 ? (
							<p className="settings-hint">No encontré nada con eso.</p>
						) : null}
						{loading && results.length === 0 ? <MusicSkeleton /> : null}
						<ul className={`music-list${loading && results.length > 0 ? ' is-refreshing' : ''}`}>
							{results.map((track) => (
								<li
									key={track.id}
									className={`music-row${current?.id === track.id ? ' is-playing' : ''}`}
									title={inVoice ? 'Doble click para reproducir para todos' : undefined}
									onDoubleClick={() => {
										if (inVoice) void musicPlay(toMusicTrack(track, state.me.name));
									}}>
									{track.thumbnail ? <img src={track.thumbnail} alt="" loading="lazy" /> : <span className="music-artwork"><ListMusic size={17} /></span>}
									<span className="music-row-info">
										<span className="music-row-title" title={track.title}>
											{current?.id === track.id ? <span className="music-eq" aria-label="Sonando"><i /><i /><i /></span> : null}
											{track.title}
										</span>
										<span className="music-row-sub">
											{track.author} · {formatDuration(track.duration)}
										</span>
									</span>
									<button
										type="button"
										className="music-row-action"
										title="Reproducir para todos"
										disabled={!inVoice}
										onClick={() => void musicPlay(toMusicTrack(track, state.me.name))}>
										<Play size={16} />
									</button>
									<button
										type="button"
										className="music-row-action"
										title="Agregar a la cola"
										disabled={!inVoice}
										onClick={() => void musicEnqueue(toMusicTrack(track, state.me.name))}>
										<Plus size={16} />
									</button>
								</li>
							))}
						</ul>
					</>
				) : null}
				{tab === 'queue' ? (
					<>
						{current ? (
							<div
								className={`music-now${current.thumbnail ? ' has-image' : ''}`}
								style={
									current.thumbnail
										? ({'--music-now-image': `url("${current.thumbnail}")`} as CSSProperties)
										: undefined
								}>
								<span className="music-now-label">Suena ahora para todos</span>
								<span className="music-now-title">{current.title}</span>
								<span className="music-now-sub">
									{current.author} · la puso {current.addedBy}
								</span>
							</div>
						) : (
							<p className="settings-hint">No hay nada sonando. Buscá algo y dale play.</p>
						)}
						{musicState.queue.length > 0 ? (
							<div className="music-queue-head">
								<span>{musicState.queue.length} en la cola · arrastrá para cambiar el orden</span>
								<button
									type="button"
									className="music-clear"
									title="Vaciar la cola (lo que está sonando sigue)"
									onClick={() => {
										if (window.confirm('¿Vaciar la cola? Lo que está sonando sigue igual.')) void musicClearQueue();
									}}>
									<Trash2 size={15} /> Vaciar cola
								</button>
							</div>
						) : null}
						<ul className="music-list">
							{musicState.queue.map((track, index) => (
								<li
									key={`${track.id}-${index}`}
									className={`music-row is-draggable${dragIndex === index ? ' is-dragging' : ''}${
										overIndex === index && dragFromRef.current !== null && dragFromRef.current !== index
											? ' is-drop-target'
											: ''
									}`}
									title="Arrastrala para cambiarla de lugar"
									draggable
									onDragStart={(event) => {
										dragFromRef.current = index;
										setDragIndex(index);
										event.dataTransfer.effectAllowed = 'move';
										// Chromium necesita algo en el dataTransfer para que el arrastre arranque.
										event.dataTransfer.setData('text/plain', String(index));
									}}
									onDragOver={(event) => {
										if (dragFromRef.current === null) return;
										event.preventDefault();
										event.dataTransfer.dropEffect = 'move';
										setOverIndex(index);
									}}
									onDragLeave={() => setOverIndex((value) => (value === index ? null : value))}
									onDrop={(event) => {
										event.preventDefault();
										const from = dragFromRef.current;
										if (from !== null && from !== index) void musicMove(from, index);
										dragFromRef.current = null;
										setDragIndex(null);
										setOverIndex(null);
									}}
									onDragEnd={() => {
										dragFromRef.current = null;
										setDragIndex(null);
										setOverIndex(null);
									}}>
									<span className="music-row-index">{index + 1}</span>
									<img src={track.thumbnail} alt="" loading="lazy" />
									<span className="music-row-info">
										<span className="music-row-title" title={track.title}>
											{track.title}
										</span>
										<span className="music-row-sub">
											{track.author} · la puso {track.addedBy}
										</span>
									</span>
									<GripVertical size={16} className="music-row-grip" />
									<button
										type="button"
										className="music-row-action"
										title="Sacar de la cola"
										onClick={() => void musicRemove(index)}>
										<X size={16} />
									</button>
								</li>
							))}
						</ul>
					</>
				) : tab === 'spotify' ? (
					<SpotifyView onShowQueue={() => setTab('queue')} />
				) : null}
			</div>

			{/* Barra de reproducción, como la de Spotify. */}
			<footer className="music-bar">
				<div className="music-bar-track">
					{current ? (
						<>
							{current.thumbnail ? <img src={current.thumbnail} alt="" /> : <span className="music-artwork"><ListMusic size={17} /></span>}
							<span className="music-bar-info">
								<span className="music-bar-title" title={current.title}>
									{current.title}
								</span>
								<span className="music-bar-sub">{current.author}</span>
							</span>
						</>
					) : (
						<span className="music-bar-sub">Nada sonando</span>
					)}
				</div>
				<div className="music-bar-center">
				<div className="music-bar-controls">
					<button
						type="button"
						className="music-play"
						title={!inVoice ? 'Unite a un canal de voz para controlar la música' : musicState.pausedAt ? 'Reanudar' : 'Pausar'}
						disabled={!current || !inVoice}
						onClick={() => void musicTogglePause()}>
						{musicState.pausedAt ? <Play size={18} /> : <Pause size={18} />}
					</button>
					<button
						type="button"
						className="music-skip"
						title={!inVoice ? 'Unite a un canal de voz para controlar la música' : 'Siguiente'}
						disabled={!inVoice || (!current && !musicState.queue.length)}
						onClick={() => void musicSkip()}>
						<SkipForward size={18} />
					</button>
				</div>
				<MusicProgress state={musicState} />
				</div>
				<div className="music-bar-volume">
					<button
						type="button"
						className={`music-mute${muted ? ' is-active' : ''}`}
						title={muted ? 'Escuchar la música' : 'Silenciar la música'}
						onClick={() => musicSetMuted(!muted)}>
						{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
					</button>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={volume}
						title="Volumen de la música"
						onChange={(event) => musicSetVolume(Number(event.target.value))}
					/>
				</div>
			</footer>
		</div>
	);
}
