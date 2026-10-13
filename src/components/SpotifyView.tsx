import {useCallback, useEffect, useState} from 'react';
import {Copy, Loader2, LogOut, Play, RefreshCw, TriangleAlert, X} from 'lucide-react';
import {SiSpotify} from 'react-icons/si';
import {type SpotifyPlaylist, type SpotifyStatus, getDesktopTransport} from '@/lib/desktop';
import {useSpotifyImport} from '@/lib/spotifyImport';
import {SpotifyPlaylistDetail} from '@/components/SpotifyPlaylistDetail';
import {useStore} from '@/state/store';

/** El verde característico de Spotify. */
export const SPOTIFY_GREEN = '#1ed760';

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
 * Spotify: iniciar sesión, ver tus playlists y encolarlas.
 *
 * Ojo con una cosa que no es obvia: Spotify no presta el audio. Lo que se trae es la LISTA
 * (nombre, artistas, duración, portada) y después cada canción se busca en YouTube, que es de
 * donde sale el sonido de la Jam.
 */
export function SpotifyView({onShowQueue}: {onShowQueue?: () => void}): JSX.Element {
	const {state} = useStore();
	const spotify = useSpotifyImport();
	const [status, setStatus] = useState<SpotifyStatus | null>(null);
	const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
	const [open, setOpen] = useState<SpotifyPlaylist | null>(null);
	const [loading, setLoading] = useState(true);
	const [connecting, setConnecting] = useState(false);
	const inVoice = Boolean(state.voice.channelId);
	/** Sólo se muestra el paso del panel de Spotify cuando Spotify rechaza la dirección. */
	const needsRedirect = /redirecc|redirect/i.test(spotify.error);

	const load = useCallback(async (): Promise<void> => {
		const transport = getDesktopTransport();
		if (!transport) {
			setLoading(false);
			spotify.setError('Spotify sólo funciona en la app de escritorio.');
			return;
		}
		setLoading(true);
		spotify.setError('');
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
				spotify.setError(me.error ?? 'Tu cuenta no está habilitada para esta app.');
				return;
			}
			const result = await transport.spotifyPlaylists();
			setPlaylists(result.playlists ?? []);
			if (!result.ok) spotify.setError(result.error ?? 'No se pudieron traer las playlists.');
		} catch (failure) {
			spotify.setError(failure instanceof Error ? failure.message : 'No se pudieron traer las playlists.');
		} finally {
			setLoading(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function connect(): Promise<void> {
		const transport = getDesktopTransport();
		if (!transport || connecting) return;
		setConnecting(true);
		spotify.setError('');
		spotify.setNotice('');
		try {
			const result = await transport.spotifyLogin();
			if (!result.ok) {
				spotify.setError(result.error ?? 'No se pudo iniciar sesión.');
				return;
			}
			await load();
		} catch (failure) {
			spotify.setError(failure instanceof Error ? failure.message : 'No se pudo iniciar sesión.');
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
		spotify.setNotice('');
		spotify.setError('');
	}

	/** El ▶ de una fila: lee la playlist y agrega TODO a la cola, sin abrirla. */
	async function addAll(playlist: SpotifyPlaylist): Promise<void> {
		if (spotify.isBusy()) return;
		if (!inVoice) {
			spotify.setError('Unite a un canal de voz para agregar canciones a la cola.');
			return;
		}
		spotify.setError('');
		spotify.setNotice('');
		try {
			const result = await spotify.readTracks(playlist);
			if (!result.ok) {
				spotify.setError(result.error ?? 'No se pudieron leer las canciones de esa playlist.');
				return;
			}
			await spotify.importTracks(result.tracks, playlist.id);
		} catch (failure) {
			spotify.setError(failure instanceof Error ? failure.message : 'No se pudieron leer las canciones.');
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
					{/* El paso del panel sólo se muestra si Spotify rechazó la dirección. */}
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
										spotify.setNotice(
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
				<SpotifyPlaylistDetail
					playlist={open}
					onBack={() => {
						setOpen(null);
						spotify.setError('');
						spotify.setNotice('');
					}}
					onShowQueue={onShowQueue}
				/>
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

					{playlists.length === 0 && !spotify.error ? (
						<p className="settings-hint">No tenés playlists en esta cuenta.</p>
					) : null}
					{playlists.length > 0 ? (
						<ul className="spotify-list">
							{playlists.map((playlist) => {
								const count = spotify.cachedCounts[playlist.id] ?? (playlist.readable ? playlist.tracks : 0);
								return (
									<li
										key={playlist.id}
										className="spotify-row is-clickable"
										title="Ver las canciones"
										onClick={() => setOpen(playlist)}>
										{playlist.image ? <img src={playlist.image} alt="" loading="lazy" /> : <span className="spotify-cover" />}
										<span className="spotify-row-info">
											<span className="spotify-row-title" title={playlist.name}>
												{playlist.name}
											</span>
											<span className="spotify-row-sub">
												{playlist.owner ? `${playlist.owner} · ` : ''}
												{count > 0
													? `${count} ${count === 1 ? 'canción' : 'canciones'}`
													: 'de otra cuenta · tocá para ver las canciones'}
											</span>
										</span>
										<button
											type="button"
											className="spotify-play"
											title={inVoice ? 'Agregar todas a la cola' : 'Unite a un canal de voz primero'}
											disabled={Boolean(spotify.busy) || !inVoice}
											onClick={(event) => {
												// El clic de la fila abre la playlist: este botón agrega todo a la cola.
												event.stopPropagation();
												void addAll(playlist);
											}}>
											{spotify.busy === playlist.id ? <Loader2 size={16} className="music-spin" /> : <Play size={16} />}
										</button>
									</li>
								);
							})}
						</ul>
					) : null}
				</>
			)}

			{spotify.busy && spotify.busy !== open?.id && spotify.progress.total > 0 ? (
				<div className="spotify-progress">
					<span>
						Agregando a la cola… {spotify.progress.done}/{spotify.progress.total}
					</span>
					<button type="button" className="spotify-ghost" title="Cortar" onClick={spotify.cancel}>
						<X size={15} />
					</button>
				</div>
			) : null}
			{spotify.error && !open ? (
				<p className="spotify-error">
					<TriangleAlert size={15} /> {spotify.error}
				</p>
			) : null}
			{spotify.notice && !open ? (
				<p className="spotify-notice">
					{spotify.notice}
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
