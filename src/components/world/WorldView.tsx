import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	Armchair, Brush, Coins, Paintbrush, Zap, Power, Fish, Headphones, Home, LogOut, MapPin, Music, Mic, MicOff, Monitor, PawPrint, Phone, Shirt, Smile, Sprout, Tv, User, UserPlus, Users, BellRing, Volume2, VolumeX, Keyboard, X,
} from 'lucide-react';
import {EMOTES, type EmoteDef, EmoteMenu} from '@/components/world/EmoteMenu';
import {MoviePlayer} from '@/components/MoviePlayer';
import {useLocalScreen, useMeshRemotes, useSpeakingIds} from '@/components/RemoteMedia';
import {openSharePicker} from '@/lib/sharePicker';
import {positionOf} from '@/lib/movieRooms';
import {
	addCoins, type Anim, type CatalogItem, type Emote, getProfile, LOOP_ANIMS, type LoopAnim, onBell, onCasinoBet, onCasinoChips, onEmote, onInvite, type PlacedFurniture, type PlayerState, ROOMS, type RoomId,
	sendWorld, updateProfile, useCatalog, useProfile, useWorldPeers,
} from '@/world/core';
import {type Interaction, WorldEngine} from '@/world/engine';
import {editFurniture, tabletopRadius} from '@/world/furniturePlacement';
import {BAITS, biteWaitMs, currentBait, type FishKind, keepFish, rodById, rollFish, useBait} from '@/world/fish';
import {PETS} from '@/world/petCatalog';
import {selectedMount} from '@/world/mountCatalog';
import {recordPetCapture} from '@/world/pets';
import {spatialVoices, type VoicePlace} from '@/world/spatialAudio';
import {claimPayout, hostSkip, hostStart, hostStop, PartyRuntime, sendPush, startParty, useParty} from '@/world/party';
import {ArenaAdminPanel, PartyHud} from '@/components/world/ArenaPanels';
import {type CardColor, table, useTableSession} from '@/world/tableGames';
import {TableView} from '@/world/tableView';
import {currentTrack, startTv, tv, tvPosition, useTvs, volumeForDistance} from '@/world/tv';
import {tvSpeaker} from '@/world/tvAudio';
import {playDoorbell} from '@/world/doorbell';
import {worldSounds} from '@/world/worldSounds';
import {arenaMusic} from '@/world/arenaMusic';
import {DecoratePanel, EditorPanel, FriendsPanel, InvitePanel, ShopPanel, TablePanel} from '@/components/world/WorldPanels';
import {TvPanel} from '@/components/world/TvPanel';
import {NeonPanel, WallsPanel} from '@/components/world/HouseDecorPanels';
import {FishingGame, FishMarketPanel} from '@/components/world/FishingPanels';
import {PetPanel} from '@/components/world/PetPanel';
import {CasinoPanel} from '@/components/world/CasinoPanel';
import {FarmLandPanel, FarmShop, FarmToolbar, SmithPanel} from '@/components/world/FarmPanels';
import {RestaurantPanel} from '@/components/world/RestaurantPanel';
import {type CasinoGame, type RouletteChip, type Spin} from '@/world/casino';
import {type Crop, type FarmAction, makeFarm, readLand, tend} from '@/world/farmData';
import {useStore} from '@/state/store';

type Panel = null | 'walls' | 'neon' | 'friends' | 'editor' | 'shop-clothes' | 'shop-mounts' | 'shop-furniture' | 'decorate' | 'invite' | 'tv' | 'fishmarket' | 'pet-shop' | 'pets' | 'arena' | 'restaurant-menu' | 'smith-upgrades' | 'garden-land' | 'farm-shop' | `casino-${CasinoGame}`;
const SPATIAL_KEY = 'pelacord.world.spatial';
const HINT_KEY = 'pelacord.world.hint';

