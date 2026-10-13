import type {AvatarCrop, VoiceParticipant} from '@/types';

/** Presence payload a peer publishes over the ZeroTier mesh. */
export interface PeerPresence {
	id: string;
	name: string;
	color: string;
	avatarUrl?: string;
	avatarCrop?: AvatarCrop;
	bannerUrl?: string;
	bannerColor?: string;
	effect?: string;
	decoration?: string;
	decorationColor?: string;
	profileEffect?: string;
	profileEffectColor?: string;
	customParticle?: string;
	customDeco?: string;
	particleSize?: number;
	particleCount?: number;
	decoSize?: number;
	decoImage?: string;
	particleImage?: string;
	particleDirection?: string;
	particleOriginal?: boolean;
	particleSpeed?: number;
	particleLife?: number;
	/** Sube cuando el usuario cambia algo de su perfil (para refrescar las imágenes guardadas). */
	profileVersion?: number;
	channelId: string | null;
	muted: boolean;
	deafened: boolean;
	sharing: boolean;
	bio?: string;
	status?: string;
	fileHost?: string;
	filePort?: number;
}

export interface PeerMessage<T> {
	from: string;
	payload: T;
}

interface DesktopTransport {
	isDesktop: true;
	hello(identity: {id: string; name: string}): void;
	publishPresence(payload: PeerPresence): void;
	sendSignal(to: string, payload: unknown): void;
	/** Comando para un peer puntual (por ejemplo: moverlo a otro canal de voz). */
	sendCommand(to: string, payload: unknown): void;
	/** La Jam: el host difunde el estado de la m�sica por la malla. */
	sendMusic(payload: unknown): void;
	onMusic(callback: (message: PeerMessage<unknown>) => void): () => void;
	/** El log de mensajes: reconciliación del historial por la malla (con destinatario o difundido). */
	sendMessages(payload: unknown, to?: string): void;
	onMessages(callback: (message: PeerMessage<unknown>) => void): () => void;
	onCommand(callback: (message: PeerMessage<unknown>) => void): () => void;
	onPresence(callback: (message: PeerMessage<PeerPresence>) => void): () => void;
	onSignal(callback: (message: PeerMessage<unknown>) => void): () => void;
	onPeerLeft(callback: (message: {id: string}) => void): () => void;
	getRoster(): Promise<Array<{name?: string; host?: string; port?: number; self?: boolean}>>;
	getRosterPath(): Promise<string>;
	getPeers(): Promise<string[]>;
	getDesktopSources(): Promise<DesktopSource[]>;	selectSource(id: string): void;
	getFileEndpoint(): Promise<{host: string; port: number}>;
	/** Preview de un link (título, descripción, imagen). Se baja desde el proceso principal. */
	getLinkPreview(url: string): Promise<LinkPreviewData | null>;
	/** Música: versión de yt-dlp instalada (para mostrarla en Ajustes). */
	getYtDlpVersion(): Promise<string | null>;
	/** Música: busca en YouTube (título, duración, miniatura, autor). */
	searchYouTube(query: string, limit?: number): Promise<TrackResult[]>;
	/** Música: resuelve varias búsquedas de YouTube de una sola vez (para playlists enteras). */
	searchYouTubeBatch(queries: string[]): Promise<Array<TrackResult | null>>;
	/** Spotify: iniciar sesión (abre el navegador) y ver las playlists del usuario. */
	spotifyLogin(): Promise<{ok: boolean; error?: string}>;
	spotifyStatus(): Promise<SpotifyStatus>;
	spotifyPlaylists(): Promise<{ok: boolean; error?: string; playlists: SpotifyPlaylist[]}>;
	spotifyTracks(playlistId: string): Promise<{ok: boolean; error?: string; tracks: SpotifyTrack[]}>;
	/** Playlists de otra cuenta: se leen del embed público, porque la API no las entrega. */
	spotifyPublicTracks(playlistId: string): Promise<{ok: boolean; error?: string; tracks: SpotifyTrack[]}>;
	/** Playlists destacadas para el buscador (se arman con búsquedas reales). */
	spotifyDiscover(): Promise<{ok: boolean; error?: string; playlists: SpotifyPlaylist[]}>;
	/** Portadas de álbumes al azar (10), para el fondo decorativo del buscador. */
	spotifyCovers(): Promise<{ok: boolean; covers: string[]}>;
	spotifyLogout(): Promise<boolean>;
	/** Música: URL directa del audio, para streamear sin descargar. */
	getAudioUrl(target: string): Promise<string | null>;
	shareFile(payload: {filePath: string; name: string; mime: string; size: number}): Promise<string | null>;
	shareBuffer(payload: {name: string; mime: string; data: ArrayBuffer}): Promise<string | null>;
	/** Guarda un asset del perfil (avatar o banner, incluido GIF animado) y lo sirve por P2P. */
	shareProfileAsset(payload: {
		kind: 'avatar' | 'banner' | 'particle' | 'deco';
		name: string;
		mime: string;
		data: ArrayBuffer;
	}): Promise<boolean>;
	cacheMedia(payload: {url: string; name: string}): Promise<{ok: boolean; name?: string; error?: string}>;
	openPath(target: string): Promise<void>;
	downloadFile(payload: {url: string; name: string; size?: number}): Promise<{ok: boolean; path?: string; error?: string; cancelled?: boolean; resumable?: boolean}>;
	cancelDownload(id: string): Promise<boolean>;
	onDownloadProgress(callback: (message: {id: string; name: string; received?: number; total?: number; speed?: number; done?: boolean; cancelled?: boolean; resumable?: boolean; path?: string; error?: string}) => void): () => void;
	getPathForFile(file: File): string;
	/** Notificación nativa de Windows (toast). */
	notify(payload: {title: string; body: string; channelId?: string; silent?: boolean; iconUrl?: string; iconDataUrl?: string}): void;
	/** Guarda una imagen de perfil de un peer en disco y devuelve la URL local (para verla offline). */
	cacheAvatar(payload: {peerId: string; url: string; kind?: 'avatar' | 'banner' | 'deco' | 'particle'}): Promise<string | null>;
	/** Arranque automático con Windows (abierto en la bandeja). */
	getLoginItem(): Promise<boolean>;
	setLoginItem(enabled: boolean): Promise<boolean>;
	/** Registra los atajos globales; devuelve los que no se pudieron usar. */
	setHotkeys(bindings: Array<{action: string; accelerator: string}>): Promise<Array<{action: string; accelerator: string}>>;
	/** Avisa cuando el usuario aprieta un atajo global. */
	onHotkey(callback: (message: {action: string}) => void): () => void;
	/** Globito sobre el ícono de la barra de tareas (dataUrl vacío = sacarlo). */
	setBadge(payload: {dataUrl?: string; description?: string}): void;
	/** Colores de la barra de título (para que siga el tema). */
	setTitleBar(payload: {color: string; symbolColor: string}): void;
	onNotificationClick(callback: (message: {channelId?: string}) => void): () => void;
	checkUpdate(): Promise<{ok: boolean; error?: string}>;
	installUpdate(): Promise<boolean>;
	onUpdateStatus(callback: (status: {state: string; percent?: number; version?: string; error?: string}) => void): () => void;
}

