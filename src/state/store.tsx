import {createContext, type Dispatch, type ReactNode, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {type PeerPresence, getDesktopTransport, peerToParticipant} from '@/lib/desktop';
import {isRemoteEnabled} from '@/lib/firebase';
import {voiceMesh} from '@/lib/media';
import {
	EMPTY_MUSIC_STATE,
	type MusicState,
	type MusicTrack,
	appendToQueue,
	currentPositionMs,
	isHostAlive,
	moveInQueue,
	removeFromQueue,
	subscribeMusicState,
	updateMusicState,
} from '@/lib/musicQueue';
import {startMusicStream, stopMusicStream} from '@/lib/musicPlayer';
import {getIdentity, saveIdentity} from '@/lib/identity';
import {DEFAULT_HOTKEYS} from '@/lib/hotkeys';
import {setTaskbarBadge, showNotification, subscribeNotificationClick, avatarIconDataUrl} from '@/lib/notifications';
import {deleteMessage as deleteRemoteMessage, postMessage, putChannel, removeRemoteChannel, subscribeChannels, subscribeMessages, updateMessage} from '@/lib/remote';
import {playSound} from '@/lib/sounds';
import type {
	AppState,
	Attachment,
	Channel,
	ChannelType,
	Member,
	Message,
	Presence,
	Settings,
	ThemeName,
	VoiceParticipant,
} from '@/types';

const STORAGE_KEY = 'pelacord.state.v4';
const CUSTOM_CSS_ID = 'pelacord-custom-css';

/** Colores de la barra de título de Windows, por tema. */
const TITLEBAR_COLORS: Record<ThemeName, {color: string; symbolColor: string}> = {
	dark: {color: '#1a181e', symbolColor: '#b1acbb'},
	light: {color: '#ffffff', symbolColor: '#4e5058'},
	coal: {color: '#0b0912', symbolColor: '#b1acbb'},
};

export function uid(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** ¿El texto menciona a ese nombre? (@nombre) */
export function mentionsName(content: string, name: string): boolean {
	if (!content || !name) return false;
	return new RegExp(`@${escapeRegExp(name)}(?![\\w-])`, 'i').test(content);
}

/** Partes del texto separando las menciones, para poder resaltarlas. */
export function splitMentions(content: string, names: string[]): Array<{text: string; mention: boolean}> {
	if (!content || names.length === 0) return [{text: content, mention: false}];
	const pattern = new RegExp(`@(?:${names.map(escapeRegExp).join('|')})(?![\\w-])`, 'gi');
	const parts: Array<{text: string; mention: boolean}> = [];
	let index = 0;
	for (const match of content.matchAll(pattern)) {
		const at = match.index ?? 0;
		if (at > index) parts.push({text: content.slice(index, at), mention: false});
		parts.push({text: match[0], mention: true});
		index = at + match[0].length;
	}
	if (index < content.length) parts.push({text: content.slice(index), mention: false});
	return parts;
}

function makeAvatarColor(seed: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
	return `hsl(${hash % 360}, 62%, 48%)`;
}

function demoMember(id: string, name: string, presence: Presence, extra: Partial<Member> = {}): Member {
	return {id, name, tag: '0001', presence, avatarColor: makeAvatarColor(id + name), accentColor: 'hsl(242, 70%, 55%)', ...extra};
}

function toParticipant(member: Member, flags: Partial<VoiceParticipant> = {}): VoiceParticipant {
	return {
		id: member.id,
		name: member.name,
		color: member.avatarColor,
		avatarUrl: member.avatarUrl,
		avatarCrop: member.avatarCrop,
		decoration: member.decoration,
		decorationColor: member.decorationColor,
		customDeco: member.customDeco,
		decoImage: member.decoImage,
		decoSize: member.decoSize,
		original: member.particleOriginal,
		muted: false,
		deafened: false,
		sharing: false,
		...flags,
	};
}

export const TEXT_CATEGORY = 'Canales de texto';
export const VOICE_CATEGORY = 'Canales de voz';

const CHANNELS: Channel[] = [
	{id: 'ch-general', type: 'text', name: 'general', category: TEXT_CATEGORY, topic: 'Charla general de Pelacord'},
	{id: 'ch-random', type: 'text', name: 'random', category: TEXT_CATEGORY, topic: 'Lo que sea'},
	{id: 'ch-memes', type: 'text', name: 'memes', category: TEXT_CATEGORY},
	{id: 'ch-voice-general', type: 'voice', name: 'General', category: VOICE_CATEGORY},
	{id: 'ch-voice-gaming', type: 'voice', name: 'Gaming', category: VOICE_CATEGORY},
];

function seedState(): AppState {
	const identity = getIdentity();
	const me: Member = {
		id: identity.id,
		name: identity.name,
		tag: '0001',
		presence: 'online',
		avatarColor: identity.color,
		accentColor: 'hsl(242, 70%, 55%)',
		bio: '',
	};
	const remote = isRemoteEnabled();

	const demoMembers: Member[] = [
		me,
		demoMember('u-chubik', 'chubik', 'online', {tag: '0042', status: 'Jugando algo'}),
		demoMember('u-flux', 'flux', 'idle', {tag: '1337'}),
		demoMember('u-nina', 'nina', 'dnd', {tag: '0021', status: 'No molestar'}),
		demoMember('u-tomi', 'tomi', 'online', {tag: '0199'}),
		demoMember('u-bot', 'Pelabot', 'online', {tag: '0000', isBot: true, avatarColor: 'hsl(242, 70%, 55%)'}),
		demoMember('u-viejo', 'viejo', 'offline', {tag: '0008'}),
	];

	const now = Date.now();
	const demoMessages: Record<string, Message[]> = {
		'ch-general': [
			{id: uid(), channelId: 'ch-general', authorId: 'u-chubik', content: 'che, ya está andando el Pelacord?', createdAt: now - 1000 * 60 * 42, attachments: []},
			{id: uid(), channelId: 'ch-general', authorId: me.id, authorName: me.name, authorColor: me.avatarColor, content: 'sí. Los mensajes van a Firestore; la voz va a ir P2P por ZeroTier.', createdAt: now - 1000 * 60 * 40, attachments: []},
		],
	};

	const demoVoiceMembers: Record<string, VoiceParticipant[]> = {
		'ch-voice-general': [toParticipant(demoMembers[1]), toParticipant(demoMembers[4])],
	};

	return {
		me,
		members: remote ? [me] : demoMembers,
		channels: CHANNELS,
		messages: remote ? {} : demoMessages,
		activeChannelId: 'ch-general',
		settings: {
			theme: 'dark',
			messageDisplay: 'cozy',
			fontScale: 1,
			customCss: '',
			cssVariables: {},
			showMembers: true,
			inputDeviceId: 'default',
			outputDeviceId: 'default',
			cosmeticAnimations: true,
			notifications: true,
			hotkeys: {...DEFAULT_HOTKEYS},
		},
		voice: {channelId: null, muted: false, deafened: false, mutedBeforeDeafen: false, video: false, sharing: false, stageOpen: false, joinedAt: null},
		voiceMembers: remote ? {} : demoVoiceMembers,
		unread: {},
		mutedChannels: [],
		knownMembers: {},
	};
}

type Action =
	| {type: 'selectChannel'; channelId: string}
	| {type: 'sendMessage'; channelId: string; content: string; attachments: Attachment[]}
	| {type: 'setChannelMessages'; channelId: string; messages: Message[]}
	| {type: 'markRead'; channelId: string}
	| {type: 'bumpUnread'; channelId: string}
	| {type: 'toggleChannelMute'; channelId: string}
	| {type: 'setKnownMembers'; knownMembers: Record<string, Member>}
	| {type: 'editMessage'; channelId: string; messageId: string; content: string}
	| {type: 'deleteMessage'; channelId: string; messageId: string}
	| {type: 'setRemoteMembers'; members: Member[]}
	| {type: 'setVoiceMembers'; voiceMembers: Record<string, VoiceParticipant[]>}
	| {type: 'updateProfile'; patch: Partial<Member>}
	| {type: 'updateSettings'; patch: Partial<Settings>}
	| {type: 'setCssVariable'; name: string; value: string}
	| {type: 'joinVoice'; channelId: string}
	| {type: 'leaveVoice'}
	| {type: 'minimizeVoice'}
	| {type: 'openVoiceStage'}
	| {type: 'toggleVoiceFlag'; flag: 'muted' | 'deafened' | 'video' | 'sharing'}
	| {type: 'addChannel'; channel: Channel}
	| {type: 'deleteChannel'; channelId: string}
	| {type: 'setChannels'; channels: Channel[]};

function reducer(state: AppState, action: Action): AppState {
	switch (action.type) {
		case 'selectChannel': {
			const unread = {...state.unread};
			delete unread[action.channelId];
			return {...state, activeChannelId: action.channelId, unread, voice: {...state.voice, stageOpen: false}};
		}
		case 'markRead': {
			if (!state.unread[action.channelId]) return state;
			const unread = {...state.unread};
			delete unread[action.channelId];
			return {...state, unread};
		}
		case 'bumpUnread':
			return {
				...state,
				unread: {...state.unread, [action.channelId]: (state.unread[action.channelId] ?? 0) + 1},
			};
		case 'toggleChannelMute':
			return {
				...state,
				mutedChannels: state.mutedChannels.includes(action.channelId)
					? state.mutedChannels.filter((id) => id !== action.channelId)
					: [...state.mutedChannels, action.channelId],
			};
		case 'setKnownMembers':
			return {...state, knownMembers: action.knownMembers};
		case 'sendMessage': {
			const message: Message = {
				id: uid(),
				channelId: action.channelId,
				authorId: state.me.id,
				authorName: state.me.name,
				authorColor: state.me.avatarColor,
				content: action.content,
				createdAt: Date.now(),
				attachments: action.attachments,
			};
			const list = state.messages[action.channelId] ?? [];
			return {...state, messages: {...state.messages, [action.channelId]: [...list, message]}};
		}
		case 'setChannelMessages':
			return {...state, messages: {...state.messages, [action.channelId]: action.messages}};
		case 'editMessage': {
			const list = state.messages[action.channelId] ?? [];
			return {
				...state,
				messages: {
					...state.messages,
					[action.channelId]: list.map((message) =>
						message.id === action.messageId ? {...message, content: action.content, edited: true} : message,
					),
				},
			};
		}
		case 'deleteMessage': {
			const list = state.messages[action.channelId] ?? [];
			return {...state, messages: {...state.messages, [action.channelId]: list.filter((message) => message.id !== action.messageId)}};
		}
		case 'setRemoteMembers':
			return {...state, members: action.members};
		case 'setVoiceMembers':
			return {...state, voiceMembers: action.voiceMembers};
		case 'updateProfile': {
			const me = {...state.me, ...action.patch};
			return {...state, me, members: state.members.map((m) => (m.id === state.me.id ? me : m))};
		}
		case 'updateSettings':
			return {...state, settings: {...state.settings, ...action.patch}};
		case 'setCssVariable': {
			const cssVariables = {...state.settings.cssVariables};
			if (action.value.trim() === '') delete cssVariables[action.name];
			else cssVariables[action.name] = action.value;
			return {...state, settings: {...state.settings, cssVariables}};
		}
		case 'joinVoice': {
			// Local membership. Cross-peer membership will come from the ZeroTier presence transport.
			const voiceMembers: Record<string, VoiceParticipant[]> = {};
			for (const [channelId, list] of Object.entries(state.voiceMembers)) {
				voiceMembers[channelId] = list.filter((p) => p.id !== state.me.id);
			}
			voiceMembers[action.channelId] = [
				...(voiceMembers[action.channelId] ?? []),
				toParticipant(state.me, {muted: state.voice.muted, deafened: state.voice.deafened}),
			];
			return {...state, voiceMembers, voice: {...state.voice, channelId: action.channelId, stageOpen: false, joinedAt: Date.now()}};
		}
		case 'leaveVoice': {
			const voiceMembers: Record<string, VoiceParticipant[]> = {};
			for (const [channelId, list] of Object.entries(state.voiceMembers)) {
				voiceMembers[channelId] = list.filter((p) => p.id !== state.me.id);
			}
			return {...state, voiceMembers, voice: {channelId: null, muted: false, deafened: false, mutedBeforeDeafen: false, video: false, sharing: false, stageOpen: false, joinedAt: null}};
		}
		case 'minimizeVoice':
			return {...state, voice: {...state.voice, stageOpen: false}};
		case 'openVoiceStage':
			return {...state, voice: {...state.voice, stageOpen: true}};
		case 'toggleVoiceFlag': {
			if (action.flag === 'deafened') {
				const deafened = !state.voice.deafened;
				// Ensordecerte también silencia el micrófono (si no, hablarías sin escuchar).
				// Al reactivar el audio se recupera el estado de micrófono que tenías antes:
				// si estabas muteado seguís muteado, y si no, volvés con micrófono abierto.
				return {
					...state,
					voice: {
						...state.voice,
						deafened,
						muted: deafened ? true : state.voice.mutedBeforeDeafen,
						mutedBeforeDeafen: deafened ? state.voice.muted : state.voice.mutedBeforeDeafen,
					},
				};
			}
			if (action.flag === 'muted') {
				const muted = !state.voice.muted;
				// Si estabas ensordecido y activás el micrófono, también se reactiva el audio:
				// quedarte sordo con el micrófono abierto era el bug (hablás y no escuchás).
				return {
					...state,
					voice: {
						...state.voice,
						muted,
						deafened: muted ? state.voice.deafened : false,
						mutedBeforeDeafen: muted ? state.voice.mutedBeforeDeafen : false,
					},
				};
			}
			return {...state, voice: {...state.voice, [action.flag]: !state.voice[action.flag]}};
		}
		case 'addChannel': {
			// Un canal de texto nuevo se abre solo, como en Discord.
			return {
				...state,
				channels: [...state.channels, action.channel],
				activeChannelId: action.channel.type === 'text' ? action.channel.id : state.activeChannelId,
			};
		}
		case 'deleteChannel': {
			if (state.channels.length <= 1) return state;
			const channels = state.channels.filter((channel) => channel.id !== action.channelId);
			const messages = {...state.messages};
			delete messages[action.channelId];
			const unread = {...state.unread};
			delete unread[action.channelId];
			const voiceMembers = {...state.voiceMembers};
			delete voiceMembers[action.channelId];
			const wasInVoice = state.voice.channelId === action.channelId;
			const nextText = channels.find((channel) => channel.type === 'text');
			return {
				...state,
				channels,
				messages,
				unread,
				voiceMembers,
				mutedChannels: state.mutedChannels.filter((id) => id !== action.channelId),
				activeChannelId:
					state.activeChannelId === action.channelId && nextText ? nextText.id : state.activeChannelId,
				voice: wasInVoice
					? {channelId: null, muted: false, deafened: false, mutedBeforeDeafen: false, video: false, sharing: false, stageOpen: false, joinedAt: null}
					: state.voice,
			};
		}
		case 'setChannels':
			return {...state, channels: action.channels};
		default:
			return state;
	}
}

function loadState(): AppState {
	if (typeof localStorage === 'undefined') return seedState();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return seedState();
		const parsed = JSON.parse(raw) as AppState;
		if (!parsed || !parsed.channels || !parsed.settings) return seedState();
		if (!Array.isArray(parsed.members) || parsed.members.length === 0) parsed.members = [parsed.me];
		// Una app recién abierta no está en ninguna llamada.
		parsed.voice = {channelId: null, muted: false, deafened: false, mutedBeforeDeafen: false, video: false, sharing: false, stageOpen: false, joinedAt: null};
		parsed.voiceMembers = {};
		if (typeof parsed.settings.inputDeviceId !== 'string') parsed.settings.inputDeviceId = 'default';
		if (typeof parsed.settings.outputDeviceId !== 'string') parsed.settings.outputDeviceId = 'default';
		if (typeof parsed.settings.cosmeticAnimations !== 'boolean') parsed.settings.cosmeticAnimations = true;
		if (typeof parsed.settings.notifications !== 'boolean') parsed.settings.notifications = true;
		if (!parsed.settings.hotkeys || typeof parsed.settings.hotkeys !== 'object') {
			parsed.settings.hotkeys = {...DEFAULT_HOTKEYS};
		}
		if (!parsed.unread || typeof parsed.unread !== 'object') parsed.unread = {};
		if (!Array.isArray(parsed.mutedChannels)) parsed.mutedChannels = [];
		if (!parsed.knownMembers || typeof parsed.knownMembers !== 'object') parsed.knownMembers = {};
		return parsed;
	} catch {
		return seedState();
	}
}

function persist(state: AppState): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const remote = isRemoteEnabled();
		const messages: Record<string, Message[]> = {};
		if (!remote) {
			for (const [channelId, list] of Object.entries(state.messages)) {
				messages[channelId] = list.map((m) => ({
					...m,
					attachments: m.attachments.map((a) => ({...a, url: a.url.startsWith('blob:') ? '' : a.url})),
				}));
			}
		}
		const payload = remote ? {...state, messages: {}} : {...state, messages};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// best effort
	}
}

