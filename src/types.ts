export type ThemeName = 'dark' | 'light' | 'coal';

/** Efecto decorativo del perfil (alrededor del avatar). */
export type ProfileEffect = 'none' | 'glow' | 'neon' | 'fire' | 'aurora' | 'sparkle';

/** Decoración del avatar: overlay alrededor, sin tapar la cara. */
export type AvatarDecoration =
	| 'none'
	| 'hearts'
	| 'arcane'
	| 'poison'
	| 'celestial'
	| 'inferno'
	| 'void'
	| 'frost'
	| 'royal'
	| 'nature'
	| 'custom';

/** Dirección del movimiento de las partículas del overlay. */
export type ParticleDirection = 'down' | 'up' | 'left' | 'right';

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
	/** Recorte del avatar: zoom y desplazamiento (para no perder la animación de un GIF). */
	avatarCrop?: AvatarCrop;
	/** El avatar se sirve por P2P (/file/avatar): hay que reconstruir la URL al arrancar. */
	avatarP2P?: boolean;
	/** Cuadro fijo del avatar (primer cuadro de un GIF): para tamaños chicos y como respaldo. */
	avatarPoster?: string;
	bannerUrl?: string;
	bannerColor?: string;
	/** El banner se sirve por P2P (/file/banner): hay que reconstruir la URL al arrancar. */
	bannerP2P?: boolean;
	/** Efecto decorativo alrededor del avatar. */
	effect?: ProfileEffect;
	/** Decoración del avatar (anillo/overlay alrededor). */
	decoration?: AvatarDecoration;
	/** Color de la decoración (si el estilo lo permite). */
	decorationColor?: string;
	/** Overlay animado que se reproduce al abrir el perfil. */
	profileEffect?: string;
	/** Color del overlay del perfil. */
	profileEffectColor?: string;
	/** Imagen propia (PNG) que cae, para el overlay "Mi imagen cayendo". */
	customParticle?: string;
	/** La imagen propia se sirve por P2P (/file/particle): se reconstruye la URL al arrancar. */
	customParticleP2P?: boolean;
	/** Imagen propia para el marco del avatar (estilo "Personalizado" de la decoración). */
	customDeco?: string;
	/** ID de la partícula incluida usada como marco (carpeta particles/). */
	decoImage?: string;
	/** La imagen del marco se sirve por P2P (/file/deco). */
	customDecoP2P?: boolean;
	/** Escala de las partículas del overlay (1 = normal). */
	particleSize?: number;
	/** Cantidad de partículas del overlay. */
	particleCount?: number;
	/** Escala de las partículas del MARCO del avatar (independiente del overlay). */
	decoSize?: number;
	/** ID de la partícula incluida que se usa en el overlay (carpeta particles/). */
	particleImage?: string;
	/** Hacia dónde van las partículas del overlay. */
	particleDirection?: ParticleDirection;
	/** Si está activo, la imagen mantiene su color original (sin teñir). */
	particleOriginal?: boolean;
	/** Velocidad del overlay (1 = normal). */
	particleSpeed?: number;
	/** Vida: fracción del recorrido que la partícula sigue visible (0.2 a 1). */
	particleLife?: number;
	accentColor: string;
	bio?: string;
	status?: string;
}

/** Recorte del avatar, en porcentaje del contenedor cuadrado. */
export interface AvatarCrop {
	/** 1 = sin zoom. */
	zoom: number;
	/** Desplazamiento horizontal (%). */
	x: number;
	/** Desplazamiento vertical (%). */
	y: number;
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
	/** Si está apagado, las decoraciones no se animan (accesibilidad / rendimiento). */
	cosmeticAnimations: boolean;
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
	avatarCrop?: AvatarCrop;
	decoration?: string;
	decorationColor?: string;
	customDeco?: string;
	decoImage?: string;
	decoSize?: number;
	original?: boolean;
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
