import {useCallback, useRef, useState} from 'react';
import {type SpotifyPlaylist, type SpotifyTrack, type TrackResult, getDesktopTransport} from '@/lib/desktop';
import {type MusicTrack} from '@/lib/musicQueue';
import {useStore} from '@/state/store';

/**
 * Resolver canciones de Spotify en YouTube y encolarlas.
 *
 * Vive acá (y no adentro de una vista) porque lo usan dos lugares: la pestaña de Spotify (tus
 * playlists) y el buscador (las playlists destacadas). Así el comportamiento es el mismo en los
 * dos: encolado PROGRESIVO (arranca con la primera y el resto entra mientras suena) y caché de
 * links (lo ya resuelto no se vuelve a buscar).
 */

const SPOTIFY_LINKS_CACHE_KEY = 'pelacord.spotify.links.v1';
const SPOTIFY_TRACKS_CACHE_KEY = 'pelacord.spotify.tracks.v1';

/** Canciones ya leídas, por playlist. Quedan en disco: al volver a abrir están al toque. */
type SpotifyTrackCache = Record<string, {tracks: SpotifyTrack[]; at: number}>;

function loadTrackCache(): SpotifyTrackCache {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(SPOTIFY_TRACKS_CACHE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as SpotifyTrackCache;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function saveTrackCache(cache: SpotifyTrackCache): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(SPOTIFY_TRACKS_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// best effort
	}
}

/** Cuántas canciones se resuelven por vez después de la primera. */
const RESOLVE_CHUNK = 8;
/** La PRIMERA tanda es de una sola: así la música arranca enseguida y no hay que esperar al resto. */
const FIRST_CHUNK = 1;

/**
 * El resultado de YouTube ya resuelto para una canción.
 *
 * Se guarda el LINK DEL VIDEO, no la URL directa del audio: esa viene firmada y vence en horas.
 * El link del video no vence, y el audio se pide al momento de reproducir.
 */
interface ResolvedLink {
	id: string;
	url: string;
	thumbnail: string;
	duration: number;
	author: string;
}
type SpotifyLinkCache = Record<string, ResolvedLink>;

/** Clave de una canción: así se la reconoce aunque esté en dos playlists distintas. */
function linkKey(track: SpotifyTrack): string {
	return `${track.artists} ${track.title}`.trim().toLowerCase();
}

function loadLinkCache(): SpotifyLinkCache {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(SPOTIFY_LINKS_CACHE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as SpotifyLinkCache;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function saveLinkCache(cache: SpotifyLinkCache): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(SPOTIFY_LINKS_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// best effort
	}
}

export interface SpotifyImport {
	/** Qué se está resolviendo ahora ("<id de playlist>" o "track:<título>"): vacío = nada. */
	busy: string;
	progress: {done: number; total: number};
	error: string;
	notice: string;
	setError: (value: string) => void;
	setNotice: (value: string) => void;
	/** Cuántas canciones tiene cada playlist, de lo que ya se leyó antes. */
	cachedCounts: Record<string, number>;
	/**
	 * Trae las canciones de una playlist, por el camino que funcione.
	 *
	 * Ojo: no se puede saber de antemano cuál va a andar. Spotify manda la cantidad de canciones
	 * también para playlists ajenas, pero después niega el contenido con 403. Así que se prueba el
	 * camino que corresponde y, si Spotify lo niega, se prueba el otro (el embed público).
	 */
	readTracks: (playlist: SpotifyPlaylist) => Promise<{ok: boolean; error?: string; tracks: SpotifyTrack[]; fromCache?: boolean}>;
	/** Agrega una lista a la cola a medida que se resuelve. */
	importTracks: (list: SpotifyTrack[], label: string) => Promise<void>;
	/** Reproduce una canción ahora o la encola. */
	one: (track: SpotifyTrack, mode: 'play' | 'add') => Promise<void>;
	/** Corta una importación larga (se frena al terminar la tanda en curso). */
	cancel: () => void;
	isBusy: () => boolean;
}

export function useSpotifyImport(): SpotifyImport {
	const {state, musicState, musicPlay, musicEnqueueMany} = useStore();
	const [busy, setBusy] = useState('');
	const [progress, setProgress] = useState({done: 0, total: 0});
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const cancelled = useRef(false);
	const busyRef = useRef(false);
	const linkCacheRef = useRef<SpotifyLinkCache | null>(null);
	if (!linkCacheRef.current) linkCacheRef.current = loadLinkCache();
	const trackCacheRef = useRef<SpotifyTrackCache | null>(null);
	if (!trackCacheRef.current) trackCacheRef.current = loadTrackCache();
	/** Cuántas canciones tiene cada playlist, de lo ya leído. */
	const [cachedCounts, setCachedCounts] = useState<Record<string, number>>(() => {
		const cache = loadTrackCache();
		const counts: Record<string, number> = {};
		for (const [id, entry] of Object.entries(cache)) counts[id] = entry.tracks.length;
		return counts;
	});

	/** Guarda lo leído (en memoria y en disco) para no volver a pedirlo. */
	const rememberTracks = useCallback((playlistId: string, tracks: SpotifyTrack[]) => {
		const cache = trackCacheRef.current ?? {};
		cache[playlistId] = {tracks, at: Date.now()};
		trackCacheRef.current = cache;
		saveTrackCache(cache);
		setCachedCounts((counts) => ({...counts, [playlistId]: tracks.length}));
	}, []);

	/** Trae las canciones de una playlist, por el camino que funcione (ver el tipo). */
	const readTracks = useCallback(
		async (playlist: SpotifyPlaylist): Promise<{ok: boolean; error?: string; tracks: SpotifyTrack[]; fromCache?: boolean}> => {
			const cached = trackCacheRef.current?.[playlist.id];
			if (cached && cached.tracks.length > 0) return {ok: true, tracks: cached.tracks, fromCache: true};
			const transport = getDesktopTransport();
			if (!transport) return {ok: false, error: 'Spotify sólo funciona en la app de escritorio.', tracks: []};
			const api = () => transport.spotifyTracks(playlist.id);
			const publico = () => transport.spotifyPublicTracks(playlist.id);
			const attempts = playlist.readable ? [api, publico] : [publico, api];
			let lastError = '';
			for (const attempt of attempts) {
				const result = await attempt();
				if (result.ok) {
					if (result.tracks.length > 0) rememberTracks(playlist.id, result.tracks);
					return result;
				}
				if (!lastError) lastError = result.error ?? '';
			}
			return {ok: false, error: lastError || 'No se pudieron leer las canciones de esa playlist.', tracks: []};
		},
		[rememberTracks],
	);

	/** Resuelve UNA tanda de canciones de Spotify en YouTube (de ahí sale el audio). */
	const resolveChunk = useCallback(
		async (chunk: SpotifyTrack[]): Promise<{tracks: MusicTrack[]; missing: number}> => {
			const transport = getDesktopTransport();
			const resolved: MusicTrack[] = [];
			const cache = linkCacheRef.current ?? {};
			const pending: SpotifyTrack[] = [];
			// Lo ya resuelto sale del caché; lo nuevo se junta para buscarlo de una sola vez.
			const links: Record<string, ResolvedLink> = {};
			for (const track of chunk) {
				const known = cache[linkKey(track)];
				if (known?.url) links[linkKey(track)] = known;
				else pending.push(track);
			}
			if (!transport) return {tracks: resolved, missing: chunk.length};
			if (pending.length > 0) {
				const hits = await transport.searchYouTubeBatch(pending.map((track) => `${track.artists} ${track.title}`.trim()));
				const fresh: SpotifyLinkCache = {};
				pending.forEach((track, offset) => {
					const hit: TrackResult | null = hits[offset] ?? null;
					if (!hit) return;
					const link: ResolvedLink = {
						id: hit.id,
						url: hit.url,
						thumbnail: hit.thumbnail,
						duration: hit.duration,
						author: hit.author,
					};
					fresh[linkKey(track)] = link;
					links[linkKey(track)] = link;
				});
				if (Object.keys(fresh).length > 0) {
					const merged = {...cache, ...fresh};
					linkCacheRef.current = merged;
					saveLinkCache(merged);
				}
			}
			// Se arma EN EL ORDEN de la playlist (el caché no tiene por qué respetarlo).
			let missing = 0;
			for (const track of chunk) {
				const link = links[linkKey(track)];
				if (!link) {
					missing += 1;
					continue;
				}
				resolved.push({
					id: link.id,
					title: track.title,
					duration: track.duration || link.duration,
					thumbnail: track.image || link.thumbnail,
					author: track.artists || link.author,
					url: link.url,
					addedBy: '', // se completa abajo con el nombre del que agrega
				});
			}
			return {tracks: resolved, missing};
		},
		[],
	);

	/** Agrega una lista de canciones a la cola a medida que se resuelven. */
	const importTracks = useCallback(
		async (list: SpotifyTrack[], label: string): Promise<void> => {
			if (list.length === 0) {
				setError('No hay canciones para agregar.');
				return;
			}
			cancelled.current = false;
			busyRef.current = true;
			setError('');
			setNotice('');
			setBusy(label);
			setProgress({done: 0, total: list.length});
			const addedBy = state.me.name;
			let added = 0;
			let missing = 0;
			let started = Boolean(musicState.track);
			// OJO con el índice: se avanza por el tamaño de la tanda que REALMENTE se usó, no por el
			// próximo. La primera es de 1 para que arranque enseguida; avanzar de a 8 saltearía canciones.
			let index = 0;
			try {
				while (index < list.length) {
					if (cancelled.current) break;
					const size = index === 0 ? FIRST_CHUNK : RESOLVE_CHUNK;
					const chunk = list.slice(index, index + size);
					index += chunk.length;
					const resolved = await resolveChunk(chunk);
					if (cancelled.current) break;
					const tracks = resolved.tracks.map((track) => ({...track, addedBy}));
					if (tracks.length > 0) {
						if (started) {
							musicEnqueueMany(tracks);
						} else {
							started = true;
							const [first, ...rest] = tracks;
							musicPlay(first);
							if (rest.length > 0) musicEnqueueMany(rest);
						}
						added += tracks.length;
					}
					missing += resolved.missing;
					setProgress({done: Math.min(index, list.length), total: list.length});
				}
				if (cancelled.current) return;
				if (added === 0) setError('No encontré esas canciones en YouTube.');
				else if (missing > 0) setNotice(`Se agregaron ${added} de ${list.length} canciones (${missing} no estaban en YouTube).`);
				else setNotice(`Se agregaron las ${added} canciones a la cola.`);
			} catch (failure) {
				setError(failure instanceof Error ? failure.message : 'No se pudieron agregar las canciones.');
			} finally {
				busyRef.current = false;
				setBusy('');
				setProgress({done: 0, total: 0});
			}
		},
		[musicEnqueueMany, musicPlay, musicState.track, resolveChunk, state.me.name],
	);

	/** Reproduce una canción ahora, o la agrega a la cola. */
	const one = useCallback(
		async (track: SpotifyTrack, mode: 'play' | 'add'): Promise<void> => {
			if (busyRef.current) return;
			const label = `track:${track.title}`;
			busyRef.current = true;
			setError('');
			setNotice('');
			setBusy(label);
			try {
				const resolved = await resolveChunk([track]);
				if (resolved.tracks.length === 0) {
					setError(`No encontré "${track.title}" en YouTube.`);
					return;
				}
				const song: MusicTrack = {...resolved.tracks[0], addedBy: state.me.name};
				if (mode === 'play') musicPlay(song);
				else {
					musicEnqueueMany([song]);
					setNotice(`"${track.title}" se agregó a la cola.`);
				}
			} catch (failure) {
				setError(failure instanceof Error ? failure.message : 'No se pudo resolver esa canción.');
			} finally {
				busyRef.current = false;
				setBusy('');
			}
		},
		[musicEnqueueMany, musicPlay, resolveChunk, state.me.name],
	);

	const cancel = useCallback(() => {
		cancelled.current = true;
	}, []);
	const isBusy = useCallback(() => busyRef.current, []);

	return {busy, progress, error, notice, setError, setNotice, cachedCounts, readTracks, importTracks, one, cancel, isBusy};
}