/** Un tema de música (viene de la búsqueda de YouTube o de una playlist de Spotify). */
export interface TrackResult {
	id: string;
	title: string;
	/** Segundos. 0 si no se sabe. */
	duration: number;
	thumbnail: string;
	author: string;
	/** Link del video (para volver a sacarle el audio cuando haga falta). */
	url: string;
}

/** Una playlist del usuario de Spotify (sólo los datos: el audio después sale de YouTube). */
export interface SpotifyPlaylist {
	id: string;
	name: string;
	owner: string;
	/** Cuántas canciones tiene. */
	tracks: number;
	/** Si Spotify deja leer sus canciones (las de otras personas: sólo llega la metadata). */
	readable: boolean;
	image: string;
	url: string;
}

/** Una canción de una playlist de Spotify. */
export interface SpotifyTrack {
	title: string;
	artists: string;
	/** Segundos. 0 si no se sabe. */
	duration: number;
	/** Portada del álbum. */
	image: string;
}

export interface SpotifyStatus {
	connected: boolean;
	name?: string;
	image?: string;
	/** La dirección de vuelta que tiene que estar registrada en el panel de Spotify. */
	redirectUri?: string;
	/** Cuando la cuenta no está habilitada para la app (u otro problema al pedir el perfil). */
	error?: string;
	/** true = la cuenta no está habilitada como usuario de la app: no tiene sentido pedir playlists. */
	blocked?: boolean;
}

/** Lo que devuelve el preview de un link. */export interface LinkPreviewData {
	url: string;
	title: string;
	description: string;
	image: string;
	siteName: string;
}

export interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string;
	appIcon: string;
	kind: 'screen' | 'window';
}

declare global {
	interface Window {
		pelacordTransport?: DesktopTransport;
	}
}

export function getDesktopTransport(): DesktopTransport | null {
	if (typeof window === 'undefined') return null;
	return window.pelacordTransport ?? null;
}

export function isDesktop(): boolean {
	return getDesktopTransport() !== null;
}

/** Turns a peer presence payload into a VoiceParticipant entry. */
export function peerToParticipant(presence: PeerPresence): VoiceParticipant {
	return {
		id: presence.id,
		name: presence.name,
		color: presence.color,
		avatarUrl: presence.avatarUrl,
		avatarCrop: presence.avatarCrop,
		decoration: presence.decoration,
		decorationColor: presence.decorationColor,
		customDeco: presence.customDeco,
		decoImage: presence.decoImage,
		decoSize: presence.decoSize,
		original: presence.particleOriginal,
		muted: presence.muted,
		deafened: presence.deafened,
		sharing: presence.sharing,
	};
}
