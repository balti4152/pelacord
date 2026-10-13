import {useEffect, useRef, useState} from 'react';
import {Info, Loader2, Play, Search, Star, X} from 'lucide-react';
import {type TmdbMovie, type TmdbRow, getDesktopTransport} from '@/lib/desktop';
import {MoviePlayer} from '@/components/MoviePlayer';

/** 128 → "2 h 8 min" */
function formatRuntime(minutes: number): string {
	if (!Number.isFinite(minutes) || minutes <= 0) return '';
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
}

/**
 * Películas: el catálogo del grupo.
 *
 * El diseño es estilo Netflix (negro, rojo, filas de portadas que se deslizan), pero adentro de la
 * app: la barra lateral y el resto siguen siendo Pelacord. Los datos e imágenes son de TMDB.
 */
export function MoviesView({onClose}: {onClose: () => void}): JSX.Element {
	const [rows, setRows] = useState<TmdbRow[]>([]);
	const [hero, setHero] = useState<TmdbMovie | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<TmdbMovie[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [selected, setSelected] = useState<TmdbMovie | null>(null);
	/** La que se está viendo: abre el reproductor. */
	const [playing, setPlaying] = useState<TmdbMovie | null>(null);
	const searchRef = useRef(0);

	// El catálogo se pide una sola vez (el proceso principal no lo cachea: son 5 pedidos a TMDB).
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

	// Búsqueda con pausa larga: si dejás de escribir, busca (sin lanzar uno por tecla).
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

	/** Año · nota · duración. Sin emojis: la nota lleva el icono de lucide. */
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
			{movie.poster ? <img src={movie.poster} alt="" loading="lazy" /> : <span className="movies-card-empty" />}
			<span className="movies-card-info">
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
				{loading ? (
					<p className="movies-hint">
						<Loader2 size={16} className="music-spin" /> Trayendo el catálogo…
					</p>
				) : null}
				{error ? <p className="movies-error">{error}</p> : null}

				{/* Buscando: se muestra sólo el resultado. Sin búsqueda: el hero y las filas. */}
				{results ? (
					<>
						<h2 className="movies-row-title">Resultados para “{query.trim()}”</h2>
						{results.length === 0 && !searching ? <p className="movies-hint">No encontré nada con eso.</p> : null}
						<div className="movies-grid">{results.map(card)}</div>
					</>
				) : (
					<>
						{hero ? (
							<section className="movies-hero" style={hero.backdrop ? {backgroundImage: `url("${hero.backdrop}")`} : undefined}>
								<div className="movies-hero-info">
									<h1>{hero.title}</h1>
									{meta(hero)}
									<p className="movies-hero-overview">{hero.overview.slice(0, 260)}</p>
									<div className="movies-hero-actions">
										<button type="button" className="movies-play" onClick={() => setPlaying(hero)}>
											<Play size={18} /> Ver
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
								<h2 className="movies-row-title">{row.title}</h2>
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
							<button type="button" className="movies-play" onClick={() => setPlaying(selected)}>
								<Play size={18} /> Ver
							</button>
						</div>
					</div>
				</div>
			) : null}

			{playing ? <MoviePlayer movie={playing} onClose={() => setPlaying(null)} /> : null}
		</div>
	);
}
