export type ThemeName = 'dark' | 'light' | 'coal';

export type Presence = 'online' | 'idle' | 'dnd' | 'offline';

export type ChannelType = 'text' | 'voice';

export type MessageDisplay = 'cozy' | 'compact';

export interface Channel {
	id: string;
	type: ChannelType;
	name: string;
	category: string;
	topic?: string;
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'text' | 'file';

export interface Attachment {
	id: string;
	name: string;
	size: number;
	mime: string;
	url: string;
	kind: AttachmentKind;
	/** Quién lo comparte y desde dónde se descarga (servidor de archivos P2P). */
	ownerId?: string;
	ownerHost?: string;
	ownerPort?: number;
	/** Miniatura (data URL) para previsualizar videos sin descargarlos. */
	thumbnail?: string;
}

export interface Message {
	id: string;
	channelId: string;
	authorId: string;
	authorName?: string;
	authorColor?: string;
	content: string;
	createdAt: number;
	edited?: boolean;
	attachments: Attachment[];
}

export interface Member {
	id: string;
	name: string;
	tag: string;
	presence: Presence;
	isBot?: boolean;
	avatarColor: string;
	avatarUrl?: string;
	bannerUrl?: string;
	bannerColor?: string;
	accentColor: string;
	bio?: string;
	status?: string;
}

export interface Settings {
	theme: ThemeName;
	messageDisplay: MessageDisplay;
	fontScale: number;
	customCss: string;
	cssVariables: Record<string, string>;
	showMembers: boolean;
	inputDeviceId: string;
	outputDeviceId: string;
}

export interface VoiceState {
	channelId: string | null;
	muted: boolean;
	deafened: boolean;
	video: boolean;
	sharing: boolean;
	/** Whether the full-screen call stage is showing. Tapping a text channel closes it. */
	stageOpen: boolean;
	/** Momento en que se entró al canal de voz (para el cronómetro). */
	joinedAt: number | null;
}

export interface VoiceParticipant {
	id: string;
	name: string;
	color: string;
	avatarUrl?: string;
	muted: boolean;
	deafened: boolean;
	sharing: boolean;
}

export interface AppState {
	me: Member;
	members: Member[];
	channels: Channel[];
	messages: Record<string, Message[]>;
	activeChannelId: string;
	settings: Settings;
	voice: VoiceState;
	/** Member ids currently connected to each voice channel. */
	voiceMembers: Record<string, VoiceParticipant[]>;
}
