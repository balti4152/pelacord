import {useEffect, useRef, useState} from 'react';
import {Info, Loader2, Play, Radio, Search, Star, Users, X} from 'lucide-react';
import {type TmdbMovie, type TmdbRow, getDesktopTransport} from '@/lib/desktop';
import {roomLabel} from '@/lib/movieRooms';
import {ColorAvatar} from '@/components/primitives';
import {MoviePlayer} from '@/components/MoviePlayer';
import {useStore} from '@/state/store';

/** 128 → "2 h 8 min" */
function formatRuntime(minutes: number): string {
	if (!Number.isFinite(minutes) || minutes <= 0) return '';
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
}

/**
 * Pelaflix: el catálogo y las salas del grupo.
 *
 * Arriba van las SALAS en vivo (quién está mirando qué), después la película destacada y las filas
 * de siempre. Todo sale de TMDB, y las salas viajan por la malla (P2P), no por la nube.
 */
export function MoviesView({onClose}: {onClose: () => void}): JSX.Element {
	const {movieRoomsList, myMovieRoom, myJoinedMovieRoom, movieOpen, movieJoin, movieRoomViewers, state} = useStore();
	const [rows, setRows] = useState<TmdbRow[]>([]);
	const [hero, setHero] = useState<TmdbMovie | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<TmdbMovie[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [selected, setSelected] = useState<TmdbMovie | null>(null);
	const searchRef = useRef(0);

	// El catálogo se pide una sola vez.
	useEffect(() => {
		let alive = true;
		void getDesktopTransport()
			?.tmdbRows()
			.then((data) => {
				if (!alive) return;
				setRows(data?.rows ?? []);
				setHero(data?.hero ?? null);
				if (!data?.ok) setError('No se pudo traer el catálogo de TMDB.');
			})
			.catch(() => {
				if (alive) setError('No se pudo traer el catálogo de TMDB.');
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, []);

	// Búsqueda con pausa larga: si dejás de escribir, busca.
	useEffect(() => {
		const clean = query.trim();
		if (!clean) {
			setResults(null);
			setSearching(false);
			return;
		}
		setSearching(true);
		const token = ++searchRef.current;
		const timer = setTimeout(() => {
			void getDesktopTransport()
				?.tmdbSearch(clean)
				.then((data) => {
					if (searchRef.current !== token) return;
					setResults(data?.movies ?? []);
				})
				.catch(() => {
					if (searchRef.current === token) setResults([]);
				})
				.finally(() => {
					if (searchRef.current === token) setSearching(false);
				});
		}, 450);
		return () => clearTimeout(timer);
	}, [query]);

	/** Ver algo: si ya estoy en una sala como host, cambia ESA; si no, me crea la mía. */
	function ver(movie: TmdbMovie): void {
		setSelected(null);
		movieOpen({
			tmdbId: movie.id,
			mediaType: movie.mediaType,
			title: movie.title,
			poster: movie.poster,
			year: movie.year,
		});
	}

	/** Año · nota · duración. La nota con el icono de la librería (sin emojis). */
	const meta = (movie: TmdbMovie) => (
		<p className="movies-meta">
			<span>{movie.year}</span>
			{movie.rating > 0 ? (
				<span className="movies-meta-rating">
					<Star size={12} />
					{movie.rating.toFixed(1)}
				</span>
			) : null}
			{movie.runtime > 0 ? <span>{formatRuntime(movie.runtime)}</span> : null}
		</p>
	);

	const card = (movie: TmdbMovie) => (
		<button key={movie.id} type="button" className="movies-card" title={movie.title} onClick={() => setSelected(movie)}>
			<span className="movies-card-art">
				{movie.poster ? <img src={movie.poster} alt="" loading="lazy" /> : <span className="movies-card-empty" />}
				<span className="movies-card-hover">
					<Play size={22} />
				</span>
			</span>
			<span className="movies-card-title">{movie.title}</span>
			<span className="movies-card-sub">
				{movie.year}
				{movie.rating > 0 ? (
					<>
						{' · '}
						<Star size={11} /> {movie.rating.toFixed(1)}
					</>
				) : null}
			</span>
		</button>
	);

	return (
		<div className="movies-view">
			<header className="movies-header">
				<span className="movies-brand">PELAFLIX</span>
				<label className="movies-search">
					<Search size={15} />
					<input
						className="input"
						placeholder="Buscar una película…"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					{searching ? <Loader2 size={15} className="music-spin" /> : null}
				</label>
				<button type="button" className="movies-close" onClick={onClose} title="Cerrar">
					<X size={18} />
				</button>
			</header>

			<div className="movies-body">
				{/* Salas en vivo: quién está mirando qué. Entrar te sincroniza con el host. */}
				{movieRoomsList.length > 0 ? (
					<section className="movies-rooms">
						<h2 className="movies-section-title">
							<Radio size={15} /> Salas en vivo
						</h2>
						<div className="movies-rooms-row">
							{movieRoomsList.map((room, index) => {
								const soyHost = room.hostId === state.me.id;
								const mirando = myJoinedMovieRoom?.id === room.id;
								const viewers = movieRoomViewers(room.id);
								const total = viewers.length + (soyHost ? 1 : 0);
								return (
									<article key={room.id} className={`movies-room${mirando ? ' is-watching' : ''}`}>
										<span className="movies-room-live">
											<span className="movies-room-dot" /> {roomLabel(index)}
										</span>
										<span className="movies-room-what">
											{room.media.poster ? <img src={room.media.poster} alt="" loading="lazy" /> : null}
											<span className="movies-room-info">
												<span className="movies-room-movie" title={room.media.title}>
													{room.media.title}
												</span>
												<span className="movies-room-host">
													{soyHost ? 'La estás compartiendo' : `La comparte ${room.hostName}`}
												</span>
											</span>
										</span>
										<div className="movies-room-foot">
											<span className="movies-room-viewers" title={`${total} mirando`}>
												{soyHost ? (
													<ColorAvatar name={state.me.name} color={state.me.avatarColor} url={state.me.avatarUrl} size={22} />
												) : null}
												{viewers.slice(0, 3).map((peer) => (
													<ColorAvatar key={peer.id} name={peer.name} color={peer.color} url={peer.avatarUrl} size={22} />
												))}
												<span className="movies-room-count">
													<Users size={12} /> {total}
												</span>
											</span>
											<button
												type="button"
												className={`movies-room-join${mirando ? ' is-watching' : ''}`}
												onClick={() => movieJoin(room.id)}>
												{mirando ? 'Estás mirando' : 'Entrar'}
											</button>
										</div>
									</article>
								);
							})}
						</div>
					</section>
				) : null}

				{loading ? (
					<p className="movies-hint">
						<Loader2 size={16} className="music-spin" /> Trayendo el catálogo…
					</p>
				) : null}
				{error ? <p className="movies-error">{error}</p> : null}

				{results ? (
					<>
						<h2 className="movies-section-title">Resultados para “{query.trim()}”</h2>
						{results.length === 0 && !searching ? <p className="movies-hint">No encontré nada con eso.</p> : null}
						<div className="movies-grid">{results.map(card)}</div>
					</>
				) : (
					<>
						{hero ? (
							<section className="movies-hero" style={hero.backdrop ? {backgroundImage: `url("${hero.backdrop}")`} : undefined}>
								<div className="movies-hero-info">
									<span className="movies-hero-tag">Destacada de la semana</span>
									<h1>{hero.title}</h1>
									{meta(hero)}
									<p className="movies-hero-overview">{hero.overview.slice(0, 240)}</p>
									<div className="movies-hero-actions">
										<button type="button" className="movies-play" onClick={() => ver(hero)}>
											<Play size={18} /> Ver ahora
										</button>
										<button type="button" className="movies-more" onClick={() => setSelected(hero)}>
											<Info size={18} /> Más información
										</button>
									</div>
								</div>
							</section>
						) : null}

						{rows.map((row) => (
							<section key={row.title} className="movies-row">
								<h2 className="movies-section-title">{row.title}</h2>
								<div className="movies-strip">{row.movies.map(card)}</div>
							</section>
						))}
					</>
				)}

				<p className="movies-credit">Datos e imágenes: TMDB</p>
			</div>

			{selected ? (
				<div className="movies-modal" onClick={() => setSelected(null)}>
					<div className="movies-modal-card" onClick={(event) => event.stopPropagation()}>
						{selected.backdrop ? (
							<div className="movies-modal-art" style={{backgroundImage: `url("${selected.backdrop}")`}} />
						) : null}
						<button type="button" className="movies-modal-close" onClick={() => setSelected(null)} title="Cerrar">
							<X size={18} />
						</button>
						<div className="movies-modal-body">
							<h2>{selected.title}</h2>
							{meta(selected)}
							{selected.genres.length > 0 ? <p className="movies-modal-genres">{selected.genres.join(' · ')}</p> : null}
							<p className="movies-modal-overview">{selected.overview || 'Sin sinopsis.'}</p>
							<div className="movies-hero-actions">
								<button type="button" className="movies-play" onClick={() => ver(selected)}>
									<Play size={18} /> {myMovieRoom ? 'Poner en mi sala' : myJoinedMovieRoom ? 'Ver en mi sala' : 'Ver ahora'}
								</button>
							</div>
							{myMovieRoom || myJoinedMovieRoom ? (
								<p className="movies-hint">
									{myMovieRoom
										? 'Si estás compartiendo una sala, esto se la cambia a todos los que están mirando.'
										: 'Estás mirando la sala de otro: esto te crea una sala nueva tuya.'}
								</p>
							) : null}
						</div>
					</div>
				</div>
			) : null}

			<MoviePlayer />
		</div>
	);
}
