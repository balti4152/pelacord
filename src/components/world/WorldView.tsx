import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	Armchair, Brush, Coins, Power, Fish, Headphones, Home, LogOut, MapPin, Mic, MicOff, Monitor, PawPrint, Phone, Shirt, Smile, Tv, User, UserPlus, Volume2, VolumeX, Keyboard, X,
} from 'lucide-react';
import {EMOTES, type EmoteDef, EmoteMenu} from '@/components/world/EmoteMenu';
import {MoviePlayer} from '@/components/MoviePlayer';
import {useLocalScreen, useMeshRemotes, useSpeakingIds} from '@/components/RemoteMedia';
import {openSharePicker} from '@/lib/sharePicker';
import {positionOf} from '@/lib/movieRooms';
import {
	addCoins, type Anim, type CatalogItem, type Emote, getProfile, onEmote, onInvite, type PlacedFurniture, type PlayerState, ROOMS, type RoomId,
	sendWorld, updateProfile, useCatalog, useProfile, useWorldPeers,
} from '@/world/core';
import {type Interaction, WorldEngine} from '@/world/engine';
import {BAITS, biteWaitMs, currentBait, type FishKind, keepFish, rodById, rollFish, useBait} from '@/world/fish';
import {PETS} from '@/world/petCatalog';
import {recordPetCapture} from '@/world/pets';
import {spatialVoices, type VoicePlace} from '@/world/spatialAudio';
import {type CardColor, table, useTableSession} from '@/world/tableGames';
import {TableView} from '@/world/tableView';
import {currentTrack, startTv, tv, tvPosition, useTvs, volumeForDistance} from '@/world/tv';
import {tvSpeaker} from '@/world/tvAudio';
import {DecoratePanel, EditorPanel, InvitePanel, ShopPanel, TablePanel} from '@/components/world/WorldPanels';
import {TvPanel} from '@/components/world/TvPanel';
import {FishingGame, FishMarketPanel} from '@/components/world/FishingPanels';
import {PetPanel} from '@/components/world/PetPanel';
import {useStore} from '@/state/store';

type Panel = null | 'editor' | 'shop-clothes' | 'shop-furniture' | 'decorate' | 'invite' | 'tv' | 'fishmarket' | 'pet-shop' | 'pets';
const SPATIAL_KEY = 'pelacord.world.spatial';
const HINT_KEY = 'pelacord.world.hint';

function roomTitle(room: RoomId, owner: string | null, names: Record<string, string>, meId: string): string {
	if (owner) return owner === meId ? 'Mi casa' : `Casa de ${names[owner] ?? 'un amigo'}`;
	return ROOMS.find((r) => r.id === room)?.name ?? 'Ciudad';
}

/**
 * El mundo 3D de PelaCord: una ciudad para caminar (WASD) con locales (cine, tienda, casa de juegos,
 * living, campamento, puerto) y tu casa. Todo se sincroniza por la malla P2P en el canal `world`.
 *
 * `hidden`: el mundo sigue montado mientras se usa la parte 2D de PelaCord. Así, al volver, aparecés
 * donde estabas, y los demás te siguen viendo ahí (gris y medio transparente, "ausente").
 */
