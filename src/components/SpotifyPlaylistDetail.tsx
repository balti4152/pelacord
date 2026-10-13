import {useEffect, useState} from 'react';
import {ArrowLeft, Loader2, Play, Plus, TriangleAlert, X} from 'lucide-react';
import {type SpotifyPlaylist, type SpotifyTrack} from '@/lib/desktop';
import {useSpotifyImport} from '@/lib/spotifyImport';
import {useStore} from '@/state/store';

/** "3:45" */
function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '';
	const total = Math.floor(seconds);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * El detalle de una playlist: la cabecera y sus canciones.
 *
 * Es el MISMO componente en la pestaña de Spotify y en el buscador, así se ve y se comporta igual:
 * se abren las canciones, se agrega de a una o todas juntas, y "agregar todas" va encolando a
 * medida que resuelve (arranca con la primera sin esperar al resto).
 */
export function SpotifyPlaylistDetail({
	playlist,
	onBack,
	onShowQueue,
}: {
	playlist: SpotifyPlaylist;
	onBack: () => void;
	onShowQueue?: () => void;
}): JSX.Element {
	const {state} = useStore();
	const spotify = useSpotifyImport();
	const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
	const [loading, setLoading] = useState(true);
	const inVoice = Boolean(state.voice.channelId);
	/** Cantidad: primero la que ya sabemos, después la de la API, y si no la real de las canciones. */
	const count = spotify.cachedCounts[playlist.id] ?? (playlist.readable ? playlist.tracks : 0) ?? 0;

	useEffect(() => {
		let alive = true;
		setLoading(true);
		setTracks([]);
		spotify.setError('');
		spotify.setNotice('');
		void (async () => {
			try {
				const result = await spotify.readTracks(playlist);
				if (!alive) return;
				setTracks(result.tracks ?? []);
				if (!result.ok) spotify.setError(result.error ?? 'No se pudieron leer las canciones de esa playlist.');
			} catch (failure) {
				if (alive) spotify.setError(failure instanceof Error ? failure.message : 'No se pudieron leer las canciones.');
			} finally {
				if (alive) setLoading(false);
			}
		})();
		return () => {
			alive = false;
		};
		// Se relee sólo al cambiar de playlist (readTracks y setError son estables).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [playlist.id]);

	return (
		<div className="spotify-detail">
			<div className="spotify-detail-head">
				<button type="button" className="spotify-ghost" title="Volver" onClick={onBack}>
					<ArrowLeft size={16} />
				</button>
				{playlist.image ? <img src={playlist.image} alt="" /> : <span className="spotify-cover" />}
				<span className="spotify-detail-info">
					<span className="spotify-detail-name" title={playlist.name}>
						{playlist.name}
					</span>
					<span className="spotify-row-sub">
						{playlist.owner ? `${playlist.owner} · ` : ''}
						{count > 0 ? `${count} ${count === 1 ? 'canción' : 'canciones'}` : 'canciones de otra cuenta'}
					</span>
				</span>
				<button
					type="button"
					className="spotify-play"
					title={inVoice ? 'Agregar todas a la cola' : 'Unite a un canal de voz primero'}
					disabled={Boolean(spotify.busy) || !inVoice || tracks.length === 0}
					onClick={() => {
						if (!spotify.isBusy() && inVoice) void spotify.importTracks(tracks, playlist.id);
					}}>
					{spotify.busy === playlist.id ? <Loader2 size={16} className="music-spin" /> : <Play size={16} />}
				</button>
			</div>

			{!inVoice ? <p className="settings-hint">Unite a un canal de voz para escuchar la música.</p> : null}

			{loading ? (
				<p className="settings-hint">
					<Loader2 size={16} className="music-spin" /> Trayendo las canciones… (las de otra cuenta tardan unos
					segundos)
				</p>
			) : null}

			{spotify.busy === playlist.id ? (
				<div className="spotify-progress">
					<span>
						Agregando a la cola… {spotify.progress.done}/{spotify.progress.total}
					</span>
					<button type="button" className="spotify-ghost" title="Cortar" onClick={spotify.cancel}>
						<X size={15} />
					</button>
				</div>
			) : null}

			{spotify.error ? (
				<p className="spotify-error">
					<TriangleAlert size={15} /> {spotify.error}
				</p>
			) : null}
			{spotify.notice ? (
				<p className="spotify-notice">
					{spotify.notice}
					{onShowQueue ? (
						<button type="button" className="spotify-link" onClick={onShowQueue}>
							Ver la cola
						</button>
					) : null}
				</p>
			) : null}

			<ul className="spotify-list">
				{tracks.map((track, index) => (
					<li key={`${track.title}-${index}`} className="spotify-row">
						<span className="music-row-index">{index + 1}</span>
						{/* El embed público no trae la portada de cada canción: se usa la de la playlist. */}
						{track.image || playlist.image ? (
							<img src={track.image || playlist.image} alt="" loading="lazy" />
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
							disabled={Boolean(spotify.busy) || !inVoice}
							onClick={() => void spotify.one(track, 'add')}>
							<Plus size={15} />
						</button>
						<button
							type="button"
							className="spotify-play"
							title={inVoice ? 'Reproducir ahora para todos' : 'Unite a un canal de voz primero'}
							disabled={Boolean(spotify.busy) || !inVoice}
							onClick={() => void spotify.one(track, 'play')}>
							{spotify.busy === `track:${track.title}` ? <Loader2 size={15} className="music-spin" /> : <Play size={15} />}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
