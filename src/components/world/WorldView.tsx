import {useEffect, useMemo, useRef, useState} from 'react';
import {useLocalScreen, useRemoteVideo, useSpeakingIds} from '@/components/RemoteMedia';
import {addCoins, type Anim, type Emote, getProfile, onEmote, type PlacedFurniture, type PlayerState, ROOMS, type RoomId, sendWorld, updateProfile, useCatalog, useProfile, useWorldPeers} from '@/world/core';
import {WorldEngine} from '@/world/engine';
import {useGames} from '@/world/games';
import {spatialVoices} from '@/world/spatialAudio';
import {DecoratePanel, EditorPanel, GamesPanel, ShopPanel} from '@/components/world/WorldPanels';
import {useStore} from '@/state/store';

type Panel = null | 'editor' | 'shop-clothes' | 'shop-furniture' | 'games' | 'decorate';

const SPATIAL_KEY = 'pelacord.world.spatial';

/**
 * El mundo 3D de PelaCord (estilo Club Penguin): salas, tu casa, la tienda, juegos y audio espacial.
 * Todo se sincroniza por la malla P2P en el canal `world`.
 */
export function WorldView({onClose}: {onClose: () => void}): JSX.Element {
	const {state} = useStore();
	const catalog = useCatalog();
	const profile = useProfile();
	const peers = useWorldPeers();
	const speakingIds = useSpeakingIds();
	const remoteScreen = useRemoteVideo();
	const localScreen = useLocalScreen();
	const {invites} = useGames(state.me.id);
	const hostRef = useRef<HTMLDivElement>(null);
	const engineRef = useRef<WorldEngine | null>(null);
	const [room, setRoom] = useState<RoomId>('living');
	const [panel, setPanel] = useState<Panel>(null);
	const [placing, setPlacing] = useState<PlacedFurniture | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [spatial, setSpatial] = useState(() => {
		try {
			return localStorage.getItem(SPATIAL_KEY) !== '0';
		} catch {
			return true;
		}
	});
	const [coinFlash, setCoinFlash] = useState(false);
	const local = useRef<{x: number; z: number; ry: number; anim: Anim; seat: string | null; tx: number; tz: number}>({x: 0, z: -2.5, ry: Math.PI, anim: 'idle', seat: null, tx: 0, tz: -2.5});
	const roomRef = useRef(room);
	roomRef.current = room;
	const firstTime = !profile.created;

	const names = useMemo(() => {
		const map: Record<string, string> = {};
		for (const member of state.members) map[member.id] = member.name;
		for (const p of Object.values(peers)) map[p.id] ??= p.name;
		return map;
	}, [state.members, peers]);
	const info = useMemo(() => {
		const map: Record<string, {name: string; avatarUrl?: string}> = {};
		for (const member of state.members) map[member.id] = {name: member.name, avatarUrl: member.avatarUrl};
		return map;
	}, [state.members]);

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
		const engine = new WorldEngine(hostRef.current, catalog, {
			onLocalChange: (s) => {
				local.current = s;
				announceRef.current();
			},
			onHotspot: (kind) => {
				if (kind === 'clothes') setPanel('shop-clothes');
				else if (kind === 'furniture') setPanel('shop-furniture');
				else if (kind === 'fitting') setPanel('editor');
				else setPanel('shop-clothes');
			},
			onPlayerClick: (id) => setSelected(id),
			onPlace: (x, z, rot) => {
				setPlacing((current) => {
					if (current) {
						updateProfile((p) => ({furniture: p.furniture.map((f) => (f.uid === current.uid ? {...f, x, z, rot} : f))}));
					}
					return null;
				});
			},
			onFurnitureClick: () => setPanel('decorate'),
		});
		engineRef.current = engine;
		const p = getProfile();
		void engine.setMe(state.me.id, state.me.name, state.me.avatarColor, p.look, state.me.avatarUrl);
		void engine.loadRoom(roomRef.current, roomRef.current === `house:${state.me.id}` ? p.furniture : null);
		return () => {
			sendWorld({kind: 'leave', id: state.me.id});
			engine.dispose();
			engineRef.current = null;
		};
		// El motor se arma una vez (cuando llega el catálogo).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [catalog]);

	// Cambiar de sala (o de casa).
	const houseOwner = room.startsWith('house:') ? room.slice(6) : null;
	useEffect(() => {
		const engine = engineRef.current;
		if (!engine) return;
		setPlacing(null);
		const furniture = houseOwner === state.me.id ? getProfile().furniture : houseOwner ? (peers[houseOwner]?.house ?? []) : null;
		void engine.loadRoom(room, furniture);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [room]);

	// Mi casa se actualiza cuando muevo/compro muebles; la de un amigo, cuando él la cambia.
	const houseKey = houseOwner === state.me.id ? JSON.stringify(profile.furniture) : houseOwner ? JSON.stringify(peers[houseOwner]?.house ?? []) : '';
	useEffect(() => {
		if (!houseOwner || !engineRef.current) return;
		void engineRef.current.setHouse(houseOwner === state.me.id ? profile.furniture : (peers[houseOwner]?.house ?? []));
		if (houseOwner === state.me.id) announceRef.current();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [houseKey]);

	// Mi look.
	useEffect(() => {
		void engineRef.current?.setMe(state.me.id, state.me.name, state.me.avatarColor, profile.look, state.me.avatarUrl);
		announceRef.current();
	}, [profile.look, state.me.id, state.me.name, state.me.avatarColor, state.me.avatarUrl]);

	// Los demás.
	useEffect(() => {
		engineRef.current?.syncPeers(Object.values(peers), info);
	}, [peers, info, room]);

	// Quién habla (anima la boca y las ondas de la placa).
	useEffect(() => {
		engineRef.current?.setSpeaking(new Set(speakingIds));
	}, [speakingIds]);

	// La pantalla de la sala muestra lo que alguien comparte en la llamada.
	useEffect(() => {
		engineRef.current?.setScreen(remoteScreen ?? localScreen);
	}, [remoteScreen, localScreen, room]);

	// Gestos de los demás.
	useEffect(() => onEmote((m) => {
		if (m.room === roomRef.current) engineRef.current?.emote(m.id, m.emote, m.target);
	}), []);

	// Anuncio periódico (los que entran tarde me ven) + monedas por estar en el mundo.
	useEffect(() => {
		const heartbeat = setInterval(() => announceRef.current(), 2000);
		const coins = setInterval(() => {
			addCoins(10);
			setCoinFlash(true);
			setTimeout(() => setCoinFlash(false), 1200);
		}, 120000);
		return () => {
			clearInterval(heartbeat);
			clearInterval(coins);
		};
	}, []);

	// Audio espacial: activo mientras estás en el mundo (si no lo apagaste).
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

	// Decorar: el fantasma del mueble sigue al mouse; R gira; Esc cancela.
	useEffect(() => {
		engineRef.current?.setDecorating(placing ? {id: placing.id, color: placing.color, rot: placing.rot} : null);
	}, [placing]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.target as HTMLElement)?.tagName === 'INPUT') return;
			if (event.key === 'r' || event.key === 'R') engineRef.current?.rotateGhost();
			if (event.key === 'Escape') {
				if (placing) setPlacing(null);
				else if (panel && !firstTime) setPanel(null);
				else setSelected(null);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [placing, panel, firstTime]);

	function emote(kind: Emote): void {
		const engine = engineRef.current;
		if (!engine) return;
		const target = kind === 'slap' ? engine.nearestTo() : null;
		engine.emote(state.me.id, kind, target);
		sendWorld({kind: 'emote', id: state.me.id, room, emote: kind, target});
	}

	const here = Object.values(peers).filter((p) => p.room === room);
	const houses = Object.values(peers).filter((p) => p.house.length > 0);
	const selectedPeer = selected ? peers[selected] : null;

	return (
		<div className="world">
			<div className="world-stage" ref={hostRef} />
			{!catalog ? <div className="world-loading">Cargando el mundo…</div> : null}

			<header className="world-top">
				<nav className="world-rooms">
					{ROOMS.map((r) => (
						<button key={r.id} type="button" className={room === r.id ? 'is-active' : ''} onClick={() => setRoom(r.id)}>
							<span>{r.emoji}</span> {r.name}
							{Object.values(peers).some((p) => p.room === r.id) ? <i className="world-dot" /> : null}
						</button>
					))}
					<button type="button" className={room === `house:${state.me.id}` ? 'is-active' : ''} onClick={() => setRoom(`house:${state.me.id}`)}>
						<span>🏠</span> Mi casa
					</button>
					{houses.length ? (
						<select
							className="world-houses"
							value={houseOwner && houseOwner !== state.me.id ? houseOwner : ''}
							onChange={(e) => e.target.value && setRoom(`house:${e.target.value}`)}>
							<option value="">Casas de amigos…</option>
							{houses.map((p) => <option key={p.id} value={p.id}>Casa de {names[p.id] ?? p.name}</option>)}
						</select>
					) : null}
				</nav>
				<div className="world-tools">
					<span className={`w-coins${coinFlash ? ' is-flash' : ''}`} title="Pelamonedas: ganás jugando y estando en el mundo">🪙 {profile.coins}</span>
					<button type="button" onClick={() => setPanel('editor')} title="Editar mi personaje">🧑‍🎨</button>
					<button type="button" onClick={() => setPanel('shop-clothes')} title="Catálogo de ropa">👕</button>
					<button type="button" onClick={() => setPanel('shop-furniture')} title="Catálogo de muebles">🛋️</button>
					<button type="button" onClick={() => setPanel('games')} title="Juegos de mesa" className={invites.length ? 'has-badge' : ''}>
						🎲{invites.length ? <i className="world-badge">{invites.length}</i> : null}
					</button>
					{houseOwner === state.me.id ? <button type="button" onClick={() => setPanel('decorate')} title="Decorar mi casa">🔨</button> : null}
					<button type="button" className={spatial ? 'is-on' : ''} onClick={() => setSpatial((v) => !v)} title={spatial ? 'Audio espacial activado: las voces salen desde cada personaje' : 'Audio espacial apagado'}>
						{spatial ? '🎧' : '🔈'}
					</button>
					<button type="button" onClick={onClose} title="Salir del mundo">✕</button>
				</div>
			</header>

			<footer className="world-emotes">
				<button type="button" onClick={() => emote('wave')}>👋 Saludar</button>
				<button type="button" onClick={() => emote('slap')}>🖐️ Cachetada</button>
				<button type="button" onClick={() => emote('laugh')}>😂 Risa</button>
				<span className="world-here">{here.length ? `${here.length + 1} acá` : 'Estás solo en esta sala'}</span>
			</footer>

			{selectedPeer ? (
				<div className="world-card" role="dialog">
					<strong>{names[selectedPeer.id] ?? selectedPeer.name}</strong>
					<button type="button" className="w-secondary small" onClick={() => { setPanel('games'); setSelected(null); }}>🎲 Invitar a jugar</button>
					{selectedPeer.house.length ? (
						<button type="button" className="w-secondary small" onClick={() => { setRoom(`house:${selectedPeer.id}`); setSelected(null); }}>🏠 Ir a su casa</button>
					) : null}
					<button type="button" className="w-x" onClick={() => setSelected(null)} aria-label="Cerrar">✕</button>
				</div>
			) : null}

			{invites.length && panel !== 'games' ? (
				<button type="button" className="world-invite-toast" onClick={() => setPanel('games')}>
					🎲 {invites[0].fromName} te invita a jugar · tocá para ver
				</button>
			) : null}

			{catalog && (panel === 'editor' || firstTime) ? <EditorPanel catalog={catalog} firstTime={firstTime} onClose={() => setPanel(null)} /> : null}
			{catalog && panel === 'shop-clothes' ? <ShopPanel catalog={catalog} kind="clothes" onClose={() => setPanel(null)} onEdit={() => setPanel('editor')} /> : null}
			{catalog && panel === 'shop-furniture' ? <ShopPanel catalog={catalog} kind="furniture" onClose={() => setPanel(null)} onEdit={() => setPanel('editor')} /> : null}
			{panel === 'games' ? (
				<GamesPanel meId={state.me.id} myName={state.me.name} players={Object.values(peers)} names={names} onClose={() => setPanel(null)} />
			) : null}
			{catalog && panel === 'decorate' ? (
				<DecoratePanel
					catalog={catalog}
					placing={placing}
					onPlace={(item) => {
						if (item && room !== `house:${state.me.id}`) setRoom(`house:${state.me.id}`);
						setPlacing(item);
					}}
					onRotate={() => engineRef.current?.rotateGhost()}
					onClose={() => {
						setPlacing(null);
						setPanel(null);
					}}
				/>
			) : null}
		</div>
	);
}
