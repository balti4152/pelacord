import {useCallback, useEffect, useRef, useState} from 'react';
import {Copy, Loader2, LogOut, Play, RefreshCw, TriangleAlert, X} from 'lucide-react';
import {SiSpotify} from 'react-icons/si';
import {type SpotifyPlaylist, type SpotifyStatus, getDesktopTransport} from '@/lib/desktop';
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

/**
 * Spotify: iniciar sesión y traer tus playlists.
 *
 * Ojo con una cosa que no es obvia: Spotify no presta el audio. Lo que se trae es la LISTA
 * (nombre, artistas, duración) y después cada canción se busca en YouTube, que es de donde sale
 * el sonido de la Jam. Por eso "play" tarda un poco: está resolviendo las canciones.
 */
export function SpotifyView(): JSX.Element {
	const {state, musicState, musicPlay, musicEnqueueMany} = useStore();
	const [status, setStatus] = useState<SpotifyStatus | null>(null);
	const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
	const [loading, setLoading] = useState(true);
	const [connecting, setConnecting] = useState(false);
	const [importing, setImporting] = useState('');
	const [progress, setProgress] = useState({done: 0, total: 0});
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	/** Para cortar una importación larga (se frena al terminar la tanda en curso). */
	const cancelled = useRef(false);
	const inVoice = Boolean(state.voice.channelId);

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
			const result = await transport.spotifyPlaylists();
			if (!result.ok) {
				setError(result.error ?? 'No se pudieron traer las playlists.');
				return;
			}
			setPlaylists(result.playlists);
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
		setNotice('');
		setError('');
	}

	async function importPlaylist(playlist: SpotifyPlaylist): Promise<void> {
		const transport = getDesktopTransport();
		if (!transport || importing) return;
		if (!inVoice) {
			setError('Unite a un canal de voz para agregar canciones a la cola.');
			return;
		}
		cancelled.current = false;
		setError('');
		setNotice('');
		setImporting(playlist.id);
		setProgress({done: 0, total: playlist.tracks || 0});
		try {
			const result = await transport.spotifyTracks(playlist.id);
			if (!result.ok) {
				setError(result.error ?? 'No se pudo leer la playlist.');
				return;
			}
			if (result.tracks.length === 0) {
				setError('Esa playlist no tiene canciones.');
				return;
			}
			const total = result.tracks.length;
			setProgress({done: 0, total});
			let added = 0;
			let missing = 0;
			// Si no hay nada sonando, la primera de la playlist arranca: si no, la cola se llena pero
			// no habría forma de hacerla sonar (la pestaña Cola no tiene botón de play).
			let pendingStart = !musicState.track;
			for (let index = 0; index < total; index += RESOLVE_CHUNK) {
				if (cancelled.current) break;
				const chunk = result.tracks.slice(index, index + RESOLVE_CHUNK);
				// De YouTube sale el audio: se busca cada canción por "artista título".
				const hits = await transport.searchYouTubeBatch(chunk.map((track) => `${track.artists} ${track.title}`.trim()));
				const batch: MusicTrack[] = [];
				chunk.forEach((track, offset) => {
					const hit = hits[offset];
					if (!hit) {
						missing += 1;
						return;
					}
					batch.push({
						id: hit.id,
						// El nombre y el artista salen de Spotify (más limpios que el título de YouTube).
						title: track.title || hit.title,
						duration: track.duration || hit.duration,
						thumbnail: hit.thumbnail,
						author: track.artists || hit.author,
						url: hit.url,
						addedBy: state.me.name,
					});
				});
				if (batch.length > 0) {
					if (pendingStart) {
						const [first, ...rest] = batch;
						pendingStart = false;
						musicPlay(first);
						if (rest.length > 0) musicEnqueueMany(rest);
						added += batch.length;
					} else {
						musicEnqueueMany(batch);
						added += batch.length;
					}
				}
				setProgress({done: Math.min(index + chunk.length, total), total});
			}
			if (cancelled.current) return;
			setNotice(
				missing > 0
					? `Se agregaron ${added} de ${total} canciones (${missing} no estaban en YouTube).`
					: `Se agregaron las ${added} canciones${musicState.track ? ' a la cola' : ' y arrancó la primera'}.`,
			);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'No se pudo agregar la playlist.');
		} finally {
			setImporting('');
			setProgress({done: 0, total: 0});
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
					<div className="spotify-uri">
						<p className="settings-hint">
							Antes de conectar, en tu panel de Spotify (<strong>Settings → Redirect URIs</strong>) tiene que estar
							registrada esta dirección, <strong>exacta</strong> (Spotify ya no acepta <code>localhost</code>: va la IP):
						</p>
						<div className="spotify-uri-row">
							<code>{status?.redirectUri ?? ''}</code>
							<button
								type="button"
								className="spotify-ghost"
								title="Copiar"
								onClick={() => {
									const uri = status?.redirectUri ?? '';
									setNotice(
										copyText(uri)
											? 'Dirección copiada: pegala en Redirect URIs y guardá.'
											: `Copiala a mano (no se pudo usar el portapapeles): ${uri}`,
									);
								}}>
								<Copy size={15} />
							</button>
						</div>
					</div>
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

					{!inVoice ? (
						<p className="settings-hint">
							Unite a un canal de voz para agregar canciones a la cola.
						</p>
					) : null}

					{importing ? (
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

					{playlists.length === 0 ? (
						<p className="settings-hint">No tenés playlists en esta cuenta.</p>
					) : (
						<ul className="spotify-list">
							{playlists.map((playlist) => (
								<li key={playlist.id} className="spotify-row">
									{playlist.image ? <img src={playlist.image} alt="" loading="lazy" /> : <span className="spotify-cover" />}
									<span className="spotify-row-info">
										<span className="spotify-row-title" title={playlist.name}>
											{playlist.name}
										</span>
										<span className="spotify-row-sub">
											{playlist.owner ? `${playlist.owner} · ` : ''}
											{playlist.tracks} {playlist.tracks === 1 ? 'canción' : 'canciones'}
										</span>
									</span>
									<button
										type="button"
										className="spotify-play"
										title={inVoice ? 'Agregar todas a la cola' : 'Unite a un canal de voz primero'}
										disabled={Boolean(importing) || !inVoice}
										onClick={() => void importPlaylist(playlist)}>
										{importing === playlist.id ? <Loader2 size={16} className="music-spin" /> : <Play size={16} />}
									</button>
								</li>
							))}
						</ul>
					)}
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
