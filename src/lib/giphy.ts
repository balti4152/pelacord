const GIPHY_API_KEY = 'w9YxVfNL6QufTWHESrAA8yNXcPrVLE1Z';

export interface GifResult {
	id: string;
	url: string;
	preview: string;
	width: number;
	height: number;
	title: string;
}

interface GiphyImage {
	url?: string;
	width?: string;
	height?: string;
}

interface GiphyItem {
	id: string;
	title?: string;
	images?: {
		original?: GiphyImage;
		fixed_height?: GiphyImage;
		fixed_height_small?: GiphyImage;
		fixed_width?: GiphyImage;
	};
}

/** Busca o trae los GIFs en tendencia de Giphy. */
export async function fetchGifs(query: string, limit = 30): Promise<GifResult[]> {
	const trimmed = query.trim();
	const endpoint = trimmed ? 'search' : 'trending';
	const params = new URLSearchParams({api_key: GIPHY_API_KEY, limit: String(limit), rating: 'pg-13'});
	if (trimmed) params.set('q', trimmed);
	const response = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`);
	if (!response.ok) throw new Error(`Giphy ${response.status}`);
	const json = (await response.json()) as {data?: GiphyItem[]};
	return (json.data ?? [])
		.map((item) => {
			const preview = item.images?.fixed_height_small ?? item.images?.fixed_height ?? item.images?.original;
			const full = item.images?.original ?? item.images?.fixed_height;
			const width = Number(preview?.width) || 200;
			const height = Number(preview?.height) || 200;
			return {
				id: item.id,
				url: full?.url ?? preview?.url ?? '',
				preview: preview?.url ?? full?.url ?? '',
				width,
				height,
				title: item.title ?? '',
			};
		})
		.filter((gif) => gif.url.length > 0);
}
