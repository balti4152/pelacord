/**
 * Proveedor de GIFs: KLIPY (https://klipy.com).
 *
 * Antes era GIPHY. Se usan las URLs que devuelve la API tal cual (los requisitos de KLIPY piden no
 * alterarlas) y las imágenes se cargan directo desde su CDN.
 *
 * Endpoints usados:
 *   GET api/v1/{app_key}/gifs/trending
 *   GET api/v1/{app_key}/gifs/search
 */
const KLIPY_APP_KEY = 'TJTlZtAoZ0uSOtRcBj7tGZZvXxIPCpuH5iE7S87nfTqPdyz3CCCv9lXYcgB0v3vY';
const KLIPY_BASE = 'https://api.klipy.com/api/v1';

export interface GifResult {
	id: string;
	/** Lo que se manda al chat (link directo al GIF). */
	url: string;
	/** Miniatura liviana para la grilla. */
	preview: string;
	width: number;
	height: number;
	title: string;
}

interface KlipyFile {
	url?: string;
	width?: number;
	height?: number;
}

interface KlipyItem {
	id?: number | string;
	slug?: string;
	title?: string;
	file?: Record<string, Record<string, KlipyFile>>;
}

/** Id estable del usuario para KLIPY (no manda datos personales, sólo un identificador). */
function customerId(): string {
	try {
		const raw = localStorage.getItem('pelacord.identity');
		const parsed = raw ? (JSON.parse(raw) as {id?: string}) : null;
		if (parsed?.id) return parsed.id;
	} catch {
		// sin identidad guardada: se usa el valor por defecto
	}
	return 'pelacord-guest';
}

/**
 * Busca GIFs, o trae los de tendencia si no hay búsqueda.
 *
 * Se elige `md` para mandar (buen tamaño sin ser los 4 MB del `hd`) y `sm` para la grilla.
 * `page` sirve para el scroll infinito de la grilla.
 */
export async function fetchGifs(query: string, page = 1, perPage = 24): Promise<{gifs: GifResult[]; hasNext: boolean}> {
	const trimmed = query.trim();
	const endpoint = trimmed ? 'search' : 'trending';
	const params = new URLSearchParams({
		page: String(Math.max(1, page)),
		per_page: String(perPage),
		customer_id: customerId(),
		locale: 'es_AR',
		content_filter: 'medium',
	});
	if (trimmed) params.set('q', trimmed);
	const response = await fetch(`${KLIPY_BASE}/${KLIPY_APP_KEY}/gifs/${endpoint}?${params.toString()}`);
	if (!response.ok) throw new Error(`KLIPY ${response.status}`);
	const json = (await response.json()) as {data?: {data?: KlipyItem[]; has_next?: boolean}};
	const items = json.data?.data ?? [];
	const gifs = items
		.map((item) => {
			const preview = item.file?.sm?.webp ?? item.file?.sm?.gif ?? item.file?.xs?.webp ?? item.file?.xs?.gif;
			const full = item.file?.md?.gif ?? item.file?.hd?.gif ?? item.file?.sm?.gif;
			return {
				id: String(item.slug ?? item.id ?? ''),
				url: full?.url ?? preview?.url ?? '',
				preview: preview?.url ?? full?.url ?? '',
				width: preview?.width ?? 220,
				height: preview?.height ?? 220,
				title: item.title ?? '',
			};
		})
		.filter((gif) => gif.url.length > 0 && gif.preview.length > 0);
	return {gifs, hasNext: Boolean(json.data?.has_next)};
}

// ---------- Favoritos (se guardan en el equipo, no en un servidor) ----------

const FAVORITES_KEY = 'pelacord.gifFavorites';

export function loadGifFavorites(): GifResult[] {
	try {
		const raw = localStorage.getItem(FAVORITES_KEY);
		const parsed = raw ? (JSON.parse(raw) as GifResult[]) : [];
		return Array.isArray(parsed) ? parsed.filter((gif) => gif && typeof gif.url === 'string') : [];
	} catch {
		return [];
	}
}

function saveGifFavorites(favorites: GifResult[]): void {
	try {
		localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
	} catch {
		// sin espacio o bloqueado: se ignora
	}
}

/** Agrega o saca un GIF de favoritos y devuelve la lista nueva. */
export function toggleGifFavorite(gif: GifResult): GifResult[] {
	const current = loadGifFavorites();
	const exists = current.some((item) => item.id === gif.id || item.url === gif.url);
	const next = exists ? current.filter((item) => item.id !== gif.id && item.url !== gif.url) : [gif, ...current];
	saveGifFavorites(next);
	return next;
}