function roomTitle(room: RoomId, owner: string | null, names: Record<string, string>, meId: string): string {
	if (owner) return owner === meId ? 'Mi casa' : `Casa de ${names[owner] ?? 'un amigo'}`;
	if (room.startsWith('yard:')) return room.slice(5) === meId ? 'Mi huerta' : `Patio de ${names[room.slice(5)] ?? 'un amigo'}`;
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
	const party = useParty();
	const partyRef = useRef<PartyRuntime | null>(null);
	const [partyOverlay, setPartyOverlay] = useState<string | null>(null);
	const [dismissedParty, setDismissedParty] = useState('');
	const hostRef = useRef<HTMLDivElement>(null);
	const tvHostRef = useRef<HTMLDivElement | null>(null);
	const engineRef = useRef<WorldEngine | null>(null);
	const tableViewRef = useRef<TableView | null>(null);
	const [room, setRoom] = useState<RoomId>('city');
	const previousRoom = useRef<RoomId | null>(null);
	const [panel, setPanel] = useState<Panel>(null);
	const casinoOpen = !hidden && Boolean(panel?.startsWith('casino-'));
	const [farmAction, setFarmAction] = useState<FarmAction>('walk');
	const [farmSeed, setFarmSeed] = useState<Crop>('potato');
	const groundAction = useRef<(x: number, z: number) => boolean>(() => false);
	const [tryOn, setTryOn] = useState<CatalogItem | null>(null);
	const [placing, setPlacing] = useState<PlacedFurniture | null>(null);
	const placingRef = useRef(placing);
	placingRef.current = placing;
	const [selected, setSelected] = useState<string | null>(null);
	const [tableSeat, setTableSeat] = useState<number | null>(null);
	const [wildCard, setWildCard] = useState<string | null>(null);
	const [invite, setInvite] = useState<{id: string; name: string; room: RoomId} | null>(null);
	const [bell, setBell] = useState<{id: string; name: string} | null>(null);
	const [toast, setToast] = useState('');
	const [seated, setSeated] = useState(false);
	const [myAnim, setMyAnim] = useState<Anim>('idle');
	const [emoteOpen, setEmoteOpen] = useState(false);
	const [worldAudio, setWorldAudio] = useState(() => worldSounds.enabled);
	useEffect(() => arenaMusic.setEnabled(worldAudio), [worldAudio]);
	const [arenaVolume, setArenaVolume] = useState(() => arenaMusic.getVolume());
	const soundedOverlay = useRef<string | null>(null);
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
	groundAction.current = (px, pz) => {
		if (room !== `yard:${state.me.id}` || farmAction === 'walk' || panel) return false;
		const engine = engineRef.current;
		if (!engine) return false;
		const me = engine.myState();
		const x = Math.round(px);
		const z = Math.round(pz);
		if (Math.hypot(x - me.x, z - me.z) > 2.8) {
			flash('Acercate un poco más a esa parcela.');
			return true;
		}
		const result = tend(getProfile().farm, farmAction, x, z, farmSeed);
		if (result.farm) {
			updateProfile({farm: result.farm});
			engine.garden.animate(farmAction, x, z);
			announceRef.current();
		}
		if (result.sound) worldSounds.play(result.sound);
		if (result.notice) flash(result.notice);
		return true;
	};

	// ------------------------------------------------------------- anuncio --

	const announce = (): void => {
		const p = getProfile();
		const s: PlayerState = {
			id: state.me.id, name: state.me.name, color: state.me.avatarColor, room: roomRef.current, ...local.current,
			look: p.look, house: p.furniture.filter((f) => f.x !== null), equippedPet: p.equippedPet,
			mount: selectedMount(p.equippedMount, p.mountColors),
			garden: p.farm.land,
			t: Date.now(), away: hiddenRef.current,
		};
		sendWorld({kind: 'state', s});
	};
	const announceRef = useRef(announce);
	announceRef.current = announce;

	// ------------------------------------------------------------- motor ----

	useEffect(() => {
		startTv(state.me.id);
		startParty(state.me.id);
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
			onGroundAction: (x, z) => groundAction.current(x, z),
			onInteract: (action: Interaction) => {
				if (action.kind === 'tv') setPanel('tv');
				else if (action.kind === 'pet') {
					if (!getProfile().captureSpheres) {
						worldSounds.play('locked');
						flash('Comprá esferas de captura en la tienda.');
					}
					else {
						const caught = engineRef.current?.capturePet(action.id, recordPetCapture);
						if (caught) flash(`¡Atrapaste a ${PETS[caught].name}!`);
					}
				}
				else if (action.kind === 'npc') {
					worldSounds.play('dialogue');
					setPanel(action.npc === 'fish' ? 'fishmarket' : 'shop-clothes');
				}
				else if (action.kind === 'hotspot') {
					if (action.hotspot === 'fishmarket') setPanel('fishmarket');
					else if (action.hotspot === 'arena-admin') setPanel('arena');
					else if (action.hotspot === 'casino-blackjack' || action.hotspot === 'casino-roulette' || action.hotspot === 'casino-slots' || action.hotspot === 'restaurant-menu' || action.hotspot === 'smith-upgrades') setPanel(action.hotspot);
					else if (action.hotspot === 'garden-land') {
						if (roomRef.current === `yard:${state.me.id}`) setPanel('garden-land');
						else flash('El terreno lo puede ampliar su dueño.');
					}
					else setPanel(action.hotspot === 'furniture' ? 'shop-furniture' : action.hotspot === 'fitting' ? 'editor' : 'shop-clothes');
				}
			},
			onTable: (seat) => setTableSeat(seat),
			onPlayerClick: (id) => setSelected(id),
			onPlace: (x, z, rot, support) => {
				const current = placingRef.current;
				if (!current) return;
				placingRef.current = null;
				// En el patio queda afuera; en la casa, adentro.
				const yard = roomRef.current.startsWith('yard:');
				updateProfile((p) => ({furniture: editFurniture(p.furniture, current, {x, z, rot, support, yard})}));
				setPlacing(null);
			},
			onFurniturePick: (uid) => {
				const item = getProfile().furniture.find((f) => f.uid === uid) ?? (uid.startsWith('fixture:') ? {uid, id: uid, x: null, z: null, rot: 0} : undefined);
				if (item) setPlacing(item);
			},
			onFishAction: () => fishActionRef.current(),
			// Clic: cachetada/empujón al que esté cerca (jugador o bot).
			onShove: () => shoveRef.current(),
			onTvView: (on) => setTvView(on),
		});
		engineRef.current = engine;
		const tableView = new TableView(engine.tableRoot);
		tableViewRef.current = tableView;
		engine.tickers.add((dt) => tableView.tick(dt));
		engine.onPetAppear = (name) => {
			worldSounds.play('notice', .82);
			flashRef.current(`¡Apareció ${name}! Atrapalo antes de que se vaya`);
		};
		partyRef.current = new PartyRuntime(engine, engine.partyRoot);
		const p = getProfile();
		void engine.setMe(state.me.id, state.me.name, state.me.avatarColor, p.look, state.me.avatarUrl);
		engine.setEquippedPet(p.equippedPet);
		engine.setEquippedMount(selectedMount(p.equippedMount, p.mountColors));
		void engine.loadRoom(roomRef.current, null);
		engine.focus();
		return () => {
			sendWorld({kind: 'leave', id: state.me.id});
			tvSpeaker.stop();
			tableViewRef.current?.dispose();
			partyRef.current?.dispose();
			partyRef.current = null;
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
		worldSounds.setActive(!hidden);
		if (!hidden) engineRef.current?.focus();
		announceRef.current();
		return () => worldSounds.setActive(false);
	}, [hidden]);

	useEffect(() => {
		worldSounds.setOutputDevice(state.settings.outputDeviceId);
		arenaMusic.setOutputDevice(state.settings.outputDeviceId);
	}, [state.settings.outputDeviceId]);

	useEffect(() => {
		const overlay = hidden ? null : panel ?? (firstTime ? 'editor' : emoteOpen ? 'emotes' : null);
		const previous = soundedOverlay.current;
		soundedOverlay.current = overlay;
		if (hidden || previous === overlay) return;
		worldSounds.play(overlay ? 'menuOpen' : 'menuClose');
	}, [panel, firstTime, emoteOpen, hidden]);

	// Cambiar de lugar (puertas de la ciudad, salir, casas).
	const houseOwner = room.startsWith('house:') ? room.slice(6) : null;
	const yardOwner = room.startsWith('yard:') ? room.slice(5) : null;
	const ownsYard = yardOwner === state.me.id;
	const peerLand = yardOwner ? peers[yardOwner]?.garden : undefined;
	const yardLand = useMemo(() => ownsYard ? profile.farm.land : yardOwner ? peerLand ? readLand(peerLand) : makeFarm().land : null, [ownsYard, yardOwner, peerLand, profile.farm.land]);
	useEffect(() => {
		engineRef.current?.setGarden(yardLand, ownsYard && !panel ? farmAction : 'walk');
	}, [yardLand, farmAction, ownsYard, panel, catalog]);
	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		setPlacing(null);
		setPanel((p) => p === 'editor' || p === 'pets' ? p : null);
		setFarmAction('walk');
		cancelFishing();
		const owner = houseOwner ?? yardOwner;
		const furniture = owner === state.me.id ? getProfile().furniture : owner ? (peers[owner]?.house ?? []) : null;
		void engine.loadRoom(room, furniture, previousRoom.current);
		previousRoom.current = room;
		engine.focus();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [room]);

	const placeOwner = houseOwner ?? yardOwner;
	const houseKey = placeOwner === state.me.id ? JSON.stringify(profile.furniture) : placeOwner ? JSON.stringify(peers[placeOwner]?.house ?? []) : '';
	useEffect(() => {
		if (!placeOwner || !engineRef.current) return;
		void engineRef.current.setHouse(placeOwner === state.me.id ? profile.furniture : (peers[placeOwner]?.house ?? []));
		if (placeOwner === state.me.id) announceRef.current();
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
		engineRef.current?.setEquippedMount(selectedMount(profile.equippedMount, profile.mountColors));
		announceRef.current();
	}, [profile.equippedMount, profile.mountColors]);

	useEffect(() => {
		engineRef.current?.syncPeers(Object.values(peers), info);
	}, [peers, info, room]);

	useEffect(() => {
		engineRef.current?.setSpeaking(new Set(speakingIds));
	}, [speakingIds]);

	// ------------------------------------------------------------- arena ----

	// Los que están en la Arena (y no en la parte 2D) juegan la próxima partida.
	const arenaPeople = useMemo(() => {
		const list = [{id: state.me.id, name: state.me.name}];
		for (const p of Object.values(peers)) if (p.room === 'arena' && !p.away) list.push({id: p.id, name: names[p.id] ?? p.name});
		return list;
	}, [peers, names, state.me.id, state.me.name]);
	useEffect(() => {
		partyRef.current?.sync(party, room === 'arena' && !hidden);
	}, [party, room, hidden, catalog]);
	// Música de la Arena (según la fase: lobby, presentación, juego, jingle de victoria, podio).
	useEffect(() => {
		arenaMusic.update(party, room === 'arena' && !hidden);
	}, [party, room, hidden]);
	useEffect(() => () => arenaMusic.update(null, false), []);
	const soundedParty = useRef<typeof party>(null);
	useEffect(() => {
		const previous = soundedParty.current;
		soundedParty.current = party;
		if (!party || room !== 'arena' || hidden) return;
		if (party.id !== previous?.id || party.round !== previous.round || party.phase !== previous.phase) {
			if (party.phase === 'intro') worldSounds.play('notice');
			else if (party.phase === 'play') worldSounds.play('confirm');
			// En resultados suena el jingle de victoria de la música: nada encima.
		} else if (party.phase === 'play') {
			const id = state.me.id;
			if (previous.alive.includes(id) && !party.alive.includes(id)) worldSounds.play('cancel');
			else if ((party.roundPts[id] ?? 0) > (previous.roundPts[id] ?? 0)) worldSounds.play('coins', .72);
			else if (!previous.order.includes(id) && party.order.includes(id)) worldSounds.play('confirm');
		}
	}, [party, room, hidden, state.me.id]);
	useEffect(() => {
		if (!party) return;
		const timer = window.setInterval(() => setPartyOverlay(partyRef.current?.overlay() ?? null), 250);
		return () => window.clearInterval(timer);
	}, [party]);
	// Premio al terminar (una sola vez por partida).
	useEffect(() => {
		if (party?.phase !== 'final') return;
		const coins = claimPayout(party);
		if (coins) {
			// Las monedas suenan después del jingle del podio (no encima).
			window.setTimeout(() => worldSounds.play('reward'), 4600);
			flashRef.current(`¡Ganaste ${coins} pelamonedas en la Arena!`);
		}
	}, [party?.phase, party]);

	// ------------------------------------------------------------- la tele --

	// La pantalla compartida de ESTA tele: la de quien la puso (si sigue compartiendo).
	const sharerId = myTv?.mode === 'screen' ? myTv.sharerId ?? null : null;
	const screenStream = sharerId === state.me.id ? localScreen : sharerId ? (remotes.find((r) => r.peerId === sharerId)?.video ?? null) : null;
	const movieRoom = myTv?.mode === 'movie' && myTv.movieRoomId ? movieRoomsList.find((m) => m.id === myTv.movieRoomId) ?? null : null;
	// La peli capturada del reproductor: se dibuja EN la pantalla de la tele.
	const [movieStream, setMovieStream] = useState<MediaStream | null>(null);
	const movieStreamRef = useRef<MediaStream | null>(null);
	movieStreamRef.current = movieStream;

	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		engine.setMusicOn(Boolean(track && !myTv?.paused));
		engine.setPartyMode(Boolean(myTv?.party));
		engine.setScreening(Boolean(screenStream || movieRoom));
		if (myTv?.mode === 'screen' && screenStream) engine.setScreen({stream: screenStream});
		else if (myTv?.mode === 'screen') engine.setScreen({title: `Esperando la pantalla de ${nameOf(sharerId ?? '')}…`});
		else if (movieRoom && movieStream) engine.setScreen({stream: movieStream});
		else if (movieRoom) engine.setScreen({image: movieRoom.media.poster || null, title: movieRoom.media.title});
		else if (myTv?.mode === 'movie') engine.setScreen({title: 'La película terminó'});
		else if (!track) engine.setScreen({});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [myTv?.mode, myTv?.paused, myTv?.party, track, screenStream, movieRoom?.id, movieRoom?.media.poster, movieStream, room, catalog]);

	// La música de la tele: suena sólo acá, con volumen según la distancia; la pantalla muestra lo que suena.
	useEffect(() => {
		tvSpeaker.sync(hidden ? null : myTv);
	}, [myTv, hidden]);
	// Volumen propio de la música de la tele (cada uno el suyo; queda guardado).
	const [tvMusicVolume, setTvMusicVolume] = useState(() => {
		try {
			const saved = Number(localStorage.getItem('pelacord.tv.musicVolume'));
			return Number.isFinite(saved) && localStorage.getItem('pelacord.tv.musicVolume') !== null ? Math.min(1, Math.max(0, saved)) : 0.8;
		} catch {
			return 0.8;
		}
	});
	const changeTvMusicVolume = (value: number): void => {
		setTvMusicVolume(value);
		try {
			localStorage.setItem('pelacord.tv.musicVolume', String(value));
		} catch { /* sin almacenamiento */ }
	};
	useEffect(() => {
		tvSpeaker.setMaster((state.settings.musicMuted ? 0 : (state.settings.musicVolume ?? 0.8)) * tvMusicVolume);
	}, [state.settings.musicVolume, state.settings.musicMuted, tvMusicVolume]);
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
			tvVolume.current = volumeForDistance(engine.distanceToScreen());
			// Con la peli ya dibujada en la tele, el reproductor queda escondido atrás (sigue andando
			// y sonando, pero no tapa nada).
			el.classList.toggle('is-captured', Boolean(movieStreamRef.current));
			if (movieStreamRef.current) {
				el.style.left = '0px';
				el.style.top = '0px';
				el.style.width = '1280px';
				el.style.height = '720px';
				return;
			}
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
				worldSounds.play('cancel', .78);
				flash('Se escapó... ¡más rápido la próxima!');
				waitForBite();
			}, 1200);
		}, biteWaitMs());
	}

	const fishAction = (): void => {
		const phase = fishPhaseRef.current;
		if (phase === null) waitForBite();
		else if (phase === 'wait') {
			worldSounds.play('fabric');
			cancelFishing();
			flash('Guardaste la caña');
		} else if (phase === 'bite') {
			if (fishTimer.current) window.clearTimeout(fishTimer.current);
			engineRef.current?.setBite(false);
			worldSounds.play('catch', .68);
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

	useEffect(() => onInvite((m) => {
		worldSounds.play('notice');
		// Me abrieron la puerta (yo había tocado el timbre): entro directo.
		if (m.open) {
			setRoom(m.room);
			flashRef.current(`¡${names[m.id] ?? m.name} te abrió la puerta!`);
			return;
		}
		setInvite({id: m.id, name: names[m.id] ?? m.name, room: m.room});
	}), [names]);
	// La ruleta compartida: las fichas de los demás y la bola que tiran.
	const [rouletteChips, setRouletteChips] = useState<Record<string, RouletteChip[]>>({});
	const [remoteSpin, setRemoteSpin] = useState<{id: string; name: string; number: number; at: number} | null>(null);
	useEffect(() => onCasinoChips((m) => {
		if (m.room !== roomRef.current) return;
		setRouletteChips((all) => ({...all, [m.id]: m.chips.slice(0, 60) as RouletteChip[]}));
	}), []);
	useEffect(() => {
		if (room !== 'casino') setRouletteChips({});
	}, [room]);
	// Lo que apuestan los demás en el casino: globito arriba de su cabeza, y la máquina o la ruleta se mueve.
	useEffect(() => onCasinoBet((m) => {
		if (m.room !== roomRef.current || hiddenRef.current) return;
		const rs = m.spin as Spin | undefined;
		if (rs?.kind === 'roulette') setRemoteSpin({id: m.id, name: nameRef.current(m.id), number: rs.number, at: Date.now()});
		const engine = engineRef.current;
		if (!engine) return;
		const spin = m.spin as Spin | undefined;
		if (spin && (spin.kind === 'roulette' || spin.kind === 'slots')) engine.playCasino(spin, m.id);
		engine.casinoBubble(m.id, m.bets.slice(0, 8), Number(m.payout) || 0, Number(m.total) || 0, Math.min(5000, Math.max(0, Number(m.delay) || 0)));
	}), []);
	useEffect(() => onBell((m) => {
		playDoorbell();
		setBell({id: m.id, name: names[m.id] ?? m.name});
	}), [names]);

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
		engine.setDecorating(placing);
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

	useEffect(() => {
		engineRef.current?.setControlsBlocked(casinoOpen);
	}, [casinoOpen, catalog]);

	function emote(kind: Emote): void {
		const engine = engineRef.current;
		if (!engine) return;
		const target = kind === 'slap' ? engine.nearestTo() : null;
		engine.emote(state.me.id, kind, target);
		sendWorld({kind: 'emote', id: state.me.id, room, emote: kind, target});
	}

	function pickEmote(def: EmoteDef): void {
		worldSounds.play(def.id === 'slap' ? 'place' : def.id === 'heart' ? 'notice' : 'dialogue', .72);
		if (def.loop) engineRef.current?.setLoopEmote(def.id as LoopAnim);
		else emote(def.id as Emote);
	}
	const shoveRef = useRef<() => void>(() => {});
	shoveRef.current = () => {
		const engine = engineRef.current;
		if (!engine || tableSeat !== null) return;
		const target = engine.shoveTarget();
		engine.emote(state.me.id, 'slap', target?.id ?? null);
		sendWorld({kind: 'emote', id: state.me.id, room, emote: 'slap', target: target?.id ?? null});
		if (target) sendPush(target.id, target.dx, target.dz, 7);
	};
	const pickEmoteRef = useRef(pickEmote);
	pickEmoteRef.current = pickEmote;

	// Atajos: 1…0 para cada gesto, Q abre el menú.
	useEffect(() => {
		if (hidden || casinoOpen) return;
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
	}, [hidden, casinoOpen]);

	function joinVoice(): void {
		const channel = state.channels.find((c) => c.type === 'voice');
		if (channel) dispatch({type: 'joinVoice', channelId: channel.id});
	}

	const here = Object.values(peers).filter((p) => p.room === room);
	const selectedPeer = selected ? peers[selected] : null;
	const onlineFriends = state.members.filter((m) => m.id !== state.me.id && m.presence !== 'offline').map((m) => ({id: m.id, name: m.name, online: true}));
	const title = roomTitle(room, houseOwner, names, state.me.id);
	const hasScreen = Boolean(engineRef.current?.hasScreen()) && room !== 'campfire';
	const tvOn = myTv && myTv.mode !== 'off';

	return (
		<div className={`world${hidden ? ' is-hidden' : ''}${placing ? ' is-placing' : ''}${panel === 'neon' ? ' is-drawing' : ''}${ownsYard || room === 'shop' ? ' has-farm-access' : ''}`} aria-hidden={hidden} onClickCapture={(event) => {
			if (!(event.target instanceof Element)) return;
			const choice = event.target.closest<HTMLButtonElement>('.t-tabs button, .t-swatch, .t-toggle, .t-item, .tg-game, .ar-game, .ar-chip, .ar-stepper button');
			if (choice && !choice.disabled && !choice.matches('.is-active, .is-picked')) worldSounds.play('select');
		}}>
			<div className="world-stage" ref={hostRef} />
			<div className="w-tv-host" ref={tvHostCallback} />
			{tvHost && movieRoom && !hidden && joinedMovieId === movieRoom.id ? <MoviePlayer tv={{host: tvHost, volume: movieVolume, onStream: setMovieStream}} /> : null}
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
					<button type="button" className={`t-round${panel === 'friends' ? ' is-active' : ''}`} title="Amigos (tocar el timbre, invitar)" onClick={() => setPanel(panel === 'friends' ? null : 'friends')}><Users size={18} strokeWidth={2.6} /></button>
					<button type="button" className="t-round" title="Mi personaje" onClick={() => { setTryOn(null); setPanel('editor'); }}><User size={18} strokeWidth={2.6} /></button>
					{room === 'arena' ? (
						<label className="t-chip t-music-volume" title="Volumen de la música de la Arena (queda guardado)">
							<Music size={16} strokeWidth={2.8} />
							<input type="range" min={0} max={100} step={1} value={Math.round(arenaVolume * 100)} aria-label="Volumen de la música de la Arena"
								onChange={(event) => {
									const value = Number(event.target.value) / 100;
									arenaMusic.setVolume(value);
									setArenaVolume(value);
								}} />
						</label>
					) : null}
					<button type="button" className={`t-round${worldAudio ? '' : ' is-off'}`} aria-label="Sonidos del mundo" aria-pressed={worldAudio}
						title={worldAudio ? 'Silenciar sonidos del mundo' : 'Activar sonidos del mundo'} onClick={() => {
							worldSounds.setEnabled(!worldAudio);
							arenaMusic.setEnabled(!worldAudio);
							setWorldAudio(!worldAudio);
							if (!worldAudio) worldSounds.play('select');
						}}>
						{worldAudio ? <Volume2 size={18} strokeWidth={2.6} /> : <VolumeX size={18} strokeWidth={2.6} />}
					</button>
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
				</div>
			) : null}
			{room === 'casino' ? (
				<div className="t-casino-hud" title="Tu saldo en el casino">
					<span className="t-casino-hud-chip"><Coins size={18} strokeWidth={2.8} /></span>
					<span><small>Tu saldo</small><strong>{profile.coins.toLocaleString('es-AR')}</strong></span>
				</div>
			) : null}
			{room === 'shop' ? (
				<div className="t-house-bar"><button type="button" className="t-pill is-mint" onClick={() => setPanel('farm-shop')}><Sprout size={16} /> Tienda de huerta</button></div>
			) : null}
			{ownsYard ? (
				<>
					<div className="t-house-bar">
						<button type="button" className={`t-pill${panel === 'decorate' ? ' is-active' : ''}`} onClick={() => setPanel(panel === 'decorate' ? null : 'decorate')}><Brush size={16} strokeWidth={2.8} /> Decorar</button>
						<button type="button" className="t-pill is-mint" onClick={() => setPanel('garden-land')}><Sprout size={16} /> Ampliar terreno</button>
					</div>
					{!panel && !firstTime ? <FarmToolbar action={farmAction} seed={farmSeed} onAction={(action) => {
						setFarmAction(action);
						worldSounds.play('select');
						engineRef.current?.focus();
					}} onSeed={(seed) => {
						setFarmSeed(seed);
						engineRef.current?.focus();
					}} /> : null}
				</>
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
			{(LOOP_ANIMS as readonly string[]).includes(myAnim) && tableSeat === null ? (
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
					<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> caminar · <kbd>Shift</kbd> correr · <kbd>Espacio</kbd> saltar · <kbd>E</kbd> usar · <kbd>Q</kbd> emotes · <kbd>1</kbd>…<kbd>0</kbd> gestos</span>
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

			{bell ? (
				<div className="t-banner is-bell">
					<BellRing size={18} strokeWidth={2.8} />
					<span><strong>{bell.name}</strong> está tocando el timbre de tu casa</span>
					<button type="button" className="t-btn is-primary is-small" onClick={() => {
						sendWorld({kind: 'invite', id: state.me.id, name: state.me.name, room: `house:${state.me.id}`, open: true}, bell.id);
						flash(`Le abriste la puerta a ${bell.name}`);
						setBell(null);
					}}>Dejar entrar</button>
					<button type="button" className="t-btn is-soft is-small" onClick={() => setBell(null)}>Ahora no</button>
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
							worldSounds.play(hooked.junk ? 'catch' : first || record || perfect ? 'reward' : 'confirm');
							const extra = first ? ' ¡Nuevo en el álbum!' : record ? ' ¡Récord!' : '';
							flash(hooked.junk ? `Sacaste: ${hooked.name}. Algo es algo...` : `${perfect ? '¡PERFECTO! ' : ''}Pescaste: ${hooked.name}, ${size} cm.${extra}`);
							cancelFishing(hooked);
						} else {
							worldSounds.play('cancel');
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

			{catalog && (panel === 'editor' || firstTime) && !hidden ? <EditorPanel key={tryOn?.id ?? 'editor'} catalog={catalog} firstTime={firstTime} tryOn={tryOn} onClose={() => { setTryOn(null); setPanel(null); }} onMountShop={() => { setTryOn(null); setPanel('shop-mounts'); }} /> : null}
			{catalog && (panel === 'shop-clothes' || panel === 'shop-mounts') ? <ShopPanel key={panel} catalog={catalog} kind="clothes" initialSection={panel === 'shop-mounts' ? 'mount' : undefined} onClose={() => setPanel(null)} onTry={(item) => { setTryOn(item); setPanel('editor'); }} onSupplies={room === 'shop' ? () => setPanel('pet-shop') : undefined} /> : null}
			{panel === 'pet-shop' ? <PetPanel shop onClose={() => setPanel(null)} onBack={() => setPanel('shop-clothes')} /> : null}
			{panel === 'pets' ? <PetPanel shop={false} onClose={() => setPanel(null)} /> : null}
			{catalog && panel === 'shop-furniture' ? <ShopPanel catalog={catalog} kind="furniture" onClose={() => setPanel(null)} onTry={() => {}} /> : null}
			{panel === 'walls' && houseOwner === state.me.id ? <WallsPanel onClose={() => setPanel('decorate')} /> : null}
			{panel === 'neon' && houseOwner === state.me.id && engineRef.current ? <NeonPanel engine={engineRef.current} meId={state.me.id} onClose={() => setPanel('decorate')} /> : null}
			{catalog && panel === 'decorate' ? (
				placing ? (
					// Moviendo un mueble: se esconde todo, sólo queda esta barrita abajo.
					<div className="t-placing-bar">
						<span>{tabletopRadius(placing.id) ? 'Hacé clic sobre una tapa libre o en el piso' : 'Hacé clic donde lo quieras poner'}</span>
						{placing.id.startsWith('fixture:') ? null : <button type="button" className="t-btn is-soft is-small" onClick={() => engineRef.current?.rotateGhost()}>Girar (R)</button>}
						<button type="button" className="t-btn is-soft is-small" onClick={() => setPlacing(null)}>Cancelar</button>
					</div>
				) : <DecoratePanel catalog={catalog} placing={placing} onPlace={(item) => setPlacing(item)} onRotate={() => engineRef.current?.rotateGhost()} onClose={() => { setPlacing(null); setPanel(null); }}
					showFixtures={houseOwner === state.me.id}
					tools={<>
						<button type="button" className="t-pill" onClick={() => setPanel('shop-furniture')}><Armchair size={16} strokeWidth={2.8} /> Catálogo</button>
						{houseOwner === state.me.id ? <>
							<button type="button" className="t-pill" onClick={() => setPanel('walls')}><Paintbrush size={16} strokeWidth={2.8} /> Paredes y piso</button>
							<button type="button" className="t-pill" onClick={() => setPanel('neon')}><Zap size={16} strokeWidth={2.8} /> NEÓN</button>
						</> : null}
					</>} />
			) : null}
			{panel === 'arena' ? (
				<ArenaAdminPanel
					party={party}
					meId={state.me.id}
					people={arenaPeople}
					onStart={(games, bots) => {
						hostStart({games, bots}, arenaPeople);
						setPanel(null);
					}}
					onSkip={() => hostSkip()}
					onStop={() => {
						hostStop();
						setPanel(null);
					}}
					onClose={() => setPanel(null)}
				/>
			) : null}
			{party && room === 'arena' && !hidden && dismissedParty !== `${party.id}:final` ? (
				<PartyHud party={party} meId={state.me.id} overlay={partyOverlay} onClose={() => setDismissedParty(`${party.id}:final`)} />
			) : null}
			{panel === 'fishmarket' ? <FishMarketPanel onClose={() => setPanel(null)} onSold={(c) => flash(`Tano te pagó ${c} pelamonedas`)} /> : null}
			{casinoOpen && panel ? <CasinoPanel key={panel} initial={panel.slice(7) as CasinoGame} playerName={state.me.name} onClose={() => setPanel(null)} onSpin={(spin) => engineRef.current?.playCasino(spin)}
				others={Object.entries(rouletteChips).filter(([id]) => peers[id]?.room === 'casino').map(([id, chips]) => ({id, name: nameRef.current(id), color: peers[id]?.color ?? '#8a5cff', chips}))}
				remoteSpin={remoteSpin}
				onChips={(chips) => sendWorld({kind: 'casino-chips', id: state.me.id, room: roomRef.current, chips})}
				onBet={(bet) => {
					engineRef.current?.casinoBubble(state.me.id, bet.bets, bet.payout, bet.total, bet.delay);
					sendWorld({kind: 'casino', id: state.me.id, room: roomRef.current, bets: bet.bets, payout: bet.payout, total: bet.total, delay: bet.delay, spin: bet.spin});
				}} /> : null}
			{panel === 'restaurant-menu' ? <RestaurantPanel onClose={() => setPanel(null)} /> : null}
			{panel === 'farm-shop' ? <FarmShop onClose={() => setPanel(null)} onBack={() => setPanel('shop-clothes')} /> : null}
			{panel === 'smith-upgrades' ? <SmithPanel onClose={() => setPanel(null)} /> : null}
			{panel === 'garden-land' && ownsYard ? <FarmLandPanel onClose={() => setPanel(null)} /> : null}
			{panel === 'friends' ? (
				<FriendsPanel
					friends={onlineFriends.map((f) => {
						const where = peers[f.id]?.room;
						const home = where === `house:${f.id}`;
						return {id: f.id, name: f.name, home, where: !where ? null : home ? 'En su casa' : where.startsWith('house:') ? 'De visita en una casa' : where.startsWith('yard:') ? 'En un patio' : `En ${ROOMS.find((r) => r.id === where)?.name ?? 'el mundo'}`};
					})}
					onBell={(id) => {
						sendWorld({kind: 'bell', id: state.me.id, name: state.me.name}, id);
						worldSounds.play('select');
						flash(`Tocaste el timbre de ${names[id] ?? 'tu amigo'}…`);
					}}
					onInvite={(id) => {
						sendWorld({kind: 'invite', id: state.me.id, name: state.me.name, room: `house:${state.me.id}`}, id);
						flash(`Invitación enviada a ${names[id] ?? 'tu amigo'}`);
					}}
					onClose={() => setPanel(null)}
				/>
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
					volume={tvMusicVolume}
					onVolume={changeTvMusicVolume}
					partyAvailable={room.startsWith('house:')}
					onParty={(on) => {
						tv.party(room, on);
						flash(on ? '¡Modo joda prendido! Poné música' : 'Modo joda apagado');
					}}
					radio={room === 'campfire'}
				/>
			) : null}
		</div>
	);
}
