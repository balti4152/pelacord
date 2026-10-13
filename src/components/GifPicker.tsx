import {useEffect, useRef, useState} from 'react';
import {Icon} from '@/components/primitives';
import {type GifResult, fetchGifs, loadGifFavorites, toggleGifFavorite} from '@/lib/klipy';

export function GifPicker({onSelect, onClose}: {onSelect: (gif: GifResult) => void; onClose: () => void}): JSX.Element {
	const [query, setQuery] = useState('');
	const [gifs, setGifs] = useState<GifResult[]>([]);
	const [favorites, setFavorites] = useState<GifResult[]>(() => loadGifFavorites());
	const [showFavorites, setShowFavorites] = useState(false);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasNext, setHasNext] = useState(false);
	const page = useRef(1);
	const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
	const gridRef = useRef<HTMLDivElement>(null);

	// Primera página: al abrir y cada vez que cambia la búsqueda.
	useEffect(() => {
		let active = true;
		const run = async () => {
			setLoading(true);
			setError(null);
			page.current = 1;
			try {
				const result = await fetchGifs(query, 1);
				if (!active) return;
				setGifs(result.gifs);
				setHasNext(result.hasNext);
			} catch {
				if (!active) return;
				setGifs([]);
				setHasNext(false);
				setError('No se pudieron cargar los GIFs.');
			} finally {
				if (active) setLoading(false);
			}
		};
		void run();
		return () => {
			active = false;
		};
	}, [query]);

	/** Página siguiente: se pide al llegar casi al final de la grilla. */
	async function loadMore(): Promise<void> {
		if (loadingMore || loading || !hasNext || showFavorites) return;
		setLoadingMore(true);
		const next = page.current + 1;
		try {
			const result = await fetchGifs(query, next);
			page.current = next;
			// Se agrega al final, salteando los que ya estaban (la API puede repetir alguno).
			setGifs((prev) => {
				const vistos = new Set(prev.map((gif) => gif.id));
				return [...prev, ...result.gifs.filter((gif) => !vistos.has(gif.id))];
			});
			setHasNext(result.hasNext);
		} catch {
			setHasNext(false);
		} finally {
			setLoadingMore(false);
		}
	}

	function onScroll(): void {
		const grid = gridRef.current;
		if (!grid) return;
		// 300px antes del final ya se pide la próxima.
		if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 300) void loadMore();
	}

	function onSearch(value: string): void {
		if (debounce.current) clearTimeout(debounce.current);
		debounce.current = setTimeout(() => {
			setShowFavorites(false);
			setQuery(value);
		}, 350);
	}

	/** Estrella de la esquina: guarda o saca el GIF de favoritos sin mandarlo. */
	function onStar(event: {stopPropagation: () => void}, gif: GifResult): void {
		event.stopPropagation();
		setFavorites(toggleGifFavorite(gif));
	}

	const isFavorite = (gif: GifResult): boolean =>
		favorites.some((item) => item.id === gif.id || item.url === gif.url);

	const list = showFavorites ? favorites : gifs;

	return (
		<>
			<div className="gif-backdrop" onClick={onClose} />
			<div className="gif-picker" onClick={(event) => event.stopPropagation()}>
				<input
					className="input gif-search"
					placeholder="Buscar en KLIPY…"
					autoFocus
					onChange={(event) => onSearch(event.target.value)}
				/>
				<div className="gif-grid" ref={gridRef} onScroll={onScroll}>
					{/* Primer cuadro: favoritos. */}
					<button
						type="button"
						className={`gif-item gif-favorites-cell${showFavorites ? ' is-active' : ''}`}
						onClick={() => setShowFavorites((value) => !value)}
						title="Ver tus GIFs favoritos">
						<Icon name="star" size={22} />
						<span>Favoritos</span>
						{favorites.length > 0 ? <span className="gif-favorites-count">{favorites.length}</span> : null}
					</button>

					{!showFavorites && loading ? <p className="settings-hint">Cargando…</p> : null}
					{!showFavorites && error ? <p className="settings-hint">{error}</p> : null}
					{!showFavorites && !loading && !error && gifs.length === 0 ? (
						<p className="settings-hint">Sin resultados.</p>
					) : null}
					{showFavorites && favorites.length === 0 ? (
						<p className="settings-hint">Todavía no guardaste ninguno. Pasá el mouse por un GIF y tocá la estrella.</p>
					) : null}

					{list.map((gif) => (
						<button type="button" key={gif.id} className="gif-item" onClick={() => onSelect(gif)} title={gif.title}>
							<img src={gif.preview} alt={gif.title} loading="lazy" />
							<span
								className={`gif-fav${isFavorite(gif) ? ' is-fav' : ''}`}
								role="button"
								tabIndex={0}
								title={isFavorite(gif) ? 'Sacar de favoritos' : 'Guardar en favoritos'}
								onClick={(event) => onStar(event, gif)}
								onKeyDown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') onStar(event, gif);
								}}>
								<Icon name="star" size={14} />
							</span>
						</button>
					))}

					{!showFavorites && loadingMore ? <p className="settings-hint">Cargando más…</p> : null}
				</div>
				<span className="gif-credit">Powered by KLIPY</span>
			</div>
		</>
	);
}
