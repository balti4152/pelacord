import {useEffect, useRef, useState} from 'react';
import {type GifResult, fetchGifs} from '@/lib/giphy';

export function GifPicker({onSelect, onClose}: {onSelect: (gif: GifResult) => void; onClose: () => void}): JSX.Element {
	const [query, setQuery] = useState('');
	const [gifs, setGifs] = useState<GifResult[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		let active = true;
		const run = async () => {
			setLoading(true);
			setError(null);
			try {
				const results = await fetchGifs(query);
				if (active) setGifs(results);
			} catch {
				if (active) {
					setGifs([]);
					setError('No se pudieron cargar los GIFs.');
				}
			} finally {
				if (active) setLoading(false);
			}
		};
		void run();
		return () => {
			active = false;
		};
	}, [query]);

	function onSearch(value: string): void {
		if (debounce.current) clearTimeout(debounce.current);
		debounce.current = setTimeout(() => setQuery(value), 350);
	}

	return (
		<>
			<div className="gif-backdrop" onClick={onClose} />
			<div className="gif-picker" onClick={(event) => event.stopPropagation()}>
				<input
					className="input gif-search"
					placeholder="Buscar en GIPHY…"
					autoFocus
					onChange={(event) => onSearch(event.target.value)}
				/>
				<div className="gif-grid">
					{loading ? <p className="settings-hint">Cargando…</p> : null}
					{error ? <p className="settings-hint">{error}</p> : null}
					{!loading && !error && gifs.length === 0 ? <p className="settings-hint">Sin resultados.</p> : null}
					{gifs.map((gif) => (
						<button type="button" key={gif.id} className="gif-item" onClick={() => onSelect(gif)} title={gif.title}>
							<img src={gif.preview} alt={gif.title} loading="lazy" />
						</button>
					))}
				</div>
				<span className="gif-credit">Powered by GIPHY</span>
			</div>
		</>
	);
}
