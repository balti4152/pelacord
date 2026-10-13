import {type CSSProperties, useEffect, useRef, useState} from 'react';
import {GripVertical, ListMusic, Loader2, Pause, Play, Plus, Search, SkipForward, Trash2, TriangleAlert, Volume2, VolumeX, X} from 'lucide-react';
import {SiSpotify} from 'react-icons/si';
import {type SpotifyPlaylist, type TrackResult, getDesktopTransport} from '@/lib/desktop';
import {type MusicTrack} from '@/lib/musicQueue';
import {useSpotifyImport} from '@/lib/spotifyImport';
import {SPOTIFY_GREEN, SpotifyView} from '@/components/SpotifyView';
import {useStore} from '@/state/store';

/** Dónde se guardan las portadas del fondo del buscador (y por cuánto se consideran frescas). */
const SPOTIFY_COVERS_KEY = 'pelacord.spotify.covers.v1';
const SPOTIFY_COVERS_TTL_MS = 2 * 60 * 60 * 1000;

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

/**
 * Música: la Jam del grupo.
 *
 * El layout sigue a Spotify (lista central + barra de reproducción abajo), pero con los colores y
 * el estilo de Pelacord. Los íconos son de `lucide-react`.
 */
export function MusicView({onClose}: {onClose: () => void}): JSX.Element {
	const {state, musicState, musicPlay, musicEnqueue, musicRemove, musicClearQueue, musicMove, musicSkip, musicTogglePause, musicSetMuted, musicSetVolume} =
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
	/**
	 * Portadas de álbumes al azar para el fondo decorativo del buscador. Se guardan en disco 2 horas
	 * (así al abrir están al toque y van cambiando solas de vez en cuando). Son sólo decoración.
	 */
	const [covers, setCovers] = useState<string[]>(() => {
		try {
			const raw = localStorage.getItem(SPOTIFY_COVERS_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw) as {covers: string[]; at: number};
			if (parsed?.covers?.length && Date.now() - parsed.at < SPOTIFY_COVERS_TTL_MS) return parsed.covers;
		} catch {
			// sin caché
		}
		return [];
	});
	const spotifyImport = useSpotifyImport();
	const muted = state.settings.musicMuted ?? false;
	const volume = state.settings.musicVolume ?? 0.8;
	/** Para controlar la Jam hay que estar en un canal de voz: si no, no hay dónde sonar. */
	const inVoice = Boolean(state.voice.channelId);

	// Pausa larga: si dejás de escribir, busca igual (sin lanzar uno por tecla).
	useEffect(() => {
		const timer = setTimeout(() => setSearchTerm(query), 900);
		return () => clearTimeout(timer);
	}, [query]);

	// Busca sólo cuando corresponde: al apretar Enter o después de una pausa larga.
	// (Buscar en cada tecla lanzaba un proceso de yt-dlp por vez y trababa todo.)
	useEffect(() => {
		const clean = searchTerm.trim();
		if (!clean) {
			setResults([]);
			setLoading(false);
			return;
		}
		let stale = false;
		setLoading(true);
		const timer = setTimeout(() => {
			void getDesktopTransport()
				?.searchYouTube(clean, 12)
				.then((list) => {
					if (!stale) setResults(list ?? []);
				})
				.catch(() => {
					if (!stale) setResults([]);
				})
				.finally(() => {
					if (!stale) setLoading(false);
				});
		}, 250);
		return () => {
			stale = true;
			clearTimeout(timer);
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

	// Portadas del fondo: sólo si no hay guardadas y frescas (si no, se piden y quedan 2 horas).
	useEffect(() => {
		if (covers.length > 0) return;
		let alive = true;
		void getDesktopTransport()
			?.spotifyCovers()
			.then((result) => {
				if (!alive || !result?.covers?.length) return;
				setCovers(result.covers);
				try {
					localStorage.setItem(SPOTIFY_COVERS_KEY, JSON.stringify({covers: result.covers, at: Date.now()}));
				} catch {
					// best effort
				}
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [covers.length]);

	/** Lee una playlist destacada (del embed público) y la agrega entera a la cola. */	async function addDiscover(playlist: SpotifyPlaylist): Promise<void> {
		if (spotifyImport.isBusy()) return;
		if (!inVoice) {
			spotifyImport.setError('Unite a un canal de voz para escuchar la música.');
			return;
		}
		const transport = getDesktopTransport();
		if (!transport) return;
		spotifyImport.setError('');
		spotifyImport.setNotice(`Leyendo "${playlist.name}"…`);
		try {
			const result = await transport.spotifyPublicTracks(playlist.id);
			if (!result.ok) {
				spotifyImport.setError(result.error ?? 'No se pudo leer esa playlist.');
				return;
			}
			await spotifyImport.importTracks(result.tracks, playlist.name);
		} catch (failure) {
			spotifyImport.setError(failure instanceof Error ? failure.message : 'No se pudo leer esa playlist.');
		}
	}

	return (
		<div className="music-view">
			<header className="music-header">
				<span className="music-brand">
					<ListMusic size={20} /> Música
				</span>
				<nav className="music-tabs">
					<button type="button" className={tab === 'search' ? 'is-active' : ''} onClick={() => setTab('search')}>
						<Search size={15} /> Buscar
					</button>
					<button type="button" className={tab === 'queue' ? 'is-active' : ''} onClick={() => setTab('queue')}>
						<ListMusic size={15} /> Cola
						{musicState.queue.length > 0 ? <span className="music-badge">{musicState.queue.length}</span> : null}
					</button>
					<button
						type="button"
						className={`spotify-tab${tab === 'spotify' ? ' is-active' : ''}`}
						onClick={() => setTab('spotify')}>
						<SiSpotify size={15} /> Spotify
					</button>
				</nav>
				<button type="button" className="music-close" onClick={onClose} title="Cerrar">
					<X size={18} />
				</button>
			</header>

			<div className="music-body">
				{tab === 'search' ? (
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
									<section className="music-discover">
										{/* Fondo decorativo: 10 portadas al azar, difuminadas y apagadas en los costados. */}
										{covers.length > 0 ? (
											<div className="music-discover-art" aria-hidden="true">
												{covers.map((url) => (
													<span key={url} style={{backgroundImage: `url("${url}")`}} />
												))}
											</div>
										) : null}
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
													disabled={Boolean(spotifyImport.busy) || !inVoice}
													title={inVoice ? `Agregar "${playlist.name}" a la cola` : 'Unite a un canal de voz primero'}
													onClick={() => void addDiscover(playlist)}>
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
													<span className="music-card-sub">
														{spotifyImport.busy === playlist.name ? 'Agregando…' : playlist.owner || 'Spotify'}
													</span>
												</button>
											))}
										</div>
									</section>
								) : null}
							</>
						) : null}
						{!loading && query.trim() && results.length === 0 ? (
							<p className="settings-hint">No encontré nada con eso.</p>
						) : null}
						<ul className="music-list">
							{results.map((track) => (
								<li key={track.id} className="music-row">
									<img src={track.thumbnail} alt="" loading="lazy" />
									<span className="music-row-info">
										<span className="music-row-title" title={track.title}>
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
										onClick={() => void musicPlay(toMusicTrack(track, state.me.name))}>
										<Play size={16} />
									</button>
									<button
										type="button"
										className="music-row-action"
										title="Agregar a la cola"
										onClick={() => void musicEnqueue(toMusicTrack(track, state.me.name))}>
										<Plus size={16} />
									</button>
								</li>
							))}
						</ul>
					</>
				) : tab === 'queue' ? (
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
				) : (
					<SpotifyView onShowQueue={() => setTab('queue')} />
				)}
			</div>

			{/* Barra de reproducción, como la de Spotify. */}
			<footer className="music-bar">
				<div className="music-bar-track">
					{current ? (
						<>
							<img src={current.thumbnail} alt="" />
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
						disabled={!inVoice}
						onClick={() => void musicSkip()}>
						<SkipForward size={18} />
					</button>
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
