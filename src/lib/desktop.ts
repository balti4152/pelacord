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
	onPresence(callback: (message: PeerMessage<PeerPresence>) => void): () => void;
	onSignal(callback: (message: PeerMessage<unknown>) => void): () => void;
	onPeerLeft(callback: (message: {id: string}) => void): () => void;
	getRoster(): Promise<Array<{name?: string; host?: string; port?: number; self?: boolean}>>;
	getRosterPath(): Promise<string>;
	getPeers(): Promise<string[]>;
	getDesktopSources(): Promise<DesktopSource[]>;	selectSource(id: string): void;
	getFileEndpoint(): Promise<{host: string; port: number}>;
	shareFile(payload: {filePath: string; name: string; mime: string; size: number}): Promise<string | null>;
	shareBuffer(payload: {name: string; mime: string; data: ArrayBuffer}): Promise<string | null>;
	/** Guarda un asset del perfil (avatar o banner, incluido GIF animado) y lo sirve por P2P. */
	shareProfileAsset(payload: {
		kind: 'avatar' | 'banner' | 'particle';
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
	checkUpdate(): Promise<{ok: boolean; error?: string}>;
	installUpdate(): Promise<boolean>;
	onUpdateStatus(callback: (status: {state: string; percent?: number; version?: string; error?: string}) => void): () => void;
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
		customParticle: presence.customParticle,
		muted: presence.muted,
		deafened: presence.deafened,
		sharing: presence.sharing,
	};
}
