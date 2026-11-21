import {type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {getDesktopTransport, type PeerPresence, voiceSessionId} from '@/lib/desktop';
import {currentMusicAudio, loadMusic, seekMusic} from '@/lib/musicPlayer';
import {
	applyMusicCommand,
	currentPositionMs,
	electHost,
	EMPTY_MUSIC_STATE,
	type MusicBroadcast,
	type MusicCommand,
	musicSnapshot,
	type MusicState,
	musicSyncAction,
	type MusicTrack,
	receiveMusicSnapshot,
	sameMusicMoment,
} from '@/lib/musicQueue';
import type {VoiceState} from '@/types';

export function useMusicJam(
	meId: string,
	voice: VoiceState,
	participantIds: string[],
	peers: RefObject<Record<string, PeerPresence>>,
	voiceRef: RefObject<VoiceState>,
) {
	const channelId = voice.channelId;
	const session = voiceSessionId(voice.joinedAt);
	const jams = useRef<Record<string, MusicState>>({});
	const [musicByChannel, setMusicByChannel] = useState<Record<string, MusicState>>({});
	const musicState = (channelId ? musicByChannel[channelId] : null) ?? EMPTY_MUSIC_STATE;
	const host = channelId ? electHost([meId, ...participantIds]) : null;
	const rosterKey = [...participantIds].sort().join(',');
	const serial = useRef(0);
	const accepted = useRef(new Map<string, {from: string; session?: string; serial?: number; time: number}>());

	const hostFor = useCallback((channel: string) => {
		const ids = Object.values(peers.current ?? {}).filter((peer) => peer.channelId === channel).map((peer) => peer.id);
		if (voiceRef.current?.channelId === channel) ids.push(meId);
		return electHost(ids);
	}, [meId, peers, voiceRef]);

	const setJam = useCallback((channel: string, next: MusicState) => {
		jams.current = {...jams.current, [channel]: next};
		setMusicByChannel(jams.current);
	}, []);

	const broadcastJam = useCallback((channel: string, state: MusicState) => {
		const current = voiceRef.current;
		if (!current || current.channelId !== channel || hostFor(channel) !== meId) return;
		const payload: MusicBroadcast = {
			channelId: channel,
			state: {...musicSnapshot(state), hostId: meId},
			voiceSession: voiceSessionId(current.joinedAt),
			serial: ++serial.current,
		};
		getDesktopTransport()?.sendMusic(payload);
	}, [hostFor, meId, voiceRef]);

	const offerJam = useCallback((channel: string, to: string, state: MusicState) => {
		const current = voiceRef.current;
		if (!current || current.channelId !== channel || to === meId) return;
		getDesktopTransport()?.sendCommand(to, {
			kind: 'music', channelId: channel, voiceSession: voiceSessionId(current.joinedAt),
			command: {kind: 'adopt', state: musicSnapshot(state)},
		});
	}, [meId, voiceRef]);

	const applyCommand = useCallback((channel: string, command: MusicCommand) => {
		const existing = jams.current[channel];
		const previous = existing ?? EMPTY_MUSIC_STATE;
		let next: MusicState;
		if (command.kind === 'adopt') {
			const incoming = command.state;
			if (!incoming || !Array.isArray(incoming.queue)) return;
			if (existing && (incoming.revision ?? 0) <= (existing.revision ?? 0)) return;
			next = receiveMusicSnapshot(incoming);
		} else {
			next = applyMusicCommand(previous, command);
			if (next === previous) return;
		}
		const authoritative = {...next, hostId: meId};
		setJam(channel, authoritative);
		broadcastJam(channel, authoritative);
	}, [broadcastJam, meId, setJam]);

	const sendCommand = useCallback((command: MusicCommand) => {
		const current = voiceRef.current;
		if (!current?.channelId) return;
		const channel = current.channelId;
		const leader = hostFor(channel);
		if (leader === meId) applyCommand(channel, command);
		else if (leader) getDesktopTransport()?.sendCommand(leader, {
			kind: 'music', channelId: channel, voiceSession: voiceSessionId(current.joinedAt), command,
		});
	}, [applyCommand, hostFor, meId, voiceRef]);

	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		const offMusic = transport.onMusic(({from, payload}) => {
			const incoming = payload as MusicBroadcast | null;
			if (!incoming?.channelId || !Array.isArray(incoming.state?.queue)) return;
			const channel = incoming.channelId;
			const peer = peers.current?.[from];
			if (peer?.channelId !== channel || (incoming.voiceSession && incoming.voiceSession !== peer.voiceSession) || hostFor(channel) !== from) return;
			const last = accepted.current.get(channel);
			if (last?.from === from && last.session === peer.voiceSession) {
				if (incoming.serial !== undefined && last.serial !== undefined && incoming.serial <= last.serial) return;
				if (incoming.serial === undefined && incoming.state.startedAt < last.time) return;
			}
			accepted.current.set(channel, {from, session: peer.voiceSession, serial: incoming.serial, time: incoming.state.startedAt});
			const existing = jams.current[channel];
			if (existing && incoming.state.revision !== undefined && incoming.state.revision < (existing.revision ?? 0)) {
				offerJam(channel, from, existing);
				return;
			}
			const next = receiveMusicSnapshot({...incoming.state, hostId: from});
			// Reafirmación sin cambios (mismo tema, cola y segundo): no se re-renderiza nada. Quedarse
			// con el reloj anterior además evita que el "ruido" de la red mueva la posición a cada rato.
			if (sameMusicMoment(existing, next)) return;
			setJam(channel, next);
		});
		const offCommand = transport.onCommand(({from, payload}) => {
			const message = payload as {kind: string; channelId?: string; voiceSession?: string; command?: MusicCommand} | null;
			if (message?.kind !== 'music' || !message.command) return;
			const channel = voiceRef.current?.channelId;
			const peer = peers.current?.[from];
			if (!channel || (message.channelId && message.channelId !== channel) || peer?.channelId !== channel ||
				(message.voiceSession && message.voiceSession !== peer.voiceSession) || hostFor(channel) !== meId) return;
			applyCommand(channel, message.command);
		});
		return () => { offMusic(); offCommand(); };
	}, [applyCommand, hostFor, meId, offerJam, peers, setJam, voiceRef]);

	const previousChannel = useRef(channelId);
	useEffect(() => {
		const left = previousChannel.current;
		previousChannel.current = channelId;
		if (!left || left === channelId || hostFor(left)) return;
		const previous = jams.current[left];
		if (previous?.track && !previous.pausedAt) {
			setJam(left, {...previous, pausedAt: Date.now(), positionMs: currentPositionMs(previous)});
		}
	}, [channelId, hostFor, setJam]);

	useEffect(() => {
		if (!channelId || !host) return;
		const state = jams.current[channelId];
		if (host !== meId) {
			if (state && state.hostId !== host) offerJam(channelId, host, state);
			return;
		}
		const announce = () => {
			const current = jams.current[channelId];
			if (current) broadcastJam(channelId, current);
		};
		announce();
		const timer = setInterval(announce, 3500);
		return () => clearInterval(timer);
	}, [broadcastJam, channelId, host, meId, offerJam, rosterKey, session]);

	const track = musicState.track;
	const playbackId = musicState.playbackId;
	const key = track && channelId ? JSON.stringify([channelId, session, track.id, playbackId]) : null;
	const attempt = useRef({key, count: 0});
	const playbackError = useRef<(() => void) | null>(null);
	const [retry, setRetry] = useState(0);
	const [playback, setPlayback] = useState<{key: string; phase: 'loading' | 'ready' | 'error'} | null>(null);
	const musicRetry = useCallback(() => {
		attempt.current.count = 0;
		setRetry((value) => value + 1);
	}, []);

	useLayoutEffect(() => {
		if (!key || !channelId || !track) return;
		if (attempt.current.key !== key) attempt.current = {key, count: 0};
		const controller = new AbortController();
		const {signal} = controller;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const fail = () => {
			if (signal.aborted || retryTimer) return;
			clearTimeout(timeout);
			if (attempt.current.count >= 2) {
				controller.abort();
				setPlayback({key, phase: 'error'});
				return;
			}
			attempt.current.count += 1;
			retryTimer = setTimeout(() => setRetry((value) => value + 1), attempt.current.count * 1200);
		};
		playbackError.current = fail;
		setPlayback({key, phase: 'loading'});
		const transport = getDesktopTransport();
		if (transport) {
			void transport.getAudioUrl(track.url || track.id).then((url) => {
				if (signal.aborted) return;
				if (!url) return fail();
				timeout = setTimeout(fail, 15000);
				loadMusic(url, {
					signal,
					onReady: (audio) => {
						clearTimeout(timeout);
						const current = jams.current[channelId];
						if (!current || current.track?.id !== track.id || current.playbackId !== playbackId) return;
						seekMusic(audio, currentPositionMs(current) / 1000);
						if (!current.pausedAt) {
							void audio
								.play()
								.then(() => {
									// Mientras cargaba el salto, la Jam siguió avanzando: al arrancar de verdad se
									// re-alinea una vez. Si no, uno arrancaba 1-3 s atrás y tardaba en alcanzar.
									if (signal.aborted) return;
									const latest = jams.current[channelId];
									if (!latest || latest.pausedAt || latest.playbackId !== playbackId) return;
									const expected = currentPositionMs(latest);
									if (Math.abs(audio.currentTime * 1000 - expected) > 300) seekMusic(audio, expected / 1000);
								})
								.catch((error) => { if (error.name !== 'AbortError') fail(); });
						}
						setPlayback({key, phase: 'ready'});
					},
					onEnded: () => {
						const current = jams.current[channelId];
						if (!current || current.track?.id !== track.id || current.playbackId !== playbackId) return;
						if (!current.pausedAt && hostFor(channelId) === meId) applyCommand(channelId, {kind: 'skip'});
					},
					onError: fail,
				});
			}).catch(fail);
		} else fail();
		return () => {
			controller.abort();
			playbackError.current = null;
			clearTimeout(timeout);
			clearTimeout(retryTimer);
		};
	}, [applyCommand, channelId, hostFor, key, meId, playbackId, retry, track?.id, track?.url]);

	useEffect(() => {
		const audio = currentMusicAudio();
		if (!key || !channelId || !audio || audio.readyState < 1) return;
		const current = jams.current[channelId];
		if (!current) return;
		seekMusic(audio, currentPositionMs(current) / 1000);
		if (current.pausedAt) audio.pause();
		else if (audio.paused && !audio.ended) {
			const fail = playbackError.current;
			void audio.play().catch((error) => { if (error.name !== 'AbortError') fail?.(); });
		}
	}, [key, channelId, musicState.pausedAt]);

	useEffect(() => {
		if (!channelId || !key) return;
		const timer = setInterval(() => {
			const audio = currentMusicAudio();
			const current = jams.current[channelId];
			if (!audio || !current || audio.readyState < 1 || current.pausedAt || current.track?.id !== track?.id || current.playbackId !== playbackId) return;
			if (audio.ended) {
				if (hostFor(channelId) === meId) applyCommand(channelId, {kind: 'skip'});
				return;
			}
			// Cargando (buffer vacío tras un salto): medir ahora daría un desvío falso.
			if (audio.seeking || audio.readyState < 3) return;
			const expected = currentPositionMs(current);
			const action = musicSyncAction(audio.currentTime * 1000 - expected);
			const rate = action.kind === 'nudge' ? action.rate : 1;
			if (audio.playbackRate !== rate) audio.playbackRate = rate;
			if (action.kind === 'seek') seekMusic(audio, expected / 1000);
		}, 1500);
		return () => clearInterval(timer);
	}, [applyCommand, channelId, hostFor, key, meId, playbackId, track?.id]);

	// El próximo tema se resuelve por adelantado (yt-dlp tarda 2-4 s): así el "siguiente" arranca
	// casi al instante en vez de quedarse en "Cargando audio…".
	const nextTrack = musicState.queue[0];
	const nextTarget = nextTrack ? nextTrack.url || nextTrack.id : null;
	useEffect(() => {
		if (!channelId || !nextTarget) return;
		const timer = setTimeout(() => getDesktopTransport()?.prefetchAudio?.(nextTarget), 1500);
		return () => clearTimeout(timer);
	}, [channelId, nextTarget]);

	return {
		musicState,
		musicPlayback: !key ? 'idle' as const : playback?.key === key ? playback.phase : 'loading' as const,
		musicRetry,
		musicPlay: useCallback((track: MusicTrack | null, startAtMs = 0) => sendCommand({kind: 'play', track, startAtMs}), [sendCommand]),
		musicEnqueue: useCallback((track: MusicTrack) => sendCommand({kind: 'enqueue', track}), [sendCommand]),
		musicEnqueueMany: useCallback((tracks: MusicTrack[]) => { if (tracks.length) sendCommand({kind: 'enqueueMany', tracks}); }, [sendCommand]),
		musicRemove: useCallback((index: number) => sendCommand({kind: 'remove', index}), [sendCommand]),
		musicClearQueue: useCallback(() => sendCommand({kind: 'clearQueue'}), [sendCommand]),
		musicMove: useCallback((from: number, to: number) => sendCommand({kind: 'move', from, to}), [sendCommand]),
		musicSkip: useCallback(() => sendCommand({kind: 'skip'}), [sendCommand]),
		musicTogglePause: useCallback(() => {
			const channel = voiceRef.current?.channelId;
			if (channel) sendCommand({kind: 'pause', paused: !jams.current[channel]?.pausedAt});
		}, [sendCommand, voiceRef]),
	};
}