function applyEffects(state: AppState): void {
	if (typeof document === 'undefined') return;
	const body = document.body;
	const themes: ThemeName[] = ['dark', 'light', 'coal'];
	for (const theme of themes) body.classList.toggle(`theme-${theme}`, state.settings.theme === theme);
	body.style.fontSize = `${16 * state.settings.fontScale}px`;
	// Accesibilidad/rendimiento: apaga las animaciones de los cosméticos.
	body.classList.toggle('no-cosmetic-anim', !state.settings.cosmeticAnimations);

	const root = document.documentElement;
	for (const name of Object.keys(state.settings.cssVariables)) root.style.removeProperty(name);
	for (const [name, value] of Object.entries(state.settings.cssVariables)) {
		if (name.startsWith('--')) root.style.setProperty(name, value);
	}

	// La barra de título (botones de la ventana) sigue el tema elegido.
	const titleBar = TITLEBAR_COLORS[state.settings.theme] ?? TITLEBAR_COLORS.dark;
	getDesktopTransport()?.setTitleBar(titleBar);

	let styleEl = document.getElementById(CUSTOM_CSS_ID) as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = CUSTOM_CSS_ID;
		document.head.appendChild(styleEl);
	}
	styleEl.textContent = state.settings.customCss;
}

interface StoreContextValue {
	state: AppState;
	dispatch: Dispatch<Action>;
	sendMessage: (content: string, attachments: Attachment[]) => void;
	editMessage: (messageId: string, content: string) => void;
	removeMessage: (messageId: string) => void;
	updateProfile: (patch: Partial<Member>) => void;
	updateSettings: (patch: Partial<Settings>) => void;
	setCssVariable: (name: string, value: string) => void;
	/** Crea un canal (de texto o de voz) y lo comparte con los demás. */
	addChannel: (type: ChannelType, name: string) => void;
	/** Borra un canal y lo saca de la lista compartida. */
	removeChannel: (channelId: string) => void;
	/** Mueve a alguien (o a vos) a otro canal de voz. */
	moveMember: (peerId: string, channelId: string) => void;
	/** Silenciar / ensordecer / desconectar a alguien (o a vos). */
	sendPeerCommand: (peerId: string, payload: {kind: 'mute' | 'deafen' | 'disconnect'; on?: boolean}) => void;
	/** Atajos globales que Windows rechazó, para avisar en Ajustes. */
	hotkeyFailures: Array<{action: string; accelerator: string}>;
	/** Música: estado compartido de la Jam. */
	musicState: MusicState;
	/** Pone un tema en la Jam (null = cortar). Cualquiera puede, es estilo Jam. */
	musicPlay: (track: MusicTrack | null, startAtMs?: number) => Promise<void>;
	musicEnqueue: (track: MusicTrack) => Promise<void>;
	musicRemove: (index: number) => Promise<void>;
	musicMove: (from: number, to: number) => Promise<void>;
	musicSkip: () => Promise<void>;
	musicTogglePause: () => Promise<void>;
	/** Separarse de la Jam (para escuchar la propia) o volver. */
	musicSetDetached: (detached: boolean) => void;
	musicSetVolume: (value: number) => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({children}: {children: ReactNode}): JSX.Element {
	const [state, dispatch] = useReducer(reducer, undefined, loadState);
	/** Atajos que Windows no dejó registrar (otro programa los usa o la tecla no se puede). */
	const [hotkeyFailures, setHotkeyFailures] = useState<Array<{action: string; accelerator: string}>>([]);
	const meRef = useRef(state.me);
	meRef.current = state.me;
	const voiceRef = useRef(state.voice);
	voiceRef.current = state.voice;
	const peersRef = useRef<Record<string, PeerPresence>>({});
	const lastSeenRef = useRef<Record<string, number>>({});
	const sharingRef = useRef<Record<string, boolean>>({});
	const messageCountRef = useRef<Record<string, number>>({});
	const activeChannelRef = useRef(state.activeChannelId);
	activeChannelRef.current = state.activeChannelId;
	const notificationsRef = useRef(state.settings.notifications);
	notificationsRef.current = state.settings.notifications;
	const knownMembersRef = useRef<Record<string, Member>>(state.knownMembers);
	knownMembersRef.current = state.knownMembers;
	const mutedChannelsRef = useRef<string[]>(state.mutedChannels);
	mutedChannelsRef.current = state.mutedChannels;
	const channelsRef = useRef<Channel[]>(state.channels);
	channelsRef.current = state.channels;
	const fileEndpointRef = useRef<{host: string; port: number} | null>(null);

	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		void transport
			.getFileEndpoint()
			.then((endpoint) => {
				fileEndpointRef.current = endpoint;
				if (!endpoint.host || !endpoint.port) return;
				// Los assets propios servidos por P2P cambian de puerto en cada arranque:
				// se reconstruyen las URLs para que sigan funcionando.
				const me = meRef.current;
				const patch: Partial<Member> = {};
				if (me.avatarP2P) {
					const url = `http://${endpoint.host}:${endpoint.port}/file/avatar`;
					if (me.avatarUrl !== url) patch.avatarUrl = url;
				}
				if (me.bannerP2P) {
					const url = `http://${endpoint.host}:${endpoint.port}/file/banner`;
					if (me.bannerUrl !== url) patch.bannerUrl = url;
				}
				if (me.customParticleP2P) {
					const url = `http://${endpoint.host}:${endpoint.port}/file/particle`;
					if (me.customParticle !== url) patch.customParticle = url;
				}
				if (me.customDecoP2P) {
					const url = `http://${endpoint.host}:${endpoint.port}/file/deco`;
					if (me.customDeco !== url) patch.customDeco = url;
				}
				if (Object.keys(patch).length > 0) dispatch({type: 'updateProfile', patch});
			})
			.catch(() => {});
	}, []);

	const presencePayload = useCallback(() => {
		const me = meRef.current;
		const voice = voiceRef.current;
		const endpoint = fileEndpointRef.current;
		return {
			id: me.id,
			name: me.name,
			color: me.avatarColor,
			avatarUrl: me.avatarUrl,
			avatarCrop: me.avatarCrop,
			bannerUrl: me.bannerUrl,
			bannerColor: me.bannerColor,
			effect: me.effect,
			decoration: me.decoration,
			decorationColor: me.decorationColor,
			profileEffect: me.profileEffect,
			profileEffectColor: me.profileEffectColor,
			customParticle: me.customParticle,
			customDeco: me.customDeco,
			particleSize: me.particleSize,
			particleCount: me.particleCount,
			decoSize: me.decoSize,
			decoImage: me.decoImage,
			particleImage: me.particleImage,
			particleDirection: me.particleDirection,
			particleOriginal: me.particleOriginal,
			particleSpeed: me.particleSpeed,
			particleLife: me.particleLife,
			profileVersion: me.profileVersion,
			channelId: voice.channelId,
			muted: voice.muted,
			deafened: voice.deafened,
			sharing: voice.sharing,
			bio: me.bio,
			status: me.status,
			fileHost: endpoint?.host,
			filePort: endpoint?.port,
		};
	}, []);

	useEffect(() => {
		persist(state);
		applyEffects(state);
	}, [state]);

	// Persist the identity used as the author id for messages.
	useEffect(() => {
		saveIdentity({id: state.me.id, name: state.me.name, color: state.me.avatarColor});
	}, [state.me.id, state.me.name, state.me.avatarColor]);

	// --- Desktop transport: presence over the ZeroTier peer mesh (no cloud) ---

	/** Guarda en disco una imagen del perfil de un peer (avatar, banner, marco o partículas). */
	function cachePeerAsset(
		peerId: string,
		kind: 'avatar' | 'banner' | 'deco' | 'particle',
		url?: string,
		version?: number,
	): void {
		const transport = getDesktopTransport();
		if (!transport || !url || !/^https?:/i.test(url)) return;
		const key = `${url}|${version ?? 0}`;
		const member = knownMembersRef.current[peerId];
		// Si ya está guardada esa versión, no se vuelve a bajar.
		if (!member || member.cachedUrls?.[kind] === key) return;
		void transport
			.cacheAvatar({peerId, url, kind})
			.then((local) => {
				if (!local) return;
				const current = knownMembersRef.current[peerId];
				if (!current) return;
				const updated: Member = {
					...current,
					cachedUrls: {...(current.cachedUrls ?? {}), [kind]: key},
				};
				if (kind === 'avatar') {
					updated.cachedAvatar = local;
					updated.avatarPoster = local;
				} else if (kind === 'banner') {
					updated.cachedBanner = local;
				} else if (kind === 'deco') {
					updated.cachedDeco = local;
				} else {
					updated.cachedParticle = local;
				}
				const next = {...knownMembersRef.current, [peerId]: updated};
				knownMembersRef.current = next;
				dispatch({type: 'setKnownMembers', knownMembers: next});
			})
			.catch(() => {});
	}

	const applyPresence = useCallback(() => {
		const me = meRef.current;
		const voice = voiceRef.current;
		const voiceMembers: Record<string, VoiceParticipant[]> = {};
		const online: Member[] = [];
		const onlineIds = new Set<string>();
		const known = {...knownMembersRef.current};

		for (const peer of Object.values(peersRef.current)) {
			if (peer.id === me.id) continue;
			onlineIds.add(peer.id);
			const previous = known[peer.id];
			// La foto guardada en disco se usa como respaldo (y para los tamaños chicos).
			const member: Member = {
				id: peer.id,
				name: peer.name,
				tag: previous?.tag ?? '0000',
				presence: 'online',
				avatarColor: peer.color,
				avatarUrl: peer.avatarUrl,
				avatarCrop: peer.avatarCrop,
				avatarPoster: previous?.cachedAvatar,
				cachedAvatar: previous?.cachedAvatar,
				lastAvatarUrl: previous?.lastAvatarUrl,
				cachedUrls: previous?.cachedUrls,
				profileVersion: peer.profileVersion,
				bannerUrl: previous?.cachedBanner ?? peer.bannerUrl,
				cachedBanner: previous?.cachedBanner,
				bannerColor: peer.bannerColor,
				effect: peer.effect as Member['effect'],
				decoration: peer.decoration as Member['decoration'],
				decorationColor: peer.decorationColor,
				profileEffect: peer.profileEffect,
				profileEffectColor: peer.profileEffectColor,
				customParticle: previous?.cachedParticle ?? peer.customParticle,
				cachedParticle: previous?.cachedParticle,
				customDeco: previous?.cachedDeco ?? peer.customDeco,
				cachedDeco: previous?.cachedDeco,
				particleSize: peer.particleSize,
				particleCount: peer.particleCount,
				decoSize: peer.decoSize,
				decoImage: peer.decoImage,
				particleImage: peer.particleImage,
				particleDirection: peer.particleDirection as Member['particleDirection'],
				particleOriginal: peer.particleOriginal,
				particleSpeed: peer.particleSpeed,
				particleLife: peer.particleLife,
				accentColor: 'hsl(242, 70%, 55%)',
				bio: peer.bio,
				status: peer.status,
			};
			known[peer.id] = member;
			knownMembersRef.current = known;
			online.push(member);

			// Se guardan las imágenes del perfil en disco: así se siguen viendo cuando se desconecte
			// y se refrescan solas cuando el otro cambia algo (sube profileVersion).
			cachePeerAsset(peer.id, 'avatar', peer.avatarUrl, peer.profileVersion);
			cachePeerAsset(peer.id, 'banner', peer.bannerUrl, peer.profileVersion);
			cachePeerAsset(peer.id, 'deco', peer.customDeco, peer.profileVersion);
			cachePeerAsset(peer.id, 'particle', peer.customParticle, peer.profileVersion);

			if (peer.channelId) {
				voiceMembers[peer.channelId] = [...(voiceMembers[peer.channelId] ?? []), peerToParticipant(peer)];
				// Sonido cuando alguien empieza o deja de compartir pantalla.
				const previousSharing = sharingRef.current[peer.id];
				if (previousSharing !== undefined && previousSharing !== peer.sharing) {
					playSound(peer.sharing ? 'streamStart' : 'streamStop');
				}
			}
			sharingRef.current[peer.id] = peer.sharing;
		}
		if (voice.channelId) {
			voiceMembers[voice.channelId] = [
				...(voiceMembers[voice.channelId] ?? []),
				toParticipant(me, {muted: voice.muted, deafened: voice.deafened, sharing: voice.sharing}),
			];
		}
		// Los que ya no están online siguen apareciendo, pero en gris y con su foto guardada.
		const offline = Object.values(known)
			.filter((member) => member.id !== me.id && !onlineIds.has(member.id))
			.map((member) => ({
				...member,
				presence: 'offline' as const,
				avatarUrl: member.cachedAvatar ?? member.avatarUrl,
				avatarPoster: member.cachedAvatar,
				bannerUrl: member.cachedBanner ?? member.bannerUrl,
				customDeco: member.cachedDeco ?? member.customDeco,
				customParticle: member.cachedParticle ?? member.customParticle,
			}));
		dispatch({type: 'setKnownMembers', knownMembers: known});
		dispatch({type: 'setVoiceMembers', voiceMembers});
		dispatch({type: 'setRemoteMembers', members: [me, ...online, ...offline]});
	}, []);

	// Al abrir la app ya se muestran los perfiles guardados (aunque estén desconectados).
	useEffect(() => {
		applyPresence();
	}, [applyPresence]);

	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		transport.hello({id: state.me.id, name: state.me.name});
	}, [state.me.id, state.me.name]);

	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		return transport.onPresence(({from, payload}) => {
			// Nunca contarse a uno mismo (evita el duplicado por el eco de la malla).
			if (from === meRef.current.id || payload.id === meRef.current.id) return;
			peersRef.current = {...peersRef.current, [from]: payload};
			lastSeenRef.current[from] = Date.now();
			applyPresence();
		});
	}, [applyPresence]);

	// Cuando un peer se desconecta, se lo saca de la llamada y de la lista.
	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		return transport.onPeerLeft(({id}) => {
			if (!peersRef.current[id]) return;
			delete peersRef.current[id];
			delete lastSeenRef.current[id];
			delete sharingRef.current[id];
			applyPresence();
		});
	}, [applyPresence]);

	// Comandos que mandan otros peers. Hoy: moverme a otro canal de voz (arrastrar un usuario en
	// la barra lateral). El que lo pide no mueve a nadie a la fuerza: el que lo recibe obedece.
	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		return transport.onCommand(({payload}) => {
			const command = payload as {kind?: string; channelId?: string; on?: boolean} | null;
			if (!command?.kind) return;
			// Mover de canal: se entra sin preguntar (arrastrar a alguien lo mueve de verdad).
			if (command.kind === 'move' && command.channelId) {
				dispatch({type: 'joinVoice', channelId: command.channelId});
				return;
			}
			// Micrófono y audio: los aplica el que los recibe (no se puede tocar el micrófono de
			// otra máquina desde afuera). Se usa el mismo interruptor de siempre.
			if (command.kind === 'mute' && voiceRef.current.muted !== Boolean(command.on)) {
				dispatch({type: 'toggleVoiceFlag', flag: 'muted'});
				return;
			}
			if (command.kind === 'deafen' && voiceRef.current.deafened !== Boolean(command.on)) {
				dispatch({type: 'toggleVoiceFlag', flag: 'deafened'});
				return;
			}
			if (command.kind === 'disconnect') dispatch({type: 'leaveVoice'});
		});
	}, []);

	// Red de seguridad: si no se recibe presencia de alguien en 30 s, se lo considera ido.
	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		const timer = setInterval(() => {
			const now = Date.now();
			let changed = false;
			for (const id of Object.keys(peersRef.current)) {
				if (now - (lastSeenRef.current[id] ?? 0) > 30000) {
					delete peersRef.current[id];
					delete lastSeenRef.current[id];
					delete sharingRef.current[id];
					changed = true;
				}
			}
			if (changed) applyPresence();
		}, 10000);
		return () => clearInterval(timer);
	}, [applyPresence]);

	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		transport.publishPresence(presencePayload());
		applyPresence();
	}, [
		state.me.id,
		state.me.name,
		state.me.avatarColor,
		state.me.avatarUrl,
		state.voice.channelId,
		state.voice.muted,
		state.voice.deafened,
		state.voice.sharing,
		applyPresence,
		presencePayload,
	]);

	// Reanuncia la presencia cada 10 s para que quien entra tarde reciba nombre y avatar.
	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		const timer = setInterval(() => {
			transport.publishPresence(presencePayload());
		}, 10000);
		return () => clearInterval(timer);
	}, [presencePayload]);

	// La lista de canales también se comparte: si alguien crea o borra uno, lo ven todos.
	// La primera vez el proyecto está vacío, así que se suben los canales iniciales.
	useEffect(() => {
		if (!isRemoteEnabled()) return;
		return subscribeChannels((channels, isEmpty, fromCache) => {
			// Los datos que sólo están en la caché local no se usan: Firestore los muestra antes
			// de confirmarlos y, si el servidor los rechaza, volvería atrás y borraría la lista.
			if (fromCache) return;
			if (isEmpty) {
				for (const channel of channelsRef.current) void putChannel(channel).catch(() => {});
				return;
			}
			dispatch({type: 'setChannels', channels});
		});
	}, []);

	// Messages come from Firestore. Voice presence deliberately does NOT: it runs peer-to-peer
	// over ZeroTier through the desktop transport, so it never touches the Firebase quota.
	//
	// Se escuchan TODOS los canales de texto: así llegan las notificaciones y el puntito rojo
	// aunque estés mirando otro canal.
	const textChannelIds = state.channels
		.filter((channel) => channel.type === 'text')
		.map((channel) => channel.id)
		.join(',');
	useEffect(() => {
		if (!isRemoteEnabled()) return;
		const textChannels = channelsRef.current.filter((channel) => channel.type === 'text');
		const unsubscribe = textChannels.map((channel) =>
			subscribeMessages(channel.id, (messages) => {
				const previous = messageCountRef.current[channel.id];
				const last = messages[messages.length - 1];
				const isNew =
					previous !== undefined && messages.length > previous && Boolean(last) && last.authorId !== meRef.current.id;
				if (isNew && last) {
					const watching = channel.id === activeChannelRef.current && document.hasFocus();
					const muted = mutedChannelsRef.current.includes(channel.id);
					const mentioned = mentionsName(last.content ?? '', meRef.current.name);
					// Silenciado: ni suena ni avisa, SALVO que te mencionen.
					const audible = !muted || mentioned;
					if (audible) playSound('message');
					if (!watching) {
						dispatch({type: 'bumpUnread', channelId: channel.id});
						if (notificationsRef.current && audible) {
							const attachment = last.attachments?.[0];
							const body = last.content?.trim() || (attachment ? `📎 ${attachment.name}` : 'Nuevo mensaje');
							// La foto de quien escribe: la del peer si está online, o la que quedó
							// guardada en el perfil cacheado. Se convierte a PNG acá (ver
							// avatarIconDataUrl) porque el proceso principal no lee GIF.
							const peer = peersRef.current[last.authorId];
							const known = knownMembersRef.current[last.authorId];
							const photo = peer?.avatarUrl ?? known?.cachedAvatar ?? known?.avatarUrl ?? undefined;
							void avatarIconDataUrl(photo).then((iconDataUrl) => {
								showNotification({
									title: mentioned
										? `Te mencionaron en #${channel.name}`
										: `${last.authorName ?? 'Alguien'} en #${channel.name}`,
									body: body.slice(0, 180),
									channelId: channel.id,
									iconUrl: photo,
									iconDataUrl: iconDataUrl ?? undefined,
								});
							});
						}
					}
				}
				messageCountRef.current[channel.id] = messages.length;
				dispatch({type: 'setChannelMessages', channelId: channel.id, messages});
			}),
		);
		return () => {
			for (const off of unsubscribe) off();
		};
		// textChannelIds resume los ids: la suscripción se rehace sólo cuando cambia la lista.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [textChannelIds]);

	// El globito de la barra de tareas sigue el total de mensajes sin leer.
	useEffect(() => {
		const total = Object.values(state.unread).reduce((sum, value) => sum + value, 0);
		setTaskbarBadge(total);
	}, [state.unread]);

	// Al volver a la ventana, el canal que estás mirando queda como leído.
	useEffect(() => {
		const onFocus = () => dispatch({type: 'markRead', channelId: activeChannelRef.current});
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, []);

	// Click en una notificación de Windows: trae la app al frente en ese canal.
	useEffect(() => subscribeNotificationClick((channelId) => {
		if (channelId) dispatch({type: 'selectChannel', channelId});
	}), []);

	// Los botones de la ventana (minimizar/maximizar/cerrar) los dibuja Windows ENCIMA del
	// contenido, arriba a la derecha. Su ancho depende de la escala de la pantalla, así que se
	// reserva ese espacio en las cabeceras: si no, tapan el botón de pantalla completa y compañía.
	useEffect(() => {
		const update = () => {
			// Cada botón mide 46px a 100%; son tres, y escalan con la resolución de Windows.
			const width = Math.round(46 * 3 * (window.devicePixelRatio || 1));
			document.documentElement.style.setProperty('--window-controls-width', `${width}px`);
		};
		update();
		window.addEventListener('resize', update);
		return () => window.removeEventListener('resize', update);
	}, []);

	// Atajos globales: se registran (y se vuelven a registrar) cuando cambian.
	// Lo que Windows no acepta se guarda en `hotkeyFailures` para avisarlo en Ajustes: si no,
	// el usuario aprieta la tecla, no pasa nada y parece que la app está rota.
	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		const bindings = Object.entries(state.settings.hotkeys ?? {}).map(([action, accelerator]) => ({action, accelerator}));
		void transport
			.setHotkeys(bindings)
			.then((failed) => {
				setHotkeyFailures(Array.isArray(failed) ? failed : []);
				if (Array.isArray(failed) && failed.length > 0) {
					console.warn('[pelacord] atajos que no se pudieron registrar (¿los usa otro programa?):', failed);
				}
			})
			.catch(() => setHotkeyFailures([]));
	}, [state.settings.hotkeys]);

	const sendMessage = useCallback(
		(content: string, attachments: Attachment[]) => {
			if (!content.trim() && attachments.length === 0) return;
			const channelId = state.activeChannelId;
			if (isRemoteEnabled()) {
				const message: Message = {
					id: uid(),
					channelId,
					authorId: state.me.id,
					authorName: state.me.name,
					authorColor: state.me.avatarColor,
					content,
					createdAt: Date.now(),
					attachments,
				};
				void postMessage(channelId, message).catch((error: unknown) => {
					console.error('[pelacord-error] no se pudo enviar el mensaje:', error);
				});
			} else {
				dispatch({type: 'sendMessage', channelId, content, attachments});
			}
		},
		[state.activeChannelId, state.me.id, state.me.name, state.me.avatarColor],
	);

	const updateProfile = useCallback((patch: Partial<Member>) => {
		// Si cambia alguna imagen del perfil, sube la versión: así los demás la vuelven a guardar
		// en disco (si no, seguirían mostrando la vieja cuando el otro esté desconectado).
		const assetKeys = ['avatarUrl', 'bannerUrl', 'customDeco', 'customParticle', 'decoImage', 'particleImage'];
		const touchesAssets = Object.keys(patch).some((key) => assetKeys.includes(key));
		dispatch({type: 'updateProfile', patch: touchesAssets ? {...patch, profileVersion: Date.now()} : patch});
	}, []);
	const updateSettings = useCallback((patch: Partial<Settings>) => dispatch({type: 'updateSettings', patch}), []);
	const setCssVariable = useCallback((name: string, value: string) => dispatch({type: 'setCssVariable', name, value}), []);

	const editMessage = useCallback(
		(messageId: string, content: string) => {
			const channelId = state.activeChannelId;
			if (isRemoteEnabled()) {
				void updateMessage(channelId, messageId, content).catch(() => {});
			} else {
				dispatch({type: 'editMessage', channelId, messageId, content});
			}
		},
		[state.activeChannelId],
	);

	const removeMessage = useCallback(
		(messageId: string) => {
			const channelId = state.activeChannelId;
			if (isRemoteEnabled()) {
				void deleteRemoteMessage(channelId, messageId).catch(() => {});
			} else {
				dispatch({type: 'deleteMessage', channelId, messageId});
			}
		},
		[state.activeChannelId],
	);

	const addChannel = useCallback((type: ChannelType, name: string) => {
		const clean = name.trim().slice(0, 60);
		if (!clean) return;
		const channel: Channel = {
			id: `ch-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`,
			type,
			name: clean,
			category: type === 'text' ? TEXT_CATEGORY : VOICE_CATEGORY,
		};
		dispatch({type: 'addChannel', channel});
		if (isRemoteEnabled()) {
			void putChannel(channel).catch((error) => console.warn('[pelacord] no se pudo guardar el canal', error));
		}
	}, []);

	const removeChannel = useCallback((channelId: string) => {
		dispatch({type: 'deleteChannel', channelId});
		if (isRemoteEnabled()) {
			void removeRemoteChannel(channelId).catch((error) => console.warn('[pelacord] no se pudo borrar el canal', error));
		}
	}, []);

	/**
	 * Mueve a alguien a otro canal de voz (se usa al arrastrarlo en la barra lateral).
	 * Si soy yo, entro directo; si es otro, se le manda el comando y él decide entrar.
	 */
	const moveMember = useCallback((peerId: string, channelId: string) => {
		if (peerId === meRef.current.id) {
			dispatch({type: 'joinVoice', channelId});
			return;
		}
		getDesktopTransport()?.sendCommand(peerId, {kind: 'move', channelId});
	}, []);

	/** Comandos a otro peer: silenciar, ensordecer, desconectar. Los aplica el que los recibe. */
	const sendPeerCommand = useCallback(
		(peerId: string, payload: {kind: 'mute' | 'deafen' | 'disconnect'; on?: boolean}) => {
			if (peerId === meRef.current.id) {
				// A uno mismo se le aplica local, sin dar la vuelta por la malla.
				if (payload.kind === 'mute') dispatch({type: 'toggleVoiceFlag', flag: 'muted'});
				else if (payload.kind === 'deafen') dispatch({type: 'toggleVoiceFlag', flag: 'deafened'});
				else dispatch({type: 'leaveVoice'});
				return;
			}
			getDesktopTransport()?.sendCommand(peerId, payload);
		},
		[],
	);

	// ---------- Música: la Jam (el que manda el audio es el "host") ----------

	const [musicState, setMusicState] = useState<MusicState>(EMPTY_MUSIC_STATE);
	/** Última cola escuchada, para poder modificarla sin depender del render. */
	const musicStateRef = useRef<MusicState>(EMPTY_MUSIC_STATE);
	musicStateRef.current = musicState;
	/** Id del track que estoy mandando (para saber si tengo que cambiar de tema). */
	const myMusicTrackId = useRef<string | null>(null);

	useEffect(() => subscribeMusicState(setMusicState), []);

	/** Pone un tema (o corta con null). Cualquiera puede: es estilo Jam. */
	const musicPlay = useCallback(async (track: MusicTrack | null, startAtMs = 0) => {
		await updateMusicState({
			track,
			startedAt: track ? Date.now() - startAtMs : 0,
			pausedAt: null,
			positionMs: startAtMs,
			// El host se elige solo entre los que están en el canal.
			hostId: null,
			hostSeenAt: 0,
		});
	}, []);

	const musicEnqueue = useCallback((track: MusicTrack) => {
		return updateMusicState({queue: appendToQueue(musicStateRef.current, track)});
	}, []);

	const musicRemove = useCallback((index: number) => {
		return updateMusicState({queue: removeFromQueue(musicStateRef.current, index)});
	}, []);

	const musicMove = useCallback((from: number, to: number) => {
		return updateMusicState({queue: moveInQueue(musicStateRef.current, from, to)});
	}, []);

	/** Salta a lo que sigue en la cola. */
	const musicSkip = useCallback(async () => {
		const state = musicStateRef.current;
		const [next, ...rest] = state.queue;
		if (!next) {
			await updateMusicState({track: null, queue: [], startedAt: 0, positionMs: 0, pausedAt: null, hostId: null});
			return;
		}
		await updateMusicState({
			track: next,
			queue: rest,
			startedAt: Date.now(),
			positionMs: 0,
			pausedAt: null,
			hostId: null,
			hostSeenAt: 0,
		});
	}, []);

	/** Pausa o retoma (se guarda el segundo exacto para que todos sigan en el mismo lugar). */
	const musicTogglePause = useCallback(async () => {
		const state = musicStateRef.current;
		if (!state.track) return;
		if (state.pausedAt) {
			const position = state.positionMs;
			await updateMusicState({pausedAt: null, startedAt: Date.now() - position, positionMs: position});
		} else {
			await updateMusicState({pausedAt: Date.now(), positionMs: currentPositionMs(state)});
		}
	}, []);

	/** Separarse de la Jam (para escuchar la propia) o volver. */
	const musicSetDetached = useCallback((detached: boolean) => {
		dispatch({type: 'updateSettings', patch: {musicDetached: detached}});
	}, []);

	const musicSetVolume = useCallback((value: number) => {
		voiceMesh.setMusicVolume(value);
		dispatch({type: 'updateSettings', patch: {musicVolume: value}});
	}, []);

	/**
	 * El motor de la Jam. Corre en todos, pero sólo uno manda el audio:
	 * - Si no hay host (o el host dejó de avisar), el primero que está en el canal lo toma.
	 * - El host reproduce, manda el audio por la malla y avisa que sigue vivo.
	 * - Si alguien más manda el audio, no hago nada: lo escucho por RemoteMedia.
	 */
	useEffect(() => {
		const inVoice = Boolean(state.voice.channelId);
		const track = musicState.track;
		const hostAlive = isHostAlive(musicState);
		const iAmHost = musicState.hostId === state.me.id;

		// Sin tema, o no estoy en el canal: me aseguro de no estar mandando nada.
		if (!track || !inVoice) {
			if (myMusicTrackId.current) {
				myMusicTrackId.current = null;
				stopMusicStream();
				void voiceMesh.setMusicStream(null);
				voiceMesh.announceMusicStream(null);
			}
			if (iAmHost) void updateMusicState({hostId: null, hostSeenAt: 0});
			return;
		}

		// Alguien más está mandando: si era yo, corto.
		if (hostAlive && !iAmHost) {
			if (myMusicTrackId.current) {
				myMusicTrackId.current = null;
				stopMusicStream();
				void voiceMesh.setMusicStream(null);
				voiceMesh.announceMusicStream(null);
			}
			return;
		}

		// Me toca a mí (nadie más lo está haciendo).
		let cancelled = false;
		void (async () => {
			try {
				// Ya estoy con este tema: sólo aviso que sigo vivo.
				if (myMusicTrackId.current === track.id) {
					await updateMusicState({hostId: state.me.id, hostSeenAt: Date.now()});
					return;
				}
				const url = await getDesktopTransport()?.getAudioUrl(track.url || track.id);
				if (cancelled) return;
				if (!url) return;
				const positionMs = currentPositionMs(musicState);
				const handle = await startMusicStream(url, positionMs / 1000);
				if (cancelled) {
					stopMusicStream();
					return;
				}
				myMusicTrackId.current = track.id;
				await voiceMesh.setMusicStream(handle.stream);
				voiceMesh.announceMusicStream(handle.stream.id);
				await updateMusicState({hostId: state.me.id, hostSeenAt: Date.now()});
				// Cuando termina, salta solo al siguiente.
				handle.onEnded(() => {
					myMusicTrackId.current = null;
					void voiceMesh.setMusicStream(null);
					voiceMesh.announceMusicStream(null);
					void musicSkip();
				});
			} catch (error) {
				console.warn('[pelacord] no pude arrancar la música', String(error));
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [musicState, state.voice.channelId, state.me.id, musicSkip]);

	// El host avisa que sigue vivo (cada 15 s: si se va, otro toma el control).
	useEffect(() => {
		if (musicState.hostId !== state.me.id || !musicState.track) return;
		const timer = setInterval(() => {
			void updateMusicState({hostId: state.me.id, hostSeenAt: Date.now()});
		}, 15000);
		return () => clearInterval(timer);
	}, [musicState.hostId, musicState.track, state.me.id]);

	// Volumen guardado de la música.
	useEffect(() => {
		voiceMesh.setMusicVolume(state.settings.musicVolume ?? 0.8);
	}, [state.settings.musicVolume]);

	const value = useMemo<StoreContextValue>(
		() => ({
			state,
			dispatch,
			sendMessage,
			editMessage,
			removeMessage,
			updateProfile,
			updateSettings,
			setCssVariable,
			addChannel,
			removeChannel,
			moveMember,
			sendPeerCommand,
			hotkeyFailures,
			musicState,
			musicPlay,
			musicEnqueue,
			musicRemove,
			musicMove,
			musicSkip,
			musicTogglePause,
			musicSetDetached,
			musicSetVolume,
		}),
		[
			state,
			sendMessage,
			editMessage,
			removeMessage,
			updateProfile,
			updateSettings,
			setCssVariable,
			addChannel,
			removeChannel,
			moveMember,
			sendPeerCommand,
			hotkeyFailures,
			musicState,
			musicPlay,
			musicEnqueue,
			musicRemove,
			musicMove,
			musicSkip,
			musicTogglePause,
			musicSetDetached,
			musicSetVolume,
		],
	);

	return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
	const context = useContext(StoreContext);
	if (!context) throw new Error('useStore must be used within a StoreProvider');
	return context;
}

export function resolveMember(state: AppState, id: string): Member {
	if (state.me.id === id) return state.me;
	return state.members.find((m) => m.id === id) ?? state.me;
}
