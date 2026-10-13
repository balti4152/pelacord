import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, Copy, Loader2, LogOut, Play, Plus, RefreshCw, TriangleAlert, X} from 'lucide-react';
import {SiSpotify} from 'react-icons/si';
import {type SpotifyPlaylist, type SpotifyStatus, type SpotifyTrack, type TrackResult, getDesktopTransport} from '@/lib/desktop';
import {type MusicTrack} from '@/lib/musicQueue';
import {useStore} from '@/state/store';

/** El verde característico de Spotify. */
export const SPOTIFY_GREEN = '#1ed760';

/** Cuántas canciones se resuelven por vez después de la primera: en tandas, así la cola se llena sola. */
const RESOLVE_CHUNK = 8;
/** La PRIMERA tanda es de una sola: así la música arranca enseguida y no hay que esperar al resto. */
const FIRST_CHUNK = 1;

const SPOTIFY_TRACKS_CACHE_KEY = 'pelacord.spotify.tracks.v1';
const SPOTIFY_LINKS_CACHE_KEY = 'pelacord.spotify.links.v1';

/** Canciones ya leídas, por playlist. Quedan en disco: al volver a abrir están al toque. */
type SpotifyTrackCache = Record<string, {tracks: SpotifyTrack[]; at: number}>;

/**
 * El resultado de YouTube ya resuelto para una canción de Spotify.
 *
 * Se guarda el LINK DEL VIDEO, no la URL directa del audio: esa viene firmada y vence en horas.
 * El link del video no vence, y el audio se pide al momento de reproducir (que es como ya funciona).
 */
interface ResolvedLink {
	id: string;
	url: string;
	thumbnail: string;
	duration: number;
	author: string;
}
type SpotifyLinkCache = Record<string, ResolvedLink>;

/** Clave de una canción de Spotify: así se la reconoce aunque esté en dos playlists distintas. */
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
		// best effort: si se llena, se sigue leyendo online.
	}
}

/**
 * Copia al portapapeles y dice si lo logró.
 *
 * `navigator.clipboard` falla si la ventana no está enfocada ("Document is not focused"), así que
 * se usa la vieja técnica del textarea, que funciona siempre. Es importante no avisar "copiado"
 * cuando no se copió: el usuario pegaría cualquier cosa en el panel de Spotify.
 */
function copyText(value: string): boolean {
	try {
		const area = document.createElement('textarea');
		area.value = value;
		area.setAttribute('readonly', '');
		area.style.position = 'fixed';
		area.style.top = '-1000px';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		area.setSelectionRange(0, value.length);
		const ok = document.execCommand('copy');
		document.body.removeChild(area);
		if (ok) return true;
	} catch {
		// se intenta con la API moderna
	}
	try {
		void navigator.clipboard?.writeText(value).catch(() => {});
		return true;
	} catch {
		return false;
	}
}

/** "3:45" */
function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '';
	const total = Math.floor(seconds);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Spotify: iniciar sesión, ver tus playlists y encolarlas.
 *
 * Ojo con una cosa que no es obvia: Spotify no presta el audio. Lo que se trae es la LISTA
 * (nombre, artistas, duración, portada) y después cada canción se busca en YouTube, que es de
 * donde sale el sonido de la Jam. Por eso "play" tarda un poco: está resolviendo las canciones.
 */
