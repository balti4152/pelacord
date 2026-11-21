import {useEffect, useMemo, useRef, useState} from 'react';
import {
	Armchair, Brush, Coins, Hand, Headphones, Home, Laugh, LogOut, MapPin, Mic, MicOff, Phone, Shirt, User, UserPlus, Volume2, VolumeX, Keyboard, X,
} from 'lucide-react';
import {useLocalScreen, useRemoteVideo, useSpeakingIds} from '@/components/RemoteMedia';
import {getDesktopTransport, type TrackResult} from '@/lib/desktop';
import {openSharePicker} from '@/lib/sharePicker';
import {
	addCoins, type Anim, type CatalogItem, type Emote, getProfile, onEmote, onInvite, type PlacedFurniture, type PlayerState, ROOMS, type RoomId,
	sendWorld, updateProfile, useCatalog, useProfile, useWorldPeers,
} from '@/world/core';
import {type Interaction, WorldEngine} from '@/world/engine';
import {spatialVoices} from '@/world/spatialAudio';
import {type CardColor, table, useTableSession} from '@/world/tableGames';
import {TableView} from '@/world/tableView';
import {DecoratePanel, EditorPanel, InvitePanel, ShopPanel, TablePanel, TvPanel} from '@/components/world/WorldPanels';
import {useStore} from '@/state/store';

type Panel = null | 'editor' | 'shop-clothes' | 'shop-furniture' | 'decorate' | 'invite' | 'tv';
const SPATIAL_KEY = 'pelacord.world.spatial';
const HINT_KEY = 'pelacord.world.hint';

function roomTitle(room: RoomId, owner: string | null, names: Record<string, string>, meId: string): string {
	if (owner) return owner === meId ? 'Mi casa' : `Casa de ${names[owner] ?? 'un amigo'}`;
	return ROOMS.find((r) => r.id === room)?.name ?? 'Ciudad';
}

/**
 * El mundo 3D de PelaCord: una ciudad para caminar (WASD) con locales (cine, tienda, casa de juegos,
 * living, campamento) y tu casa. Todo se sincroniza por la malla P2P en el canal `world`.
 */
