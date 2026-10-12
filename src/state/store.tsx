import {createContext, type Dispatch, type ReactNode, useCallback, useContext, useEffect, useMemo, useReducer, useRef} from 'react';
import {type PeerPresence, getDesktopTransport, peerToParticipant} from '@/lib/desktop';
import {isRemoteEnabled} from '@/lib/firebase';
import {getIdentity, saveIdentity} from '@/lib/identity';
import {deleteMessage as deleteRemoteMessage, postMessage, subscribeMessages, updateMessage} from '@/lib/remote';
import {playSound} from '@/lib/sounds';
import type {
	AppState,
	Attachment,
	Member,
	Message,
	Presence,
	Settings,
	ThemeName,
	VoiceParticipant,
} from '@/types';

const STORAGE_KEY = 'pelacord.state.v4';
const CUSTOM_CSS_ID = 'pelacord-custom-css';

export function uid(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
		muted: false,
		deafened: false,
		sharing: false,
		...flags,
	};
}

const CHANNELS = [
	{id: 'ch-general', type: 'text' as const, name: 'general', category: 'Canales de texto', topic: 'Charla general de Pelacord'},
	{id: 'ch-random', type: 'text' as const, name: 'random', category: 'Canales de texto', topic: 'Lo que sea'},
	{id: 'ch-memes', type: 'text' as const, name: 'memes', category: 'Canales de texto'},
	{id: 'ch-voice-general', type: 'voice' as const, name: 'General', category: 'Canales de voz'},
	{id: 'ch-voice-gaming', type: 'voice' as const, name: 'Gaming', category: 'Canales de voz'},
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
		},
		voice: {channelId: null, muted: false, deafened: false, video: false, sharing: false, stageOpen: false, joinedAt: null},
		voiceMembers: remote ? {} : demoVoiceMembers,
	};
}

type Action =
	| {type: 'selectChannel'; channelId: string}
	| {type: 'sendMessage'; channelId: string; content: string; attachments: Attachment[]}
	| {type: 'setChannelMessages'; channelId: string; messages: Message[]}
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
	| {type: 'toggleVoiceFlag'; flag: 'muted' | 'deafened' | 'video' | 'sharing'};

function reducer(state: AppState, action: Action): AppState {
	switch (action.type) {
		case 'selectChannel':
			return {...state, activeChannelId: action.channelId, voice: {...state.voice, stageOpen: false}};
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
			return {...state, voiceMembers, voice: {channelId: null, muted: false, deafened: false, video: false, sharing: false, stageOpen: false, joinedAt: null}};
		}
		case 'minimizeVoice':
			return {...state, voice: {...state.voice, stageOpen: false}};
		case 'openVoiceStage':
			return {...state, voice: {...state.voice, stageOpen: true}};
		case 'toggleVoiceFlag': {
			if (action.flag === 'deafened') {
				const deafened = !state.voice.deafened;
				return {...state, voice: {...state.voice, deafened, muted: deafened || state.voice.muted}};
			}
			return {...state, voice: {...state.voice, [action.flag]: !state.voice[action.flag]}};
		}
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
		parsed.voice = {channelId: null, muted: false, deafened: false, video: false, sharing: false, stageOpen: false, joinedAt: null};
		parsed.voiceMembers = {};
		if (typeof parsed.settings.inputDeviceId !== 'string') parsed.settings.inputDeviceId = 'default';
		if (typeof parsed.settings.outputDeviceId !== 'string') parsed.settings.outputDeviceId = 'default';
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

	const root = document.documentElement;
	for (const name of Object.keys(state.settings.cssVariables)) root.style.removeProperty(name);
	for (const [name, value] of Object.entries(state.settings.cssVariables)) {
		if (name.startsWith('--')) root.style.setProperty(name, value);
	}

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
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({children}: {children: ReactNode}): JSX.Element {
	const [state, dispatch] = useReducer(reducer, undefined, loadState);
	const meRef = useRef(state.me);
	meRef.current = state.me;
	const voiceRef = useRef(state.voice);
	voiceRef.current = state.voice;
	const peersRef = useRef<Record<string, PeerPresence>>({});
	const lastSeenRef = useRef<Record<string, number>>({});
	const sharingRef = useRef<Record<string, boolean>>({});
	const messageCountRef = useRef<Record<string, number>>({});
	const fileEndpointRef = useRef<{host: string; port: number} | null>(null);

	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		void transport
			.getFileEndpoint()
			.then((endpoint) => {
				fileEndpointRef.current = endpoint;
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

	const applyPresence = useCallback(() => {
		const me = meRef.current;
		const voice = voiceRef.current;
		const voiceMembers: Record<string, VoiceParticipant[]> = {};
		const members: Member[] = [me];
		for (const peer of Object.values(peersRef.current)) {
			if (peer.id === me.id) continue;
			members.push({
				id: peer.id,
				name: peer.name,
				tag: '0000',
				presence: 'online',
				avatarColor: peer.color,
				avatarUrl: peer.avatarUrl,
				accentColor: 'hsl(242, 70%, 55%)',
				bio: peer.bio,
				status: peer.status,
			});
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
		dispatch({type: 'setVoiceMembers', voiceMembers});
		dispatch({type: 'setRemoteMembers', members});
	}, []);

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

	// Messages come from Firestore. Voice presence deliberately does NOT: it runs peer-to-peer
	// over ZeroTier through the desktop transport, so it never touches the Firebase quota.
	useEffect(() => {
		if (!isRemoteEnabled()) return;
		const channelId = state.activeChannelId;
		return subscribeMessages(channelId, (messages) => {
			const previous = messageCountRef.current[channelId];
			const last = messages[messages.length - 1];
			if (previous !== undefined && messages.length > previous && last && last.authorId !== meRef.current.id) {
				playSound('message');
			}
			messageCountRef.current[channelId] = messages.length;
			dispatch({type: 'setChannelMessages', channelId, messages});
		});
	}, [state.activeChannelId]);

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

	const updateProfile = useCallback((patch: Partial<Member>) => dispatch({type: 'updateProfile', patch}), []);
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

	const value = useMemo<StoreContextValue>(
		() => ({state, dispatch, sendMessage, editMessage, removeMessage, updateProfile, updateSettings, setCssVariable}),
		[state, sendMessage, editMessage, removeMessage, updateProfile, updateSettings, setCssVariable],
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
