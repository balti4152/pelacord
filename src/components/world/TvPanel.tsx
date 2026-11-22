import {useEffect, useState} from 'react';
import {
	Film, ListPlus, PartyPopper, Radio, Monitor, Music, Pause, Play, Plus, Power, Rewind, FastForward, ScreenShare, Search, SkipBack, SkipForward, Trash2, X, Volume2,
} from 'lucide-react';
import {getDesktopTransport, type TmdbMovie, type TrackResult} from '@/lib/desktop';
import type {MovieMedia} from '@/lib/movieRooms';
import type {TvState, TvTrack} from '@/world/tv';

function clock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export interface TvMovieInfo {
	title: string;
	poster: string;
	paused: boolean;
	positionMs: number;
	host: string;
}

export function TvPanel(props: {
	tv: TvState | null;
	positionMs: number;
	onPlayNow: (track: TvTrack) => void;
	onEnqueue: (track: TvTrack) => void;
	onToggle: () => void;
	onNext: () => void;
	onPrevious: () => void;
	onJump: (index: number) => void;
	onRemove: (index: number) => void;
	onSeek: (ms: number) => void;
	movie: TvMovieInfo | null;
	onPickMovie: (media: MovieMedia) => void;
	onMovieToggle: () => void;
	onMovieSeek: (deltaMs: number) => void;
	inVoice: boolean;
	sharerName: string | null;
	sharingHere: boolean;
	onJoinVoice: () => void;
	onShare: () => void;
	onStopShare: () => void;
	onOff: () => void;
	onClose: () => void;
	/** Mi volumen de la música de la tele (0 a 1, sólo para mí). */
	volume: number;
	onVolume: (volume: number) => void;
	/** La sala tiene bola de boliche: se puede prender el modo joda. */
	partyAvailable?: boolean;
	onParty?: (on: boolean) => void;
	/** La radio del campamento: sólo música. */
	radio?: boolean;
}): JSX.Element {
	const {tv} = props;
	const [tab, setTab] = useState<'music' | 'movies' | 'screen'>(props.radio ? 'music' : tv?.mode === 'movie' ? 'movies' : tv?.mode === 'screen' ? 'screen' : 'music');
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<TrackResult[]>([]);
	const [searching, setSearching] = useState(false);
	const [movieQuery, setMovieQuery] = useState('');
	const [movies, setMovies] = useState<TmdbMovie[]>([]);
	const [loadingMovies, setLoadingMovies] = useState(false);
	const track = tv?.mode === 'music' ? tv.queue[tv.index] ?? null : null;
	const upcoming = tv?.mode === 'music' ? tv.queue.map((t, i) => ({t, i})).filter(({i}) => i > tv.index) : [];

	useEffect(() => {
		if (tab !== 'movies' || movies.length) return;
		setLoadingMovies(true);
		void getDesktopTransport()?.tmdbRows().then((r) => {
			const seen = new Set<number>();
			const list: TmdbMovie[] = [];
			for (const row of r.rows ?? []) for (const m of row.movies ?? []) if (!seen.has(m.id) && list.length < 30) {
				seen.add(m.id);
				list.push(m);
			}
			setMovies(list);
		}).catch(() => {}).finally(() => setLoadingMovies(false));
		if (!getDesktopTransport()) setLoadingMovies(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tab]);

	async function searchMusic(): Promise<void> {
		if (!query.trim()) return;
		setSearching(true);
		const list = (await getDesktopTransport()?.searchYouTube(query, 12).catch(() => [])) ?? [];
		setResults(list);
		setSearching(false);
	}

	async function searchMovies(): Promise<void> {
		if (!movieQuery.trim()) return;
		setLoadingMovies(true);
		const r = await getDesktopTransport()?.tmdbSearch(movieQuery).catch(() => null);
		setMovies(r?.movies ?? []);
		setLoadingMovies(false);
	}

	const toTrack = (r: TrackResult): TvTrack => ({id: r.id, title: r.title, thumbnail: r.thumbnail, duration: r.duration, author: r.author, url: r.url});

	return (
		<section className="t-panel t-tv" onKeyDown={(e) => e.stopPropagation()}>
			<header className="t-panel-head">
				<span className="t-panel-icon">{props.radio ? <Radio size={20} strokeWidth={2.6} /> : <Monitor size={20} strokeWidth={2.6} />}</span>
				<h2>{props.radio ? 'La radio' : 'La tele'}</h2>
				{tv && tv.mode !== 'off' ? <button type="button" className="t-btn is-soft is-small" onClick={props.onOff} title={props.radio ? 'Apagar la radio' : 'Apagar la tele'}><Power size={13} strokeWidth={3} /> Apagar</button> : null}
				<button type="button" className="t-close" onClick={props.onClose} aria-label="Cerrar"><X size={18} strokeWidth={3} /></button>
			</header>
			<p className="t-hint"><Volume2 size={13} strokeWidth={2.8} /> Se escucha sólo acá, más fuerte cerca {props.radio ? 'de la radio' : 'de la pantalla'}. Todos los que están acá la pueden manejar.</p>
			<div className="t-tv-options">
				<label className="t-tv-volume" title="Sólo cambia cómo la escuchás vos">
					<Volume2 size={15} strokeWidth={2.8} />
					<span>Mi volumen</span>
					<input type="range" min={0} max={100} value={Math.round(props.volume * 100)} onChange={(e) => props.onVolume(Number(e.target.value) / 100)} />
					<b>{Math.round(props.volume * 100)}%</b>
				</label>
				{props.partyAvailable && props.onParty ? (
					<button type="button" className={`t-btn is-small ${tv?.party ? 'is-primary' : 'is-soft'} t-party-toggle`} onClick={() => props.onParty?.(!tv?.party)} title="Bola de boliche, luces de colores y la sala a oscuras mientras suena música">
						<PartyPopper size={14} strokeWidth={2.8} /> Modo joda: {tv?.party ? 'prendido' : 'apagado'}
					</button>
				) : null}
			</div>
			{props.radio ? null : <nav className="t-tabs">
				<button type="button" className={tab === 'music' ? 'is-active' : ''} onClick={() => setTab('music')}><Music size={15} strokeWidth={2.6} /> Música</button>
				<button type="button" className={tab === 'movies' ? 'is-active' : ''} onClick={() => setTab('movies')}><Film size={15} strokeWidth={2.6} /> Pelaflix</button>
				<button type="button" className={tab === 'screen' ? 'is-active' : ''} onClick={() => setTab('screen')}><ScreenShare size={15} strokeWidth={2.6} /> Pantalla</button>
			</nav>}

			{tab === 'music' ? (
				<div className="t-tv-body">
					{track ? (
						<div className="t-player">
							<img className="t-player-cover" src={track.thumbnail} alt="" />
							<div className="t-player-info">
								<strong>{track.title}</strong>
								<small>{track.author}</small>
								<input
									className="t-progress"
									type="range"
									min={0}
									max={Math.max(1, track.duration)}
									value={Math.min(track.duration, Math.floor(props.positionMs / 1000))}
									onChange={(e) => props.onSeek(Number(e.target.value) * 1000)}
								/>
								<div className="t-player-time"><span>{clock(props.positionMs)}</span><span>{clock(track.duration * 1000)}</span></div>
								<div className="t-player-buttons">
									<button type="button" className="t-round" onClick={props.onPrevious} title="Anterior"><SkipBack size={18} strokeWidth={2.6} /></button>
									<button type="button" className="t-round is-big" onClick={props.onToggle} title={tv?.paused ? 'Reproducir' : 'Pausar'}>
										{tv?.paused ? <Play size={22} strokeWidth={2.8} /> : <Pause size={22} strokeWidth={2.8} />}
									</button>
									<button type="button" className="t-round" onClick={props.onNext} title="Siguiente"><SkipForward size={18} strokeWidth={2.6} /></button>
								</div>
							</div>
						</div>
					) : <p className="t-empty">{props.radio ? 'La radio está callada.' : 'La tele no tiene música.'} Buscá algo para poner.</p>}
					{upcoming.length ? (
						<>
							<h3 className="t-subtitle">A continuación</h3>
							<ul className="t-list t-queue">
								{upcoming.map(({t, i}) => (
									<li key={`${t.id}-${i}`}>
										<img src={t.thumbnail} alt="" />
										<span className="t-list-name"><strong>{t.title}</strong><small>{t.author}</small></span>
										<button type="button" className="t-btn is-soft is-small" onClick={() => props.onJump(i)} title="Poner ya"><Play size={13} strokeWidth={3} /></button>
										<button type="button" className="t-btn is-soft is-small" onClick={() => props.onRemove(i)} title="Sacar"><Trash2 size={13} strokeWidth={3} /></button>
									</li>
								))}
							</ul>
						</>
					) : null}
					<form className="t-search" onSubmit={(e) => { e.preventDefault(); void searchMusic(); }}>
						<Search size={16} strokeWidth={2.6} />
						<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar una canción…" autoFocus />
						<button type="submit" className="t-btn is-primary is-small">Buscar</button>
					</form>
					<ul className="t-list t-results">
						{searching ? <li className="t-hint"><span className="t-spinner" /> Buscando…</li> : null}
						{results.map((r) => (
							<li key={r.id}>
								<img src={r.thumbnail} alt="" />
								<span className="t-list-name"><strong>{r.title}</strong><small>{r.author} · {clock(r.duration * 1000)}</small></span>
								<button type="button" className="t-btn is-primary is-small" onClick={() => props.onPlayNow(toTrack(r))} title="Poner ya"><Play size={13} strokeWidth={3} /></button>
								<button type="button" className="t-btn is-soft is-small" onClick={() => props.onEnqueue(toTrack(r))} title="Agregar a la cola"><ListPlus size={14} strokeWidth={2.8} /></button>
							</li>
						))}
					</ul>
				</div>
			) : null}

			{tab === 'movies' ? (
				<div className="t-tv-body">
					{props.movie ? (
						<div className="t-player">
							{props.movie.poster ? <img className="t-player-cover is-poster" src={props.movie.poster} alt="" /> : null}
							<div className="t-player-info">
								<strong>{props.movie.title}</strong>
								<small>La puso {props.movie.host} · {clock(props.movie.positionMs)}</small>
								<div className="t-player-buttons">
									<button type="button" className="t-round" onClick={() => props.onMovieSeek(-10000)} title="Atrás 10 s"><Rewind size={18} strokeWidth={2.6} /></button>
									<button type="button" className="t-round is-big" onClick={props.onMovieToggle} title={props.movie.paused ? 'Reproducir' : 'Pausar'}>
										{props.movie.paused ? <Play size={22} strokeWidth={2.8} /> : <Pause size={22} strokeWidth={2.8} />}
									</button>
									<button type="button" className="t-round" onClick={() => props.onMovieSeek(30000)} title="Adelante 30 s"><FastForward size={18} strokeWidth={2.6} /></button>
								</div>
							</div>
						</div>
					) : null}
					<form className="t-search" onSubmit={(e) => { e.preventDefault(); void searchMovies(); }}>
						<Search size={16} strokeWidth={2.6} />
						<input value={movieQuery} onChange={(e) => setMovieQuery(e.target.value)} placeholder="Buscar una película o serie…" />
						<button type="submit" className="t-btn is-primary is-small">Buscar</button>
					</form>
					{loadingMovies ? <p className="t-hint"><span className="t-spinner" /> Cargando…</p> : null}
					<div className="t-movie-grid">
						{movies.map((m) => (
							<button
								key={`${m.mediaType}-${m.id}`}
								type="button"
								className="t-movie"
								title={`Poner "${m.title}" en la tele`}
								onClick={() => props.onPickMovie({tmdbId: m.id, mediaType: m.mediaType, title: m.title, poster: m.poster, year: m.year})}>
								{m.poster ? <img src={m.poster} alt="" loading="lazy" /> : <span className="t-movie-empty"><Film size={22} /></span>}
								<span>{m.title}</span>
							</button>
						))}
					</div>
				</div>
			) : null}

			{tab === 'screen' ? (
				<div className="t-tv-body">
					{props.sharerName ? <p className="t-now"><ScreenShare size={14} strokeWidth={2.8} /> En la tele: la pantalla de {props.sharerName}</p> : null}
					{!props.inVoice ? (
						<div className="t-callout">
							<p>Para compartir pantalla hay que estar en la llamada.</p>
							<button type="button" className="t-btn is-primary" onClick={props.onJoinVoice}><Plus size={14} strokeWidth={3} /> Unirme a la llamada</button>
						</div>
					) : props.sharingHere ? (
						<button type="button" className="t-btn is-danger" onClick={props.onStopShare}><Power size={15} strokeWidth={2.8} /> Dejar de compartir</button>
					) : (
						<button type="button" className="t-btn is-primary" onClick={props.onShare}><ScreenShare size={15} strokeWidth={2.8} /> Compartir mi pantalla en esta tele</button>
					)}
					<p className="t-hint">Se ve en la pantalla de esta sala, para todos los que estén acá.</p>
				</div>
			) : null}
		</section>
	);
}
