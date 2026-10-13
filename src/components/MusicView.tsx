import {useEffect, useState} from 'react';
import {ListMusic, Loader2, Pause, Play, Plus, Search, SkipForward, Volume2, VolumeX, X} from 'lucide-react';
import {SiSpotify} from 'react-icons/si';
import {type TrackResult, getDesktopTransport} from '@/lib/desktop';
import {type MusicTrack} from '@/lib/musicQueue';
import {SpotifyView} from '@/components/SpotifyView';
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

/**
 * Música: la Jam del grupo.
 *
 * El layout sigue a Spotify (lista central + barra de reproducción abajo), pero con los colores y
 * el estilo de Pelacord. Los íconos son de `lucide-react`.
 */
export function MusicView({onClose}: {onClose: () => void}): JSX.Element {
	const {state, musicState, musicPlay, musicEnqueue, musicRemove, musicSkip, musicTogglePause, musicSetMuted, musicSetVolume} =
		useStore();
	const [query, setQuery] = useState('');
	/** Lo que se busca de verdad: cambia con Enter o después de una pausa larga. */
	const [searchTerm, setSearchTerm] = useState('');
	const [results, setResults] = useState<TrackResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [tab, setTab] = useState<'search' | 'queue' | 'spotify'>('search');
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
						{!query.trim() ? (
							<p className="settings-hint">
								{inVoice ? (
									<>
										Buscá algo y dale play: se reproduce para <strong>todos</strong> los que estén en el canal.
									</>
								) : (
									<>Unite a un canal de voz para escuchar y controlar la música con el grupo.</>
								)}
							</p>
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
							<div className="music-now">
								<span className="music-now-label">Suena ahora para todos</span>
								<span className="music-now-title">{current.title}</span>
								<span className="music-now-sub">
									{current.author} · la puso {current.addedBy}
								</span>
							</div>
						) : (
							<p className="settings-hint">No hay nada sonando. Buscá algo y dale play.</p>
						)}
						<ul className="music-list">
							{musicState.queue.map((track, index) => (
								<li key={`${track.id}-${index}`} className="music-row">
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
					<SpotifyView />
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