export function SpotifyView({onShowQueue}: {onShowQueue?: () => void}): JSX.Element {
	const {state, musicState, musicPlay, musicEnqueueMany} = useStore();
	const [status, setStatus] = useState<SpotifyStatus | null>(null);
	const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
	const [open, setOpen] = useState<SpotifyPlaylist | null>(null);
	const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
	const [tracksLoading, setTracksLoading] = useState(false);
	const [loading, setLoading] = useState(true);
	const [connecting, setConnecting] = useState(false);
	/** Qué se está resolviendo ahora (id de playlist o "track:<título>"): vacío = nada. */
	const [busy, setBusy] = useState('');
	const [progress, setProgress] = useState({done: 0, total: 0});
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	/** Para cortar una importación larga (se frena al terminar la tanda en curso). */
	const cancelled = useRef(false);
	/** Lo ya leído de cada playlist (sobrevive al reinicio: ver loadTrackCache). */
	const trackCacheRef = useRef<SpotifyTrackCache | null>(null);
	if (!trackCacheRef.current) trackCacheRef.current = loadTrackCache();
	/** El link de YouTube ya resuelto por canción: así no se vuelve a buscar nunca más. */
	const linkCacheRef = useRef<SpotifyLinkCache | null>(null);
	if (!linkCacheRef.current) linkCacheRef.current = loadLinkCache();
	/** Cuántas canciones tiene cada playlist, de lo que ya se leyó. */
	const [cachedCounts, setCachedCounts] = useState<Record<string, number>>(() => {
		const cache = loadTrackCache();
		const counts: Record<string, number> = {};
		for (const [id, entry] of Object.entries(cache)) counts[id] = entry.tracks.length;
		return counts;
	});
	const inVoice = Boolean(state.voice.channelId);
	/** Cuántas canciones sabemos que tiene (de la API o de lo que ya se leyó). */
	const countOf = (playlist: SpotifyPlaylist): number => cachedCounts[playlist.id] ?? (playlist.readable ? playlist.tracks : 0);
	/** Sólo se muestra el paso del panel de Spotify cuando Spotify rechaza la dirección. */
	const needsRedirect = /redirecc|redirect/i.test(error);

	/** Guarda lo leído (en memoria y en disco) para no volver a pedirlo. */
	const remember = useCallback((playlistId: string, list: SpotifyTrack[]) => {
		const cache = trackCacheRef.current ?? {};
		cache[playlistId] = {tracks: list, at: Date.now()};
		trackCacheRef.current = cache;
		saveTrackCache(cache);
		setCachedCounts((counts) => ({...counts, [playlistId]: list.length}));
	}, []);

	const load = useCallback(async (): Promise<void> => {
		const transport = getDesktopTransport();
		if (!transport) {
			setLoading(false);
			setError('Spotify sólo funciona en la app de escritorio.');
			return;
		}
		setLoading(true);
		setError('');
		try {
			const me = await transport.spotifyStatus();
			setStatus(me);
			if (!me.connected) {
				setPlaylists([]);
				return;
			}
			// La cuenta se logueó bien pero no está habilitada: no tiene sentido pedir playlists.
			if (me.blocked) {
				setPlaylists([]);
				setError(me.error ?? 'Tu cuenta no está habilitada para esta app.');
				return;
			}
			const result = await transport.spotifyPlaylists();
			setPlaylists(result.playlists ?? []);
			if (!result.ok) setError(result.error ?? 'No se pudieron traer las playlists.');
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'No se pudieron traer las playlists.');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// OJO: la importación NO se cancela al cerrar o cambiar de vista. Si se cancelara, irte a la
	// pestaña Cola para ver cómo se van agregando cortaría la carga (era justo lo que pasaba).
	// Para cortarla está el botón "Cortar" del progreso.

	async function connect(): Promise<void> {
		const transport = getDesktopTransport();
		if (!transport || connecting) return;
		setConnecting(true);
		setError('');
		setNotice('');
		try {
			const result = await transport.spotifyLogin();
			if (!result.ok) {
				setError(result.error ?? 'No se pudo iniciar sesión.');
				return;
			}
			await load();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'No se pudo iniciar sesión.');
		} finally {
			setConnecting(false);
		}
	}

	async function disconnect(): Promise<void> {
		const transport = getDesktopTransport();
		if (!transport) return;
		await transport.spotifyLogout();
		setStatus({connected: false});
		setPlaylists([]);
		setOpen(null);
		setTracks([]);
		setNotice('');
		setError('');
	}

	/**
	 * Trae las canciones de una playlist, por el camino que funcione.
	 *
	 * Ojo: NO se puede decidir de antemano cuál va a andar. Spotify manda la cantidad de canciones
	 * (`items`) también para playlists ajenas, pero después niega el contenido con 403. Así que se
	 * prueba primero el camino que corresponde y, si Spotify lo niega, se prueba el otro.
	 * Lo leído queda guardado (ver remember), así la próxima vez es instantáneo.
	 */
	async function readTracks(playlist: SpotifyPlaylist): Promise<{ok: boolean; error?: string; tracks: SpotifyTrack[]; fromCache?: boolean}> {
		const cached = trackCacheRef.current?.[playlist.id];
		if (cached && cached.tracks.length > 0) return {ok: true, tracks: cached.tracks, fromCache: true};
		const transport = getDesktopTransport();
		if (!transport) return {ok: false, error: 'Spotify sólo funciona en la app de escritorio.', tracks: []};
		// El de la API sirve para las tuyas; el público, para las de otra cuenta.
		const api = () => transport.spotifyTracks(playlist.id);
		const publico = () => transport.spotifyPublicTracks(playlist.id);
		const attempts = playlist.readable ? [api, publico] : [publico, api];
		let lastError = '';
		for (const attempt of attempts) {
			const result = await attempt();
			if (result.ok) {
				if (result.tracks.length > 0) remember(playlist.id, result.tracks);
				return result;
			}
			if (!lastError) lastError = result.error ?? '';
		}
		return {ok: false, error: lastError || 'No se pudieron leer las canciones de esa playlist.', tracks: []};
	}

	/** Abre una playlist y trae sus canciones (con la portada de cada álbum). */
	async function openPlaylist(playlist: SpotifyPlaylist): Promise<void> {
		setOpen(playlist);
		setTracks([]);
		setError('');
		setNotice('');
		setTracksLoading(true);
		try {
			const result = await readTracks(playlist);
			setTracks(result.tracks ?? []);
			if (!result.ok) setError(result.error ?? 'No se pudieron leer las canciones de esa playlist.');
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'No se pudieron leer las canciones.');
		} finally {
			setTracksLoading(false);
		}
	}

	/** Resuelve UNA tanda de canciones de Spotify en YouTube (de ahí sale el audio).
	 *
	 * Primero mira lo ya resuelto: lo que está en el caché no se vuelve a buscar. Así la segunda
	 * vez que se importa una playlist (o la misma canción en otra) es casi instantáneo.
	 */
	const resolveChunk = useCallback(
		async (chunk: SpotifyTrack[]): Promise<{tracks: MusicTrack[]; missing: number}> => {
			const transport = getDesktopTransport();
			const resolved: MusicTrack[] = [];
			const cache = linkCacheRef.current ?? {};
			const pending: SpotifyTrack[] = [];
			// Lo que ya está resuelto, directo del caché; lo nuevo se junta para buscarlo de una.
			const links: Record<string, ResolvedLink> = {};
			for (const track of chunk) {
				const known = cache[linkKey(track)];
				if (known?.url) links[linkKey(track)] = known;
				else pending.push(track);
			}
			if (!transport) return {tracks: resolved, missing: chunk.length};
			let hits: Array<TrackResult | null> = [];
			if (pending.length > 0) {
				hits = await transport.searchYouTubeBatch(pending.map((track) => `${track.artists} ${track.title}`.trim()));
				// Se guardan los nuevos para no volver a buscarlos nunca más.
				const fresh: SpotifyLinkCache = {};
				pending.forEach((track, offset) => {
					const hit = hits[offset] ?? null;
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
					// El nombre, el artista y la portada salen de Spotify (más limpios que los de YouTube).
					title: track.title || link.id,
					duration: track.duration || link.duration,
					thumbnail: track.image || link.thumbnail,
					author: track.artists || link.author,
					url: link.url,
					addedBy: state.me.name,
				});
			}
			return {tracks: resolved, missing};
		},
		[state.me.name],
	);

	/**
	 * Agrega una lista de canciones a la cola A MEDIDA que se resuelven.
	 *
	 * Clave: NO se espera a resolver todas para encolar. La primera sale sola (tanda de 1) para que
	 * la música arranque enseguida, y el resto entra de a tandas mientras suena.
	 */
	async function importTracks(list: SpotifyTrack[], label: string): Promise<void> {
		if (list.length === 0) {
			setError('No hay canciones para agregar.');
			return;
		}
		cancelled.current = false;
		setError('');
		setNotice('');
		setBusy(label);
		setProgress({done: 0, total: list.length});
		let added = 0;
		let missing = 0;
		// Si ya había algo sonando, todo va a la cola; si no, la primera arranca sola.
		let started = Boolean(musicState.track);
		// OJO con el índice: se avanza por el tamaño de la tanda que REALMENTE se usó, no por el
		// próximo. La primera es de 1 para que arranque enseguida; si se avanzara de a 8, se
		// saltearían 7 canciones (nos pasó: la cola quedaba con la mitad).
		let index = 0;
		try {
			while (index < list.length) {
				if (cancelled.current) break;
				const size = index === 0 ? FIRST_CHUNK : RESOLVE_CHUNK;
				const chunk = list.slice(index, index + size);
				index += chunk.length;
				const resolved = await resolveChunk(chunk);
				if (cancelled.current) break;
				if (resolved.tracks.length > 0) {
					if (started) {
						musicEnqueueMany(resolved.tracks);
					} else {
						started = true;
						const [first, ...rest] = resolved.tracks;
						musicPlay(first);
						if (rest.length > 0) musicEnqueueMany(rest);
					}
					added += resolved.tracks.length;
				}
				missing += resolved.missing;
				setProgress({done: Math.min(index, list.length), total: list.length});
			}
			if (cancelled.current) return;
			if (added === 0) setError('No encontré esas canciones en YouTube.');
			else if (missing > 0) setNotice(`Se agregaron ${added} de ${list.length} canciones (${missing} no estaban en YouTube).`);
			else setNotice(`Se agregaron las ${added} canciones.`);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'No se pudieron agregar las canciones.');
		} finally {
			setBusy('');
			setProgress({done: 0, total: 0});
		}
	}

	/** Trae las canciones de una playlist y las agrega TODAS a la cola (sin abrirla). */
	async function addAllFromPlaylist(playlist: SpotifyPlaylist): Promise<void> {
		if (busy) return;
		if (!inVoice) {
			setError('Unite a un canal de voz para agregar canciones a la cola.');
			return;
		}
		setError('');
		setNotice('');
		setBusy(playlist.id);
		setProgress({done: 0, total: playlist.tracks || 0});
		try {
			const result = await readTracks(playlist);
			if (!result.ok) {
				setError(result.error ?? 'No se pudieron leer las canciones de esa playlist.');
				return;
			}
			await importTracks(result.tracks, playlist.id);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'No se pudieron leer las canciones.');
		} finally {
			setBusy('');
			setProgress({done: 0, total: 0});
		}
	}

	/** Reproduce una canción ahora, o la agrega a la cola. */
	async function one(track: SpotifyTrack, mode: 'play' | 'add'): Promise<void> {
		if (busy) return;
		if (!inVoice) {
			setError('Unite a un canal de voz para escuchar la música.');
			return;
		}
		const label = `track:${track.title}`;
		setError('');
		setNotice('');
		setBusy(label);
		try {
			const resolved = await resolveChunk([track]);
			if (resolved.tracks.length === 0) {
				setError(`No encontré "${track.title}" en YouTube.`);
				return;
			}
			if (mode === 'play') musicPlay(resolved.tracks[0]);
			else {
				musicEnqueueMany([resolved.tracks[0]]);
				setNotice(`"${track.title}" se agregó a la cola.`);
			}
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'No se pudo resolver esa canción.');
		} finally {
			setBusy('');
		}
	}

	if (loading) {
		return (
			<div className="spotify-view">
				<p className="settings-hint">
					<Loader2 size={16} className="music-spin" /> Buscando tu cuenta de Spotify…
				</p>
			</div>
		);
	}

	return (
		<div className="spotify-view">
			{!status?.connected ? (
				<div className="spotify-hero">
					<SiSpotify size={64} color={SPOTIFY_GREEN} />
					<h2>Conectá tu Spotify</h2>
					<p className="settings-hint">
						Iniciás sesión en el navegador y Pelacord te muestra <strong>todas tus playlists</strong>. Al darle
						play a una, sus canciones se agregan a la cola de la Jam.
					</p>
					<button type="button" className="spotify-connect" onClick={() => void connect()} disabled={connecting}>
						{connecting ? <Loader2 size={18} className="music-spin" /> : <SiSpotify size={18} />}
						{connecting ? 'Esperando a Spotify…' : 'Iniciar sesión con Spotify'}
					</button>
					{connecting ? (
						<p className="settings-hint">Se abrió tu navegador: autorizá a Pelacord y volvé a esta ventana.</p>
					) : null}
					{/* El paso del panel sólo se muestra si Spotify rechazó la dirección (ya está registrada). */}
					{needsRedirect && status?.redirectUri ? (
						<div className="spotify-uri">
							<p className="settings-hint">
								En tu panel de Spotify (<strong>Settings → Redirect URIs</strong>) tiene que estar registrada
								esta dirección, <strong>exacta</strong> (Spotify ya no acepta <code>localhost</code>: va la IP):
							</p>
							<div className="spotify-uri-row">
								<code>{status.redirectUri}</code>
								<button
									type="button"
									className="spotify-ghost"
									title="Copiar"
									onClick={() => {
										setNotice(
											copyText(status.redirectUri ?? '')
												? 'Dirección copiada: pegala en Redirect URIs y guardá.'
												: `Copiala a mano (no se pudo usar el portapapeles): ${status.redirectUri}`,
										);
									}}>
									<Copy size={15} />
								</button>
							</div>
						</div>
					) : null}
				</div>
			) : open ? (
				<div className="spotify-detail">
					<div className="spotify-detail-head">
						<button
							type="button"
							className="spotify-ghost"
							title="Volver"
							onClick={() => {
								setOpen(null);
								setTracks([]);
								setError('');
							}}>
							<ArrowLeft size={16} />
						</button>
						{open.image ? <img src={open.image} alt="" /> : <span className="spotify-cover" />}
						<span className="spotify-detail-info">
							<span className="spotify-detail-name" title={open.name}>
								{open.name}
							</span>
							<span className="spotify-row-sub">
								{open.owner ? `${open.owner} · ` : ''}
								{open.readable || cachedCounts[open.id] ? (
									<>
										{countOf(open)} {countOf(open) === 1 ? 'canción' : 'canciones'}
									</>
								) : (
									`de ${open.owner || 'otra cuenta'}`
								)}
							</span>
						</span>
						<button
							type="button"
							className="spotify-play"
							title={inVoice ? 'Agregar todas a la cola' : 'Unite a un canal de voz primero'}
							disabled={Boolean(busy) || !inVoice || tracks.length === 0}
							onClick={() => {
								if (!busy && inVoice) void importTracks(tracks, open.id);
							}}>
							{busy === open.id ? <Loader2 size={16} className="music-spin" /> : <Play size={16} />}
						</button>
					</div>

					{tracksLoading ? (
						<p className="settings-hint">
							<Loader2 size={16} className="music-spin" /> Trayendo las canciones… (las de otra cuenta tardan
							unos segundos)
						</p>
					) : null}
					{busy === open.id ? (
						<div className="spotify-progress">
							<span>
								Agregando a la cola… {progress.done}/{progress.total}
							</span>
							<button
								type="button"
								className="spotify-ghost"
								title="Cortar"
								onClick={() => {
									cancelled.current = true;
								}}>
								<X size={15} />
							</button>
						</div>
					) : null}

					<ul className="spotify-list">
						{tracks.map((track, index) => (
							<li key={`${track.title}-${index}`} className="spotify-row">
								<span className="music-row-index">{index + 1}</span>
								{track.image || open.image ? (
									<img src={track.image || open.image} alt="" loading="lazy" />
								) : (
									<span className="spotify-cover" />
								)}
								<span className="spotify-row-info">
									<span className="spotify-row-title" title={track.title}>
										{track.title}
									</span>
									<span className="spotify-row-sub">
										{track.artists}
										{formatDuration(track.duration) ? ` · ${formatDuration(track.duration)}` : ''}
									</span>
								</span>
								<button
									type="button"
									className="spotify-ghost"
									title="Agregar a la cola"
									disabled={Boolean(busy) || !inVoice}
									onClick={() => void one(track, 'add')}>
									<Plus size={15} />
								</button>
								<button
									type="button"
									className="spotify-play"
									title={inVoice ? 'Reproducir ahora para todos' : 'Unite a un canal de voz primero'}
									disabled={Boolean(busy) || !inVoice}
									onClick={() => void one(track, 'play')}>
									{busy === `track:${track.title}` ? <Loader2 size={15} className="music-spin" /> : <Play size={15} />}
								</button>
							</li>
						))}
					</ul>
				</div>
			) : (
				<>
					<div className="spotify-profile">
						<SiSpotify size={26} color={SPOTIFY_GREEN} />
						{status.image ? <img src={status.image} alt="" /> : null}
						<span className="spotify-profile-name">{status.name || 'Tu cuenta'}</span>
						<button type="button" className="spotify-ghost" onClick={() => void load()} title="Actualizar playlists">
							<RefreshCw size={15} />
						</button>
						<button type="button" className="spotify-ghost" onClick={() => void disconnect()} title="Cerrar sesión">
							<LogOut size={15} />
						</button>
					</div>

					{!inVoice ? <p className="settings-hint">Unite a un canal de voz para agregar canciones a la cola.</p> : null}

					{playlists.length === 0 && !error ? <p className="settings-hint">No tenés playlists en esta cuenta.</p> : null}
					{playlists.length > 0 ? (
						<ul className="spotify-list">
							{playlists.map((playlist) => (
								<li
									key={playlist.id}
									className="spotify-row is-clickable"
									title="Ver las canciones"
									onClick={() => void openPlaylist(playlist)}>
									{playlist.image ? <img src={playlist.image} alt="" loading="lazy" /> : <span className="spotify-cover" />}
									<span className="spotify-row-info">
										<span className="spotify-row-title" title={playlist.name}>
											{playlist.name}
										</span>
										<span className="spotify-row-sub">
											{playlist.owner ? `${playlist.owner} · ` : ''}
											{playlist.readable || cachedCounts[playlist.id] ? (
												<>
													{countOf(playlist)} {countOf(playlist) === 1 ? 'canción' : 'canciones'}
												</>
											) : (
												'de otra cuenta · tocá para ver las canciones'
											)}
										</span>
									</span>
									<button
										type="button"
										className="spotify-play"
										title={inVoice ? 'Agregar todas a la cola' : 'Unite a un canal de voz primero'}
										disabled={Boolean(busy) || !inVoice}
										onClick={(event) => {
											// El clic de la fila abre la playlist: este botón agrega todo a la cola.
											event.stopPropagation();
											void addAllFromPlaylist(playlist);
										}}>
										<Play size={16} />
									</button>
								</li>
							))}
						</ul>
					) : null}
				</>
			)}

			{error ? (
				<p className="spotify-error">
					<TriangleAlert size={15} /> {error}
				</p>
			) : null}
			{notice ? (
				<p className="spotify-notice">
					{notice}
					{onShowQueue ? (
						<button type="button" className="spotify-link" onClick={onShowQueue}>
							Ver la cola
						</button>
					) : null}
				</p>
			) : null}
		</div>
	);
}