export function WorldView({onClose, onOpenMovies}: {onClose: () => void; onOpenMovies?: () => void}): JSX.Element {
	const {state, dispatch, musicState, musicPlay, movieRoomsList} = useStore();
	const catalog = useCatalog();
	const profile = useProfile();
	const peers = useWorldPeers();
	const speakingIds = useSpeakingIds();
	const remoteScreen = useRemoteVideo();
	const localScreen = useLocalScreen();
	const session = useTableSession();
	const hostRef = useRef<HTMLDivElement>(null);
	const engineRef = useRef<WorldEngine | null>(null);
	const tableViewRef = useRef<TableView | null>(null);
	const [room, setRoom] = useState<RoomId>('city');
	const previousRoom = useRef<RoomId | null>(null);
	const [panel, setPanel] = useState<Panel>(null);
	const [tryOn, setTryOn] = useState<CatalogItem | null>(null);
	const [placing, setPlacing] = useState<PlacedFurniture | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [tableSeat, setTableSeat] = useState<number | null>(null);
	const [wildCard, setWildCard] = useState<string | null>(null);
	const [invite, setInvite] = useState<{id: string; name: string; room: RoomId} | null>(null);
	const [toast, setToast] = useState('');
	const [results, setResults] = useState<TrackResult[]>([]);
	const [searching, setSearching] = useState(false);
	const [showHint, setShowHint] = useState(() => {
		try {
			return localStorage.getItem(HINT_KEY) !== '0';
		} catch {
			return true;
		}
	});
	const [spatial, setSpatial] = useState(() => {
		try {
			return localStorage.getItem(SPATIAL_KEY) !== '0';
		} catch {
			return true;
		}
	});
	const local = useRef<{x: number; z: number; ry: number; anim: Anim; seat: string | null; tx: number; tz: number}>({x: 0, z: -4.6, ry: 0, anim: 'idle', seat: null, tx: 0, tz: -4.6});
	const roomRef = useRef(room);
	roomRef.current = room;
	const firstTime = !profile.created;
	const inVoice = Boolean(state.voice.channelId);

	const names = useMemo(() => {
		const map: Record<string, string> = {};
		for (const member of state.members) map[member.id] = member.name;
		for (const p of Object.values(peers)) map[p.id] ??= p.name;
		return map;
	}, [state.members, peers]);
	const nameOf = (id: string) => (id === state.me.id ? state.me.name : id.startsWith('bot:') ? `Compu ${id.slice(4)}` : names[id] ?? 'Alguien');
	const nameRef = useRef(nameOf);
	nameRef.current = nameOf;
	const info = useMemo(() => {
		const map: Record<string, {name: string; avatarUrl?: string}> = {};
		for (const member of state.members) map[member.id] = {name: member.name, avatarUrl: member.avatarUrl};
		return map;
	}, [state.members]);

	function flash(message: string): void {
		setToast(message);
		setTimeout(() => setToast((t) => (t === message ? '' : t)), 3200);
	}

	// ------------------------------------------------------------- anuncio --

	const announce = (): void => {
		const p = getProfile();
		const s: PlayerState = {
			id: state.me.id, name: state.me.name, color: state.me.avatarColor, room: roomRef.current, ...local.current,
			look: p.look, house: p.furniture.filter((f) => f.x !== null), t: Date.now(),
		};
		sendWorld({kind: 'state', s});
	};
	const announceRef = useRef(announce);
	announceRef.current = announce;

	// ------------------------------------------------------------- motor ----

	useEffect(() => {
		if (!catalog || !hostRef.current) return;
		table.init(state.me.id, (id) => nameRef.current(id));
		const engine = new WorldEngine(hostRef.current, catalog, {
			onLocalChange: (s) => {
				local.current = s;
				announceRef.current();
			},
			onDoor: (next) => setRoom(next),
			onInteract: (action: Interaction) => {
				if (action.kind === 'tv') setPanel('tv');
				else if (action.kind === 'npc') setPanel('shop-clothes');
				else if (action.kind === 'hotspot') setPanel(action.hotspot === 'furniture' ? 'shop-furniture' : action.hotspot === 'fitting' ? 'editor' : 'shop-clothes');
			},
			onTable: (seat) => setTableSeat(seat),
			onPlayerClick: (id) => setSelected(id),
			onPlace: (x, z, rot) => {
				setPlacing((current) => {
					if (current) updateProfile((p) => ({furniture: p.furniture.map((f) => (f.uid === current.uid ? {...f, x, z, rot} : f))}));
					return null;
				});
			},
			onFurniturePick: (uid) => {
				const item = getProfile().furniture.find((f) => f.uid === uid);
				if (item) setPlacing(item);
			},
		});
		engineRef.current = engine;
		tableViewRef.current = new TableView(engine.tableRoot);
		const p = getProfile();
		void engine.setMe(state.me.id, state.me.name, state.me.avatarColor, p.look, state.me.avatarUrl);
		void engine.loadRoom(roomRef.current, null);
		engine.focus();
		return () => {
			sendWorld({kind: 'leave', id: state.me.id});
			tableViewRef.current?.dispose();
			engine.dispose();
			engineRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [catalog]);

	// Cambiar de lugar (puertas de la ciudad, salir, casas).
	const houseOwner = room.startsWith('house:') ? room.slice(6) : null;
	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		setPlacing(null);
		setPanel((p) => (p === 'decorate' || p === 'invite' || p === 'tv' ? null : p));
		const furniture = houseOwner === state.me.id ? getProfile().furniture : houseOwner ? (peers[houseOwner]?.house ?? []) : null;
		void engine.loadRoom(room, furniture, previousRoom.current);
		previousRoom.current = room;
		engine.focus();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [room]);

	const houseKey = houseOwner === state.me.id ? JSON.stringify(profile.furniture) : houseOwner ? JSON.stringify(peers[houseOwner]?.house ?? []) : '';
	useEffect(() => {
		if (!houseOwner || !engineRef.current) return;
		void engineRef.current.setHouse(houseOwner === state.me.id ? profile.furniture : (peers[houseOwner]?.house ?? []));
		if (houseOwner === state.me.id) announceRef.current();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [houseKey]);

	useEffect(() => {
		void engineRef.current?.setMe(state.me.id, state.me.name, state.me.avatarColor, profile.look, state.me.avatarUrl);
		announceRef.current();
	}, [profile.look, state.me.id, state.me.name, state.me.avatarColor, state.me.avatarUrl]);

	useEffect(() => {
		engineRef.current?.syncPeers(Object.values(peers), info);
	}, [peers, info, room]);

	useEffect(() => {
		engineRef.current?.setSpeaking(new Set(speakingIds));
	}, [speakingIds]);

	// La tele muestra lo mismo para todos: pantalla compartida > película de Pelaflix > tema de la Jam.
	const movie = movieRoomsList[0];
	useEffect(() => {
		const stream = remoteScreen ?? localScreen;
		if (stream) engineRef.current?.setScreen({stream});
		else if (movie) engineRef.current?.setScreen({image: movie.media.poster || null, title: `Pelaflix: ${movie.media.title}`});
		else if (musicState.track) engineRef.current?.setScreen({image: musicState.track.thumbnail, title: musicState.track.title});
		else engineRef.current?.setScreen({});
	}, [remoteScreen, localScreen, movie, musicState.track, room]);

	useEffect(() => onEmote((m) => {
		if (m.room === roomRef.current) engineRef.current?.emote(m.id, m.emote, m.target);
	}), []);

	useEffect(() => onInvite((m) => setInvite({id: m.id, name: names[m.id] ?? m.name, room: m.room})), [names]);

	useEffect(() => {
		const heartbeat = setInterval(() => announceRef.current(), 2000);
		const coins = setInterval(() => addCoins(10), 120000);
		return () => {
			clearInterval(heartbeat);
			clearInterval(coins);
		};
	}, []);

	// Audio espacial.
	useEffect(() => {
		spatialVoices.setActive(spatial);
		try {
			localStorage.setItem(SPATIAL_KEY, spatial ? '1' : '0');
		} catch {
			// sin almacenamiento
		}
		return () => spatialVoices.setActive(false);
	}, [spatial]);
	useEffect(() => {
		const timer = setInterval(() => {
			const engine = engineRef.current;
			if (!engine || !spatialVoices.isActive()) return;
			const {me, peers: here} = engine.positions();
			const positions: Record<string, {x: number; z: number} | null> = {};
			for (const id of Object.keys(peers)) positions[id] = here[id] ?? null;
			spatialVoices.update(me, positions);
		}, 80);
		return () => clearInterval(timer);
	}, [peers]);

	// Decorar.
	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		engine.setDecorating(placing ? {id: placing.id, color: placing.color, rot: placing.rot} : null);
		engine.editMode = panel === 'decorate';
	}, [placing, panel]);

	// Mesa de juegos: quién está sentado, el dibujo 3D y los clics en cartas/casilleros.
	const seated = useMemo(() => {
		const list: Array<{id: string; seat: number}> = [];
		const parse = (seat: string | null) => (seat ? /^Seat_Table_(\d+)/.exec(seat)?.[1] : undefined);
		if (room === 'games' && tableSeat !== null) list.push({id: state.me.id, seat: tableSeat});
		for (const p of Object.values(peers)) {
			const n = p.room === 'games' ? parse(p.seat) : undefined;
			if (n) list.push({id: p.id, seat: Number(n)});
		}
		return list.sort((a, b) => a.seat - b.seat);
	}, [peers, room, tableSeat, state.me.id]);
	useEffect(() => {
		const engine = engineRef.current;
		const view = tableViewRef.current;
		if (!engine || !view) return;
		if (room !== 'games' || !session) {
			view.render(null, state.me.id, () => 0, nameOf);
			return;
		}
		const seatOf: Record<string, number> = {};
		for (const s of seated) seatOf[s.id] = s.seat;
		const free = [1, 2, 3, 4, 5, 6].filter((n) => !Object.values(seatOf).includes(n));
		for (const p of session.players) if (seatOf[p] === undefined) seatOf[p] = free.shift() ?? 1;
		view.render(session, state.me.id, (p) => engine.tableAngle(seatOf[p] ?? 1), nameOf);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [session, seated, room]);
	// Se engancha cuando existe el motor (que se arma recién al llegar el catálogo).
	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		engine.onTableClick = (obj) => {
			const pick = obj.userData.pick as {type: string; id?: string; i?: number};
			const current = table.get();
			if (!current) return;
			if (pick.type === 'draw') table.move({kind: 'draw'});
			else if (pick.type === 'cell' && pick.i !== undefined) table.move({kind: 'cell', cell: pick.i});
			else if (pick.type === 'card' && pick.id) {
				const card = current.hands?.[state.me.id]?.find((c) => c.id === pick.id);
				if (card?.color === 'w') setWildCard(card.id);
				else table.move({kind: 'play', card: pick.id});
			}
		};
	}, [state.me.id, catalog]);

	// Escape cierra paneles.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			if (placing) setPlacing(null);
			else if (panel && !firstTime) setPanel(null);
			else setSelected(null);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [placing, panel, firstTime]);

	// Al cerrar un panel, el teclado vuelve al mundo (para seguir con WASD).
	useEffect(() => {
		if (!panel) engineRef.current?.focus();
	}, [panel]);

	function emote(kind: Emote): void {
		const engine = engineRef.current;
		if (!engine) return;
		const target = kind === 'slap' ? engine.nearestTo() : null;
		engine.emote(state.me.id, kind, target);
		sendWorld({kind: 'emote', id: state.me.id, room, emote: kind, target});
	}

	function joinVoice(): void {
		const channel = state.channels.find((c) => c.type === 'voice');
		if (channel) dispatch({type: 'joinVoice', channelId: channel.id});
	}

	async function searchMusic(query: string): Promise<void> {
		if (!query.trim()) return;
		setSearching(true);
		const list = (await getDesktopTransport()?.searchYouTube(query, 10).catch(() => [])) ?? [];
		setResults(list);
		setSearching(false);
	}

	const here = Object.values(peers).filter((p) => p.room === room);
	const selectedPeer = selected ? peers[selected] : null;
	const onlineFriends = state.members.filter((m) => m.id !== state.me.id && m.presence !== 'offline').map((m) => ({id: m.id, name: m.name, online: true}));
	const title = roomTitle(room, houseOwner, names, state.me.id);

	return (
		<div className="world">
			<div className="world-stage" ref={hostRef} />
			{!catalog ? <div className="world-loading"><span className="t-spinner" /> Armando el mundo…</div> : null}

			<header className="t-hud-top">
				<div className="t-chip t-place">
					<MapPin size={16} strokeWidth={2.8} />
					<strong>{title}</strong>
					<span className="t-people">{here.length + 1}</span>
				</div>
				<div className="t-hud-right">
					<span className="t-chip t-coins-chip" title="Pelamonedas: se ganan jugando y paseando"><Coins size={16} strokeWidth={2.8} /> {profile.coins}</span>
					{inVoice ? (
						<>
							<button type="button" className={`t-round${state.voice.muted ? ' is-off' : ''}`} title={state.voice.muted ? 'Activar micrófono' : 'Silenciar micrófono'} onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'muted'})}>
								{state.voice.muted ? <MicOff size={18} strokeWidth={2.6} /> : <Mic size={18} strokeWidth={2.6} />}
							</button>
							<button type="button" className={`t-round${state.voice.deafened ? ' is-off' : ''}`} title={state.voice.deafened ? 'Activar audio' : 'Ensordecer'} onClick={() => dispatch({type: 'toggleVoiceFlag', flag: 'deafened'})}>
								{state.voice.deafened ? <VolumeX size={18} strokeWidth={2.6} /> : <Volume2 size={18} strokeWidth={2.6} />}
							</button>
							<button type="button" className={`t-round${spatial ? ' is-on' : ''}`} title={spatial ? 'Audio espacial: las voces salen desde cada personaje' : 'Audio espacial apagado'} onClick={() => setSpatial((v) => !v)}>
								<Headphones size={18} strokeWidth={2.6} />
							</button>
						</>
					) : (
						<button type="button" className="t-pill is-mint" onClick={joinVoice} title="Entrar a la llamada para hablar con los que están en el mundo"><Phone size={16} strokeWidth={2.8} /> Hablar</button>
					)}
					<button type="button" className="t-round" title="Mi personaje" onClick={() => { setTryOn(null); setPanel('editor'); }}><User size={18} strokeWidth={2.6} /></button>
					<button type="button" className="t-round is-exit" title="Salir del mundo" onClick={onClose}><LogOut size={18} strokeWidth={2.6} /></button>
				</div>
			</header>

			{houseOwner === state.me.id ? (
				<div className="t-house-bar">
					<button type="button" className={`t-pill${panel === 'decorate' ? ' is-active' : ''}`} onClick={() => setPanel(panel === 'decorate' ? null : 'decorate')}><Brush size={16} strokeWidth={2.8} /> Decorar</button>
					<button type="button" className="t-pill" onClick={() => setPanel('invite')}><UserPlus size={16} strokeWidth={2.8} /> Invitar</button>
					<button type="button" className="t-pill" onClick={() => setPanel('shop-furniture')}><Armchair size={16} strokeWidth={2.8} /> Catálogo</button>
				</div>
			) : null}

			{tableSeat === null ? (
				<footer className="t-emotes">
					<button type="button" onClick={() => emote('wave')} title="Saludar"><Hand size={20} strokeWidth={2.6} /><span>Saludar</span></button>
					<button type="button" onClick={() => emote('slap')} title="Cachetada"><Hand size={20} strokeWidth={2.6} className="is-flip" /><span>Cachetada</span></button>
					<button type="button" onClick={() => emote('laugh')} title="Risa"><Laugh size={20} strokeWidth={2.6} /><span>Risa</span></button>
					<button type="button" onClick={() => { setTryOn(null); setPanel('shop-clothes'); }} title="Ropa"><Shirt size={20} strokeWidth={2.6} /><span>Ropa</span></button>
					{houseOwner !== state.me.id ? (
						<button type="button" onClick={() => setRoom(`house:${state.me.id}`)} title="Ir a mi casa"><Home size={20} strokeWidth={2.6} /><span>Mi casa</span></button>
					) : null}
				</footer>
			) : null}

			{showHint && !firstTime ? (
				<div className="t-hint-card">
					<Keyboard size={18} strokeWidth={2.6} />
					<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> caminar · <kbd>Shift</kbd> correr · <kbd>E</kbd> sentarse, entrar y usar</span>
					<button type="button" className="t-close is-small" aria-label="Ocultar" onClick={() => { setShowHint(false); try { localStorage.setItem(HINT_KEY, '0'); } catch { /* */ } }}><X size={14} strokeWidth={3} /></button>
				</div>
			) : null}

			{selectedPeer ? (
				<div className="t-popover">
					<strong>{names[selectedPeer.id] ?? selectedPeer.name}</strong>
					<button type="button" className="t-btn is-soft is-small" onClick={() => { setRoom(`house:${selectedPeer.id}`); setSelected(null); }}><Home size={13} strokeWidth={3} /> Ir a su casa</button>
					<button type="button" className="t-close is-small" onClick={() => setSelected(null)} aria-label="Cerrar"><X size={14} strokeWidth={3} /></button>
				</div>
			) : null}

			{invite ? (
				<div className="t-banner">
					<Home size={18} strokeWidth={2.8} />
					<span><strong>{invite.name}</strong> te invita a su casa</span>
					<button type="button" className="t-btn is-primary is-small" onClick={() => { setRoom(invite.room); setInvite(null); }}>Ir</button>
					<button type="button" className="t-btn is-soft is-small" onClick={() => setInvite(null)}>Ahora no</button>
				</div>
			) : null}
			{toast ? <div className="t-toast-float">{toast}</div> : null}

			{room === 'games' && tableSeat !== null ? (
				<TablePanel
					session={session}
					me={state.me.id}
					seated={seated.map((s) => s.id)}
					names={nameOf}
					onStart={(game, bots) => table.start(game, seated.map((s) => s.id), bots)}
					onLeave={() => engineRef.current?.standUp()}
					colorPick={wildCard !== null}
					onColor={(color: CardColor) => {
						if (wildCard) table.move({kind: 'play', card: wildCard, color});
						setWildCard(null);
					}}
					onEnd={() => table.end()}
				/>
			) : null}

			{catalog && (panel === 'editor' || firstTime) ? <EditorPanel key={tryOn?.id ?? 'editor'} catalog={catalog} firstTime={firstTime} tryOn={tryOn} onClose={() => { setTryOn(null); setPanel(null); }} /> : null}
			{catalog && panel === 'shop-clothes' ? <ShopPanel catalog={catalog} kind="clothes" onClose={() => setPanel(null)} onTry={(item) => { setTryOn(item); setPanel('editor'); }} /> : null}
			{catalog && panel === 'shop-furniture' ? <ShopPanel catalog={catalog} kind="furniture" onClose={() => setPanel(null)} onTry={() => {}} /> : null}
			{catalog && panel === 'decorate' ? (
				<DecoratePanel catalog={catalog} placing={placing} onPlace={(item) => setPlacing(item)} onRotate={() => engineRef.current?.rotateGhost()} onClose={() => { setPlacing(null); setPanel(null); }} />
			) : null}
			{panel === 'invite' ? (
				<InvitePanel
					friends={onlineFriends}
					onInvite={(id) => {
						sendWorld({kind: 'invite', id: state.me.id, name: state.me.name, room: `house:${state.me.id}`}, id);
						flash(`Invitación enviada a ${names[id] ?? 'tu amigo'}`);
					}}
					onClose={() => setPanel(null)}
				/>
			) : null}
			{panel === 'tv' ? (
				<TvPanel
					inVoice={inVoice}
					sharing={state.voice.sharing}
					onJoinVoice={joinVoice}
					onShare={() => openSharePicker()}
					onStopShare={() => dispatch({type: 'setSharing', sharing: false})}
					onSearchMusic={(q) => void searchMusic(q)}
					results={results}
					searching={searching}
					onPlay={(i) => {
						const r = results[i];
						if (!r) return;
						musicPlay({id: r.id, title: r.title, duration: r.duration, thumbnail: r.thumbnail, author: r.author, url: r.url, addedBy: state.me.name});
						flash(`Pusiste "${r.title}" en la tele`);
					}}
					nowPlaying={musicState.track?.title ?? null}
					movieRooms={movieRoomsList.map((m) => ({id: m.id, title: m.media.title, host: m.hostName}))}
					onOpenMovies={() => onOpenMovies?.()}
					onClose={() => setPanel(null)}
				/>
			) : null}
		</div>
	);
}
