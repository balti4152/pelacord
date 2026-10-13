import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, Copy, Loader2, LogOut, Play, Plus, RefreshCw, TriangleAlert, X} from 'lucide-react';
import {SiSpotify} from 'react-icons/si';
import {type SpotifyPlaylist, type SpotifyStatus, type SpotifyTrack, type TrackResult, getDesktopTransport} from '@/lib/desktop';
import {type MusicTrack} from '@/lib/musicQueue';
import {useStore} from '@/state/store';

/** El verde característico de Spotify. */
export const SPOTIFY_GREEN = '#1ed760';

/** Cuántas canciones se resuelven por vez: en tandas, así la cola se va llenando sola. */
const RESOLVE_CHUNK = 8;

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
export function SpotifyView(): JSX.Element {
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
	const inVoice = Boolean(state.voice.channelId);
	/** Sólo se muestra el paso del panel de Spotify cuando Spotify rechaza la dirección. */
	const needsRedirect = /redirecc|redirect/i.test(error);

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

	// Al cerrar la vista no se sigue bajando una playlist de 200 canciones.
	useEffect(
		() => () => {
			cancelled.current = true;
		},
		[],
	);

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

	/** Abre una playlist y trae sus canciones (con la portada de cada álbum). */
	async function openPlaylist(playlist: SpotifyPlaylist): Promise<void> {
		const transport = getDesktopTransport();
		if (!transport) return;
		setOpen(playlist);
		setTracks([]);
		setError('');
		setNotice('');
		setTracksLoading(true);
		try {
			const result = await transport.spotifyTracks(playlist.id);
			setTracks(result.tracks ?? []);
			if (!result.ok) setError(result.error ?? 'No se pudieron leer las canciones de esa playlist.');
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'No se pudieron leer las canciones.');
		} finally {
			setTracksLoading(false);
		}
	}

	/**
	 * Resuelve canciones de Spotify en YouTube (de ahí sale el audio) y arma los temas de la Jam.
	 * Se hace en tandas: una sola corrida por tanda y la cola se va llenando mientras tanto.
	 */
	const resolve = useCallback(
		async (list: SpotifyTrack[], onProgress: (done: number, total: number) => void): Promise<{batch: MusicTrack[]; missing: number}> => {
			const transport = getDesktopTransport();
			const batch: MusicTrack[] = [];
			let missing = 0;
			if (!transport) return {batch, missing: list.length};
			for (let index = 0; index < list.length; index += RESOLVE_CHUNK) {
				if (cancelled.current) break;
				const chunk = list.slice(index, index + RESOLVE_CHUNK);
				const hits = await transport.searchYouTubeBatch(chunk.map((track) => `${track.artists} ${track.title}`.trim()));
				chunk.forEach((track, offset) => {
					const hit: TrackResult | null = hits[offset] ?? null;
					if (!hit) {
						missing += 1;
						return;
					}
					batch.push({
						id: hit.id,
						// El nombre, el artista y la portada salen de Spotify (más limpios que los de YouTube).
						title: track.title || hit.title,
						duration: track.duration || hit.duration,
						thumbnail: track.image || hit.thumbnail,
						author: track.artists || hit.author,
						url: hit.url,
						addedBy: state.me.name,
					});
				});
				onProgress(Math.min(index + chunk.length, list.length), list.length);
			}
			return {batch, missing};
		},
		[state.me.name],
	);

	/** Agrega una lista de canciones a la cola (el que llama ya se ocupó de estar libre y en llamada). */
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
		try {
			const {batch, missing} = await resolve(list, (done, total) => setProgress({done, total}));
			if (cancelled.current) return;
			if (batch.length > 0) {
				if (musicState.track) {
					musicEnqueueMany(batch);
				} else {
					// Si no había nada sonando, arranca la primera: la pestaña Cola no tiene botón de
					// play, así que si no, la cola quedaría llena y sin forma de hacerla sonar.
					const [first, ...rest] = batch;
					musicPlay(first);
					if (rest.length > 0) musicEnqueueMany(rest);
				}
			}
			if (batch.length === 0) setError('No encontré esas canciones en YouTube.');
			else if (missing > 0) setNotice(`Se agregaron ${batch.length} de ${list.length} canciones (${missing} no estaban en YouTube).`);
			else setNotice(`Se agregaron las ${batch.length} canciones${musicState.track ? ' a la cola' : ' y arrancó la primera'}.`);
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
		const transport = getDesktopTransport();
		if (!transport) return;
		if (!inVoice) {
			setError('Unite a un canal de voz para agregar canciones a la cola.');
			return;
		}
		setError('');
		setNotice('');
		setBusy(playlist.id);
		setProgress({done: 0, total: playlist.tracks || 0});
		try {
			const result = await transport.spotifyTracks(playlist.id);
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
			const {batch} = await resolve([track], () => {});
			if (batch.length === 0) {
				setError(`No encontré "${track.title}" en YouTube.`);
				return;
			}
			if (mode === 'play') musicPlay(batch[0]);
			else {
				musicEnqueueMany([batch[0]]);
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
								{open.readable ? `${open.tracks} ${open.tracks === 1 ? 'canción' : 'canciones'}` : 'sólo las tuyas se pueden leer'}
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
							<Loader2 size={16} className="music-spin" /> Trayendo las canciones…
						</p>
					) : null}
					{busy === open.id ? (
						<div className="spotify-progress">
							<span>
								Agregando canciones… {progress.done}/{progress.total}
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
								{track.image ? <img src={track.image} alt="" loading="lazy" /> : <span className="spotify-cover" />}
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
											{playlist.readable
												? `${playlist.tracks} ${playlist.tracks === 1 ? 'canción' : 'canciones'}`
												: 'sólo las tuyas se pueden leer'}
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
			{notice ? <p className="spotify-notice">{notice}</p> : null}
		</div>
	);
}