export function WorldView({onClose, onQuit, hidden = false}: {onClose: () => void; onQuit?: () => void; hidden?: boolean}): JSX.Element {
	const {state, dispatch, movieRoomsList, movieOpen, movieJoin, movieLeave, movieCommand, myJoinedMovieRoom} = useStore();
	const catalog = useCatalog();
	const profile = useProfile();
	const peers = useWorldPeers();
	const speakingIds = useSpeakingIds();
	const remotes = useMeshRemotes();
	const localScreen = useLocalScreen();
	const session = useTableSession();
	const tvs = useTvs();
	const hostRef = useRef<HTMLDivElement>(null);
	const tvHostRef = useRef<HTMLDivElement | null>(null);
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
	const [seated, setSeated] = useState(false);
	const [myAnim, setMyAnim] = useState<Anim>('idle');
	const [emoteOpen, setEmoteOpen] = useState(false);
	const [tvView, setTvView] = useState(false);
	const [tvHost, setTvHost] = useState<HTMLElement | null>(null);
	const tvHostCallback = useCallback((el: HTMLDivElement | null) => {
		tvHostRef.current = el;
		setTvHost(el);
	}, []);
	const [musicPos, setMusicPos] = useState(0);
	const [fishPhase, setFishPhase] = useState<null | 'wait' | 'bite' | 'game'>(null);
	const [hooked, setHooked] = useState<FishKind | null>(null);
	const fishTimer = useRef<number | null>(null);
	const fishPhaseRef = useRef(fishPhase);
	fishPhaseRef.current = fishPhase;
	const pendingShare = useRef(false);
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
	const hiddenRef = useRef(hidden);
	hiddenRef.current = hidden;
	const firstTime = !profile.created;
	const inVoice = Boolean(state.voice.channelId);
	const myTv = tvs[room] ?? null;
	const track = currentTrack(myTv);

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

	const flashRef = useRef<(message: string) => void>(() => {});
	function flash(message: string): void {
		setToast(message);
		setTimeout(() => setToast((t) => (t === message ? '' : t)), 3200);
	}
	flashRef.current = flash;

	// ------------------------------------------------------------- anuncio --

	const announce = (): void => {
		const p = getProfile();
		const s: PlayerState = {
			id: state.me.id, name: state.me.name, color: state.me.avatarColor, room: roomRef.current, ...local.current,
			look: p.look, house: p.furniture.filter((f) => f.x !== null), equippedPet: p.equippedPet,
			t: Date.now(), away: hiddenRef.current,
		};
		sendWorld({kind: 'state', s});
	};
	const announceRef = useRef(announce);
	announceRef.current = announce;

	// ------------------------------------------------------------- motor ----

	useEffect(() => {
		startTv(state.me.id);
	}, [state.me.id]);

	useEffect(() => {
		if (!catalog || !hostRef.current) return;
		table.init(state.me.id, (id) => nameRef.current(id));
		const engine = new WorldEngine(hostRef.current, catalog, {
			onLocalChange: (s) => {
				local.current = s;
				setSeated(Boolean(s.seat));
				setMyAnim(s.anim);
				announceRef.current();
			},
			onDoor: (next) => setRoom(next),
			onInteract: (action: Interaction) => {
				if (action.kind === 'tv') setPanel('tv');
				else if (action.kind === 'pet') {
					if (!getProfile().captureSpheres) flash('Comprá esferas de captura en la tienda.');
					else {
						const caught = engineRef.current?.capturePet(action.id, recordPetCapture);
						if (caught) flash(`¡Atrapaste a ${PETS[caught].name}!`);
					}
				}
				else if (action.kind === 'npc') setPanel(action.npc === 'fish' ? 'fishmarket' : 'shop-clothes');
				else if (action.kind === 'hotspot') {
					if (action.hotspot === 'fishmarket') setPanel('fishmarket');
					else setPanel(action.hotspot === 'furniture' ? 'shop-furniture' : action.hotspot === 'fitting' ? 'editor' : 'shop-clothes');
				}
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
			onFishAction: () => fishActionRef.current(),
			onTvView: (on) => setTvView(on),
		});
		engineRef.current = engine;
		const tableView = new TableView(engine.tableRoot);
		tableViewRef.current = tableView;
		engine.tickers.add((dt) => tableView.tick(dt));
		engine.onPetAppear = (name) => flashRef.current(`¡Apareció ${name}! Atrapalo antes de que se vaya`);
		const p = getProfile();
		void engine.setMe(state.me.id, state.me.name, state.me.avatarColor, p.look, state.me.avatarUrl);
		engine.setEquippedPet(p.equippedPet);
		void engine.loadRoom(roomRef.current, null);
		engine.focus();
		return () => {
			sendWorld({kind: 'leave', id: state.me.id});
			tvSpeaker.stop();
			tableViewRef.current?.dispose();
			engine.dispose();
			engineRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [catalog]);

	useEffect(() => {
		if (engineRef.current) engineRef.current.rodColor = rodById(profile.rod).color;
	}, [profile.rod, catalog]);

	// Pasar a la parte 2D: el mundo se pausa, pero no se pierde dónde estabas.
	useEffect(() => {
		engineRef.current?.setActive(!hidden);
		if (!hidden) engineRef.current?.focus();
		announceRef.current();
	}, [hidden]);

	// Cambiar de lugar (puertas de la ciudad, salir, casas).
	const houseOwner = room.startsWith('house:') ? room.slice(6) : null;
	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		setPlacing(null);
		setPanel((p) => (p === 'decorate' || p === 'invite' || p === 'tv' || p === 'fishmarket' ? null : p));
		cancelFishing();
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
		engineRef.current?.setEquippedPet(profile.equippedPet);
		announceRef.current();
	}, [profile.equippedPet]);

	useEffect(() => {
		engineRef.current?.syncPeers(Object.values(peers), info);
	}, [peers, info, room]);

	useEffect(() => {
		engineRef.current?.setSpeaking(new Set(speakingIds));
	}, [speakingIds]);

	// ------------------------------------------------------------- la tele --

	// La pantalla compartida de ESTA tele: la de quien la puso (si sigue compartiendo).
	const sharerId = myTv?.mode === 'screen' ? myTv.sharerId ?? null : null;
	const screenStream = sharerId === state.me.id ? localScreen : sharerId ? (remotes.find((r) => r.peerId === sharerId)?.video ?? null) : null;
	const movieRoom = myTv?.mode === 'movie' && myTv.movieRoomId ? movieRoomsList.find((m) => m.id === myTv.movieRoomId) ?? null : null;

	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		engine.setMusicOn(Boolean(track && !myTv?.paused));
		if (myTv?.mode === 'screen' && screenStream) engine.setScreen({stream: screenStream});
		else if (myTv?.mode === 'screen') engine.setScreen({title: `Esperando la pantalla de ${nameOf(sharerId ?? '')}…`});
		else if (movieRoom) engine.setScreen({image: movieRoom.media.poster || null, title: movieRoom.media.title});
		else if (myTv?.mode === 'movie') engine.setScreen({title: 'La película terminó'});
		else if (!track) engine.setScreen({});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [myTv?.mode, myTv?.paused, track, screenStream, movieRoom?.id, movieRoom?.media.poster, room, catalog]);

	// La música de la tele: suena sólo acá, con volumen según la distancia; la pantalla muestra lo que suena.
	useEffect(() => {
		tvSpeaker.sync(hidden ? null : myTv);
	}, [myTv, hidden]);
	useEffect(() => {
		tvSpeaker.setMaster((state.settings.musicMuted ? 0 : (state.settings.musicVolume ?? 0.8)));
	}, [state.settings.musicVolume, state.settings.musicMuted]);
	const peersRef = useRef(peers);
	peersRef.current = peers;
	useEffect(() => {
		tvSpeaker.onEnded = () => {
			const current = tvs[roomRef.current];
			if (!current || current.mode !== 'music') return;
			// Pasa al siguiente uno solo (el de id más chico de la sala), así no se saltean dos.
			const here = [state.me.id, ...Object.values(peersRef.current).filter((p) => p.room === roomRef.current && !p.away).map((p) => p.id)].sort();
			if (here[0] === state.me.id) tv.next(roomRef.current);
		};
	}, [tvs, state.me.id]);
	useEffect(() => {
		const timer = setInterval(() => {
			const engine = engineRef.current;
			if (!engine) return;
			const current = tvs[roomRef.current];
			const playing = currentTrack(current);
			const distance = hiddenRef.current ? null : engine.distanceToScreen();
			tvSpeaker.setVolume(volumeForDistance(distance));
			if (current && playing) {
				const pos = tvSpeaker.ready ? tvSpeaker.positionMs : tvPosition(current);
				setMusicPos(pos);
				const next = current.queue[current.index + 1];
				engine.setScreenMusic({
					title: playing.title, author: playing.author, thumbnail: playing.thumbnail, positionMs: pos, duration: playing.duration,
					paused: current.paused, next: next?.title ?? null, loading: !tvSpeaker.ready && !current.paused && Boolean(window.pelacordTransport),
				});
			}
			tvSpeaker.sync(hiddenRef.current ? null : current ?? null);
		}, 400);
		return () => clearInterval(timer);
	}, [tvs]);

	// Pelaflix en la tele: los que están en la sala entran a la película y la ven ENCIMA de la pantalla.
	const joinedMovieId = myJoinedMovieRoom?.id ?? null;
	useEffect(() => {
		if (hidden) return;
		const wanted = movieRoom?.id ?? null;
		if (wanted && joinedMovieId !== wanted) movieJoin(wanted);
		// Si salgo de la sala (o se apaga la peli), dejo de mirarla; si soy el host, la sala sigue
		// (la cierra "Apagar").
		if (!wanted && joinedMovieId && joinedMovieId !== state.me.id) movieLeave();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [movieRoom?.id, joinedMovieId, hidden]);
	const tvVolume = useRef(1);
	useEffect(() => {
		let frame = 0;
		const place = () => {
			frame = requestAnimationFrame(place);
			const el = tvHostRef.current;
			const engine = engineRef.current;
			if (!el || !engine) return;
			const rect = movieRoom && !hiddenRef.current ? engine.screenRect() : null;
			if (!rect) {
				el.style.display = 'none';
				return;
			}
			el.style.display = 'block';
			el.style.left = `${rect.left}px`;
			el.style.top = `${rect.top}px`;
			el.style.width = `${rect.width}px`;
			el.style.height = `${rect.height}px`;
			tvVolume.current = volumeForDistance(engine.distanceToScreen());
		};
		place();
		return () => cancelAnimationFrame(frame);
	}, [movieRoom]);
	const [movieVolume, setMovieVolume] = useState(1);
	useEffect(() => {
		const timer = setInterval(() => setMovieVolume(Math.round(tvVolume.current * 20) / 20), 300);
		return () => clearInterval(timer);
	}, []);

	// Compartir pantalla en ESTA tele: cuando arranca mi pantalla, la tele pasa a mostrarla.
	useEffect(() => {
		if (localScreen && pendingShare.current) {
			pendingShare.current = false;
			tv.screen(roomRef.current, state.me.id);
		}
		if (!localScreen) {
			for (const t of Object.values(tvs)) if (t.sharerId === state.me.id) tv.stopSharing(t.room);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [localScreen]);

	// ------------------------------------------------------------- pesca ----

	function cancelFishing(caught: FishKind | null = null): void {
		if (fishTimer.current) window.clearTimeout(fishTimer.current);
		fishTimer.current = null;
		setFishPhase(null);
		setHooked(null);
		engineRef.current?.stopFishing(caught ? {color: caught.color} : null);
	}

	function waitForBite(): void {
		setFishPhase('wait');
		if (fishTimer.current) window.clearTimeout(fishTimer.current);
		fishTimer.current = window.setTimeout(() => {
			if (!engineRef.current?.isFishing()) return;
			engineRef.current.setBite(true);
			setFishPhase('bite');
			// Hay un ratito para recoger; si no, se escapa y hay que esperar otro.
			fishTimer.current = window.setTimeout(() => {
				engineRef.current?.setBite(false);
				flash('Se escapó... ¡más rápido la próxima!');
				waitForBite();
			}, 1200);
		}, biteWaitMs());
	}

	const fishAction = (): void => {
		const phase = fishPhaseRef.current;
		if (phase === null) waitForBite();
		else if (phase === 'wait') {
			cancelFishing();
			flash('Guardaste la caña');
		} else if (phase === 'bite') {
			if (fishTimer.current) window.clearTimeout(fishTimer.current);
			engineRef.current?.setBite(false);
			setHooked(rollFish(Boolean(engineRef.current?.isDeepSpot())));
			useBait();
			setFishPhase('game');
		}
	};
	const fishActionRef = useRef(fishAction);
	fishActionRef.current = fishAction;

	useEffect(() => onEmote((m) => {
		if (m.room === roomRef.current) engineRef.current?.emote(m.id, m.emote, m.target);
	}), []);

	useEffect(() => onInvite((m) => setInvite({id: m.id, name: names[m.id] ?? m.name, room: m.room})), [names]);

	useEffect(() => {
		const heartbeat = setInterval(() => announceRef.current(), 2000);
		const coins = setInterval(() => {
			if (!hiddenRef.current) addCoins(10);
		}, 120000);
		return () => {
			clearInterval(heartbeat);
			clearInterval(coins);
		};
	}, []);

	// Audio espacial (apagado mientras estás en la parte 2D).
	useEffect(() => {
		// Las voces pasan por acá siempre que estés en el mundo: así cada lugar es una sala aparte
		// (si están en lugares distintos no se escuchan). El botón de auriculares sólo prende el 3D.
		// También en la parte 2D: tu personaje sigue en su lugar, así que la regla de salas sigue.
		spatialVoices.setActive(true);
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
			const positions: Record<string, VoicePlace> = {};
			for (const [id, p] of Object.entries(peers)) {
				// Cada lugar es una sala aparte (también para los que están en la parte 2D: su personaje
				// sigue ahí). Los que nunca entraron al mundo no figuran acá y se escuchan normal.
				if (p.room !== roomRef.current) positions[id] = 'muted';
				else if (p.away || hiddenRef.current) positions[id] = 'flat';
				else positions[id] = spatialRef.current ? (here[id] ?? 'flat') : 'flat';
			}
			spatialVoices.update(me, positions);
		}, 80);
		return () => clearInterval(timer);
	}, [peers]);
	const spatialRef = useRef(spatial);
	spatialRef.current = spatial;

	// Decorar.
	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		engine.setDecorating(placing ? {id: placing.id, color: placing.color, rot: placing.rot} : null);
		engine.editMode = panel === 'decorate';
	}, [placing, panel]);

	// Mesa de juegos: quién está sentado, el dibujo 3D y los clics en cartas/casilleros.
	const seatedAtTable = useMemo(() => {
		const list: Array<{id: string; seat: number}> = [];
		const parse = (seat: string | null) => (seat ? /^Seat_Table_(\d+)/.exec(seat)?.[1] : undefined);
		if (room === 'games' && tableSeat !== null) list.push({id: state.me.id, seat: tableSeat});
		for (const p of Object.values(peers)) {
			const n = p.room === 'games' && !p.away ? parse(p.seat) : undefined;
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
		for (const s of seatedAtTable) seatOf[s.id] = s.seat;
		const free = [1, 2, 3, 4, 5, 6].filter((n) => !Object.values(seatOf).includes(n));
		for (const p of session.players) if (seatOf[p] === undefined) seatOf[p] = free.shift() ?? 1;
		view.render(session, state.me.id, (p) => engine.tableAngle(seatOf[p] ?? 1), nameOf);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [session, seatedAtTable, room]);
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

	// Escape cierra paneles (o sale de "ver la tele").
	useEffect(() => {
		if (hidden) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			if (placing) setPlacing(null);
			else if (emoteOpen) setEmoteOpen(false);
			else if (panel && !firstTime) setPanel(null);
			else if (tvView) engineRef.current?.setTvView(false);
			else setSelected(null);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [placing, panel, firstTime, tvView, hidden, emoteOpen]);

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

	function pickEmote(def: EmoteDef): void {
		if (def.loop) engineRef.current?.setLoopEmote(def.id as 'dance' | 'robot' | 'clap');
		else emote(def.id as Emote);
	}
	const pickEmoteRef = useRef(pickEmote);
	pickEmoteRef.current = pickEmote;

	// Atajos: 1…0 para cada gesto, Q abre el menú.
	useEffect(() => {
		if (hidden) return;
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
			if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
			if (event.key.toLowerCase() === 'q') {
				setEmoteOpen((open) => !open);
				return;
			}
			const def = EMOTES.find((e) => e.key === event.key);
			if (def && !fishPhaseRef.current) pickEmoteRef.current(def);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [hidden]);

	function joinVoice(): void {
		const channel = state.channels.find((c) => c.type === 'voice');
		if (channel) dispatch({type: 'joinVoice', channelId: channel.id});
	}

	const here = Object.values(peers).filter((p) => p.room === room);
	const selectedPeer = selected ? peers[selected] : null;
	const onlineFriends = state.members.filter((m) => m.id !== state.me.id && m.presence !== 'offline').map((m) => ({id: m.id, name: m.name, online: true}));
	const title = roomTitle(room, houseOwner, names, state.me.id);
	const hasScreen = Boolean(engineRef.current?.hasScreen());
	const tvOn = myTv && myTv.mode !== 'off';

	return (
		<div className={`world${hidden ? ' is-hidden' : ''}`} aria-hidden={hidden}>
			<div className="world-stage" ref={hostRef} />
			<div className="w-tv-host" ref={tvHostCallback} />
			{tvHost && movieRoom && !hidden && joinedMovieId === movieRoom.id ? <MoviePlayer tv={{host: tvHost, volume: movieVolume}} /> : null}
			{!catalog ? <div className="world-loading"><span className="t-spinner" /> Armando el mundo…</div> : null}

			<header className="t-hud-top">
				<div className="t-chip t-place">
					<MapPin size={16} strokeWidth={2.8} />
					<strong>{title}</strong>
					<span className="t-people">{here.length + 1}</span>
				</div>
				<div className="t-hud-right">
					<span className="t-chip t-coins-chip" title="Pelamonedas: se ganan jugando, pescando y paseando"><Coins size={16} strokeWidth={2.8} /> {profile.coins}</span>
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
					<button type="button" className="t-round is-exit" title="Volver a PelaCord (tu personaje se queda acá)" onClick={onClose}><LogOut size={18} strokeWidth={2.6} /></button>
					{onQuit ? (
						<button type="button" className="t-round is-exit" title="Salir del mundo del todo (se cierra y la próxima vez arranca de cero)" onClick={onQuit}><Power size={18} strokeWidth={2.6} /></button>
					) : null}
				</div>
			</header>

			{houseOwner === state.me.id ? (
				<div className="t-house-bar">
					<button type="button" className={`t-pill${panel === 'decorate' ? ' is-active' : ''}`} onClick={() => setPanel(panel === 'decorate' ? null : 'decorate')}><Brush size={16} strokeWidth={2.8} /> Decorar</button>
					<button type="button" className="t-pill" onClick={() => setPanel('invite')}><UserPlus size={16} strokeWidth={2.8} /> Invitar</button>
					<button type="button" className="t-pill" onClick={() => setPanel('shop-furniture')}><Armchair size={16} strokeWidth={2.8} /> Catálogo</button>
				</div>
			) : null}

			{/* Sentado frente a una tele: verla de cerca. */}
			{hasScreen && (seated || tvView) && tableSeat === null ? (
				<div className="t-tv-bar">
					<button type="button" className={`t-pill${tvView ? ' is-active' : ''}`} onClick={() => engineRef.current?.setTvView(!tvView)}>
						<Tv size={16} strokeWidth={2.8} /> {tvView ? 'Dejar de mirar' : 'Ver la tele'}
					</button>
					{tvOn || tvView ? <button type="button" className="t-pill" onClick={() => setPanel('tv')}><Monitor size={16} strokeWidth={2.8} /> Controles</button> : null}
				</div>
			) : null}

			{emoteOpen && tableSeat === null && !tvView && !hidden ? (
				<EmoteMenu
					active={myAnim}
					onPick={(def) => {
						pickEmote(def);
						if (!def.loop) setEmoteOpen(false);
						engineRef.current?.focus();
					}}
					onClose={() => setEmoteOpen(false)}
				/>
			) : null}
			{(myAnim === 'dance' || myAnim === 'robot' || myAnim === 'clap') && tableSeat === null ? (
				<div className="t-loop-chip">
					{EMOTES.find((e) => e.id === myAnim)?.label}… <small>movete para parar</small>
				</div>
			) : null}
			{tableSeat === null && !tvView ? (
				<footer className="t-emotes">
					<button type="button" className={`is-main${emoteOpen ? ' is-active' : ''}`} onClick={() => setEmoteOpen((o) => !o)} title="Emotes (Q)"><Smile size={20} strokeWidth={2.6} /><span>Emotes</span><kbd>Q</kbd></button>
					<button type="button" onClick={() => { setTryOn(null); setPanel('shop-clothes'); }} title="Ropa"><Shirt size={20} strokeWidth={2.6} /><span>Ropa</span></button>
					<button type="button" onClick={() => setPanel('pets')} title="Mis mascotas"><PawPrint size={20} strokeWidth={2.6} /><span>Mascotas</span></button>
					{Object.values(profile.fish).some((n) => n > 0) ? (
						<button type="button" onClick={() => setPanel('fishmarket')} title="Mis peces"><Fish size={20} strokeWidth={2.6} /><span>Peces</span></button>
					) : null}
					{houseOwner !== state.me.id ? (
						<button type="button" onClick={() => setRoom(`house:${state.me.id}`)} title="Ir a mi casa"><Home size={20} strokeWidth={2.6} /><span>Mi casa</span></button>
					) : null}
				</footer>
			) : null}

			{showHint && !firstTime && !hidden ? (
				<div className="t-hint-card">
					<Keyboard size={18} strokeWidth={2.6} />
					<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> caminar · <kbd>Shift</kbd> correr · <kbd>E</kbd> usar · <kbd>Q</kbd> emotes · <kbd>1</kbd>…<kbd>0</kbd> gestos</span>
					<button type="button" className="t-close is-small" aria-label="Ocultar" onClick={() => { setShowHint(false); try { localStorage.setItem(HINT_KEY, '0'); } catch { /* */ } }}><X size={14} strokeWidth={3} /></button>
				</div>
			) : null}

			{selectedPeer ? (
				<div className="t-popover">
					<strong>{names[selectedPeer.id] ?? selectedPeer.name}</strong>
					{selectedPeer.away ? <small className="t-away-tag">ausente</small> : null}
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
			{fishPhase === 'bite' ? <div className="t-bite">¡Pica! <kbd>E</kbd></div> : null}
			{fishPhase === 'wait' || fishPhase === 'bite' ? (
				<div className="t-gear-chip">
					<span className="t-gear-rod is-mini" style={{'--rod': rodById(profile.rod).color} as React.CSSProperties}><i /></span>
					{rodById(profile.rod).name}
					<span className="t-gear-sep" />
					{currentBait() ? <>{currentBait()!.name} <em>x{profile.bait[currentBait()!.id] ?? 0}</em></> : <small>sin carnada</small>}
					{engineRef.current?.isDeepSpot() ? <><span className="t-gear-sep" /><small>zona honda</small></> : null}
				</div>
			) : null}

			{fishPhase === 'game' && hooked ? (
				<FishingGame
					fish={hooked}
					rod={rodById(profile.rod)}
					onDone={({caught, perfect, treasure}) => {
						if (treasure) {
							// Cofre: monedas o un paquete de carnada.
							if (Math.random() < 0.6) {
								const coins = 40 + Math.floor(Math.random() * 120);
								addCoins(coins);
								setTimeout(() => flash(`¡Cofre! ${coins} pelamonedas`), 1800);
							} else {
								const bait = BAITS[Math.floor(Math.random() * BAITS.length)];
								updateProfile((p) => ({bait: {...p.bait, [bait.id]: (p.bait[bait.id] ?? 0) + bait.pack}}));
								setTimeout(() => flash(`¡Cofre! Un paquete de ${bait.name.toLowerCase()}`), 1800);
							}
						}
						if (caught) {
							const {size, record, first} = keepFish(hooked, perfect);
							const extra = first ? ' ¡Nuevo en el álbum!' : record ? ' ¡Récord!' : '';
							flash(hooked.junk ? `Sacaste: ${hooked.name}. Algo es algo...` : `${perfect ? '¡PERFECTO! ' : ''}Pescaste: ${hooked.name}, ${size} cm.${extra}`);
							cancelFishing(hooked);
						} else {
							flash(hooked.junk ? `Se soltó: ${hooked.name}. ¡Mejor!` : `Se escapó: ${hooked.name}. ¡Otra vez!`);
							engineRef.current?.setBite(false);
							setHooked(null);
							waitForBite();
						}
					}}
				/>
			) : null}

			{room === 'games' && tableSeat !== null ? (
				<TablePanel
					session={session}
					me={state.me.id}
					seated={seatedAtTable.map((s) => s.id)}
					names={nameOf}
					onStart={(game, bots) => table.start(game, seatedAtTable.map((s) => s.id), bots)}
					onLeave={() => engineRef.current?.standUp()}
					colorPick={wildCard !== null}
					onColor={(color: CardColor) => {
						if (wildCard) table.move({kind: 'play', card: wildCard, color});
						setWildCard(null);
					}}
					onEnd={() => table.end()}
				/>
			) : null}

			{catalog && (panel === 'editor' || firstTime) && !hidden ? <EditorPanel key={tryOn?.id ?? 'editor'} catalog={catalog} firstTime={firstTime} tryOn={tryOn} onClose={() => { setTryOn(null); setPanel(null); }} /> : null}
			{catalog && panel === 'shop-clothes' ? <ShopPanel catalog={catalog} kind="clothes" onClose={() => setPanel(null)} onTry={(item) => { setTryOn(item); setPanel('editor'); }} onSupplies={room === 'shop' ? () => setPanel('pet-shop') : undefined} /> : null}
			{panel === 'pet-shop' ? <PetPanel shop onClose={() => setPanel(null)} onBack={() => setPanel('shop-clothes')} /> : null}
			{panel === 'pets' ? <PetPanel shop={false} onClose={() => setPanel(null)} /> : null}
			{catalog && panel === 'shop-furniture' ? <ShopPanel catalog={catalog} kind="furniture" onClose={() => setPanel(null)} onTry={() => {}} /> : null}
			{catalog && panel === 'decorate' ? (
				<DecoratePanel catalog={catalog} placing={placing} onPlace={(item) => setPlacing(item)} onRotate={() => engineRef.current?.rotateGhost()} onClose={() => { setPlacing(null); setPanel(null); }} />
			) : null}
			{panel === 'fishmarket' ? <FishMarketPanel onClose={() => setPanel(null)} onSold={(c) => flash(`Tano te pagó ${c} pelamonedas`)} /> : null}
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
					tv={myTv}
					positionMs={musicPos}
					onPlayNow={(t) => { tv.playNow(room, t); flash(`Pusiste "${t.title}" en la tele`); }}
					onEnqueue={(t) => { tv.enqueue(room, t); flash(`"${t.title}" quedó en la cola`); }}
					onToggle={() => tv.toggle(room)}
					onNext={() => tv.next(room)}
					onPrevious={() => tv.previous(room)}
					onJump={(i) => tv.jump(room, i)}
					onRemove={(i) => tv.remove(room, i)}
					onSeek={(ms) => tv.seek(room, ms)}
					movie={movieRoom ? {title: movieRoom.media.title, poster: movieRoom.media.poster, paused: movieRoom.paused, positionMs: positionOf(movieRoom), host: nameOf(movieRoom.hostId)} : null}
					onPickMovie={(media) => {
						movieOpen(media);
						tv.movie(room, state.me.id);
						flash(`Pusiste "${media.title}" en la tele`);
					}}
					onMovieToggle={() => movieCommand(movieRoom?.paused ? {kind: 'play'} : {kind: 'pause'})}
					onMovieSeek={(delta) => movieRoom && movieCommand({kind: 'seek', positionMs: Math.max(0, positionOf(movieRoom) + delta)})}
					inVoice={inVoice}
					sharerName={sharerId ? nameOf(sharerId) : null}
					sharingHere={sharerId === state.me.id && Boolean(localScreen)}
					onJoinVoice={joinVoice}
					onShare={() => {
						if (localScreen) tv.screen(room, state.me.id);
						else {
							pendingShare.current = true;
							openSharePicker();
						}
					}}
					onStopShare={() => {
						dispatch({type: 'setSharing', sharing: false});
						tv.stopSharing(room);
					}}
					onOff={() => {
						if (myTv?.mode === 'movie' && movieRoom?.hostId === state.me.id) movieLeave();
						tv.off(room);
					}}
					onClose={() => setPanel(null)}
				/>
			) : null}
		</div>
	);
}
