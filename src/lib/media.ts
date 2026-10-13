import {getDesktopTransport} from '@/lib/desktop';

export interface MeshRemote {
	peerId: string;
	audios: MediaStream[];
	video: MediaStream | null;
	/** Audio de la música de la Jam de ese peer (va aparte para poder tener volumen propio). */
	music: MediaStream | null;
}

type SignalPayload = {
	kind: 'offer' | 'answer' | 'candidate' | 'music';
	sdp?: RTCSessionDescriptionInit;
	candidate?: RTCIceCandidateInit;
	/** Id del stream de música, para que el otro sepa cuál es (va aparte de la voz). */
	streamId?: string | null;
};

/** El SDP tiene que ir como objeto plano: RTCSessionDescription no sobrevive al IPC de Electron. */
function plainSdp(description: RTCSessionDescription | null): RTCSessionDescriptionInit | undefined {
	return description ? {type: description.type, sdp: description.sdp} : undefined;
}

/**
 * Malla de voz/video peer-to-peer con "perfect negotiation": cualquier lado puede renegociar
 * (agregar/quitar la pantalla) y los choques se resuelven solos. Sin STUN ni TURN propios.
 */
class VoiceMesh {
	private pcs = new Map<string, RTCPeerConnection>();
	private remotes = new Map<string, MeshRemote>();
	private states = new Map<string, RTCPeerConnectionState>();
	private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
	private remoteReady = new Set<string>();
	private makingOffer = new Set<string>();
	private listeners = new Set<() => void>();
	private unsubSignal: (() => void) | null = null;
	private myId = '';
	private muted = false;
	private deafened = false;
	private inputDeviceId = 'default';
	private screenOptions: {width: number; height: number; frameRate: number; audio: boolean; maxBitrate?: number} = {
		width: 1920,
		height: 1080,
		frameRate: 60,
		audio: false,
	};
	private peerVolumes: Record<string, number> = {};
	private local: MediaStream | null = null;
	private screen: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private analysers = new Map<string, {analyser: AnalyserNode; data: Uint8Array}>();
	private speaking = new Set<string>();
	private speakingTimer: ReturnType<typeof setInterval> | null = null;
	private diagnostics = new Map<string, {sent: number; received: number; ice: RTCIceConnectionState}>();

	getRemotes(): MeshRemote[] {
		return [...this.remotes.values()];
	}

	getStates(): Record<string, RTCPeerConnectionState> {
		return Object.fromEntries(this.states);
	}

	getDiagnostics(): Record<string, {sent: number; received: number; ice: RTCIceConnectionState}> {
		return Object.fromEntries(this.diagnostics);
	}

	getLocal(): MediaStream | null {
		return this.local;
	}

	getScreen(): MediaStream | null {
		return this.screen;
	}

	getSpeaking(): string[] {
		return [...this.speaking];
	}

	isSpeaking(id: string): boolean {
		return this.speaking.has(id);
	}

	subscribe(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	async start(myId: string): Promise<void> {
		const transport = getDesktopTransport();
		if (!transport) return;
		this.myId = myId;
		if (!this.unsubSignal) {
			this.unsubSignal = transport.onSignal((message) => void this.onSignal(message));
		}
		if (!this.local) {
			this.local = await navigator.mediaDevices.getUserMedia(this.micConstraints()).catch(() => null);
			this.local?.getAudioTracks().forEach((track) => {
				track.enabled = !this.muted;
			});
			await this.ensureTracksOnAll();
			if (this.local) this.attachAnalyser(this.myId, this.local);
			this.emit();
		}
	}

	stop(): void {
		this.unsubSignal?.();
		this.unsubSignal = null;
		for (const pc of this.pcs.values()) pc.close();
		this.pcs.clear();
		this.remotes.clear();
		this.states.clear();
		this.makingOffer.clear();
		this.pendingCandidates.clear();
		this.remoteReady.clear();
		this.local?.getTracks().forEach((track) => track.stop());
		this.local = null;
		this.screen?.getTracks().forEach((track) => track.stop());
		this.screen = null;
		this.analysers.clear();
		this.speaking.clear();
		if (this.speakingTimer) {
			clearInterval(this.speakingTimer);
			this.speakingTimer = null;
		}
		void this.audioContext?.close().catch(() => {});
		this.audioContext = null;
		this.emit();
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		this.local?.getAudioTracks().forEach((track) => {
			track.enabled = !muted;
		});
		this.emit();
	}

	setDeafened(deafened: boolean): void {
		this.deafened = deafened;
		this.emit();
	}

	isDeafened(): boolean {
		return this.deafened;
	}

	setScreenAudio(enabled: boolean): void {
		this.screenOptions = {...this.screenOptions, audio: enabled};
	}

	setScreenOptions(options: {width?: number; height?: number; frameRate?: number; audio?: boolean; maxBitrate?: number}): void {
		this.screenOptions = {...this.screenOptions, ...options};
	}

	getPeerVolume(peerId: string): number {
		return this.peerVolumes[peerId] ?? 1;
	}

	setPeerVolume(peerId: string, volume: number): void {
		this.peerVolumes[peerId] = Math.min(1, Math.max(0, volume));
		this.emit();
	}

	private micConstraints(): MediaStreamConstraints {
		const deviceId = this.inputDeviceId && this.inputDeviceId !== 'default' ? {exact: this.inputDeviceId} : undefined;
		return {
			audio: {
				...(deviceId ? {deviceId} : {}),
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
		};
	}

	/** Stream de música de la Jam (lo manda el host). */
	private music: MediaStream | null = null;
	/** Ids de los tracks de música que mandamos: sirven para reconocer el sender en cada conexión. */
	private musicTrackIds = new Set<string>();

	/**
	 * Manda (o corta) el audio de la música a todos los peers.
	 * Se usa `replaceTrack` cuando ya existe el sender: así no hay renegociación ni corte de audio.
	 */
	async setMusicStream(stream: MediaStream | null): Promise<void> {
		const nextTrack = stream?.getAudioTracks()[0] ?? null;
		const previous = this.music?.getAudioTracks()[0] ?? null;
		this.music = stream;
		if (nextTrack) this.musicTrackIds.add(nextTrack.id);
		for (const pc of this.pcs.values()) {
			const sender = pc.getSenders().find((candidate) => candidate.track && this.musicTrackIds.has(candidate.track.id));
			if (nextTrack) {
				if (sender) {
					await sender.replaceTrack(nextTrack).catch(() => {});
				} else {
					try {
						pc.addTrack(nextTrack, stream as MediaStream);
					} catch {
						// si falla, la próxima negociación lo agrega
					}
				}
			} else if (sender) {
				await sender.replaceTrack(null).catch(() => {});
			}
		}
		if (previous && previous !== nextTrack) {
			this.musicTrackIds.delete(previous.id);
			previous.stop();
		}
		this.emit();
	}

	/** El stream de música que está mandando este peer (null si no hay). */
	getMusicStream(): MediaStream | null {
		return this.music;
	}

	getInputDeviceId(): string {
		return this.inputDeviceId;
	}

	async setInputDevice(deviceId: string): Promise<void> {
		this.inputDeviceId = deviceId || 'default';
		if (!this.local) return;
		const stream = await navigator.mediaDevices.getUserMedia(this.micConstraints()).catch(() => null);
		if (!stream) return;
		const nextTrack = stream.getAudioTracks()[0];
		if (!nextTrack) return;
		nextTrack.enabled = !this.muted;
		const previousTrack = this.local.getAudioTracks()[0];
		this.local = stream;
		for (const pc of this.pcs.values()) {
			const sender = pc.getSenders().find((candidate) => candidate.track?.kind === 'audio');
			if (sender) await sender.replaceTrack(nextTrack).catch(() => {});
			else pc.addTrack(nextTrack, stream);
		}
		previousTrack?.stop();
		if (this.local) this.attachAnalyser(this.myId, this.local);
		this.emit();
	}

	/** Conecta con un peer del canal. La negociación la maneja onnegotiationneeded. */
	async connect(peerId: string): Promise<void> {
		if (peerId === this.myId) return;
		await this.pcFor(peerId);
	}

	disconnect(peerId: string): void {
		this.drop(peerId);
	}

	async startScreen(sourceId?: string): Promise<void> {
		const transport = getDesktopTransport();
		if (sourceId && transport) transport.selectSource(sourceId);
		if (!this.screen) {
			const {width, height, frameRate, audio} = this.screenOptions;
			this.screen = await navigator.mediaDevices
				.getDisplayMedia({
					video: {
						width: {ideal: width, max: width},
						height: {ideal: height, max: height},
						frameRate: {ideal: frameRate, max: frameRate},
					},
					audio: audio ? ({restrictOwnAudio: true} as MediaTrackConstraints) : false,
				})
				.catch(() => null);
		}
		if (!this.screen) return;
		for (const track of this.screen.getVideoTracks()) {
			// Pantalla = nitidez. 'motion' es para cámaras y emborrona el contenido de pantalla.
			track.contentHint = 'detail';
			track.addEventListener('ended', () => this.stopScreen());
			// Forzar el tamaño/fps de captura (a veces las constraints de getDisplayMedia se ignoran).
			const {width, height, frameRate} = this.screenOptions;
			await track
				.applyConstraints({
					width: {ideal: width, max: width},
					height: {ideal: height, max: height},
					frameRate: {ideal: frameRate, max: frameRate},
				})
				.catch(() => {});
		}
		await this.ensureTracksOnAll();
		this.emit();
	}

	stopScreen(): void {
		const stream = this.screen;
		if (!stream) return;
		this.screen = null;
		for (const track of stream.getTracks()) {
			for (const pc of this.pcs.values()) {
				const sender = pc.getSenders().find((candidate) => candidate.track === track);
				if (sender) pc.removeTrack(sender);
			}
			track.stop();
		}
		this.emit();
	}

	private send(to: string, payload: SignalPayload): void {
		getDesktopTransport()?.sendSignal(to, payload);
	}

	/** Id del stream de música que anunció cada peer (para saber cuál audio es la música). */
	private remoteMusicIds = new Map<string, string>();

	/**
	 * Avisa a todos qué stream es la música de la Jam.
	 * Sin esto, el otro lado no puede distinguir la música de la voz y no se le podría bajar el
	 * volumen por separado.
	 */
	announceMusicStream(streamId: string | null): void {
		for (const peerId of this.pcs.keys()) this.send(peerId, {kind: 'music', streamId});
	}

	private async pcFor(peerId: string): Promise<RTCPeerConnection> {
		const existing = this.pcs.get(peerId);
		if (existing) return existing;
		const pc = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.l.google.com:19302'}]});
		this.pcs.set(peerId, pc);
		this.remotes.set(peerId, {peerId, audios: [], video: null, music: null});
		this.states.set(peerId, 'new');
		this.diagnostics.set(peerId, {sent: 0, received: 0, ice: 'new'});

		// Perfect negotiation: cualquier lado renegocia cuando cambian sus pistas.
		pc.onnegotiationneeded = async () => {
			try {
				this.makingOffer.add(peerId);
				await pc.setLocalDescription();
				this.send(peerId, {kind: 'offer', sdp: plainSdp(pc.localDescription)});
			} catch {
				// se reintenta en el próximo cambio
			} finally {
				this.makingOffer.delete(peerId);
			}
		};

		pc.onicecandidate = (event) => {
			const diagnostics = this.diagnostics.get(peerId);
			if (event.candidate) {
				if (diagnostics) diagnostics.sent += 1;
				this.send(peerId, {kind: 'candidate', candidate: event.candidate.toJSON()});
				this.emit();
			}
		};

		pc.ontrack = (event) => {
			const remote = this.remotes.get(peerId);
			if (!remote) return;
			const stream = event.streams[0] ?? new MediaStream([event.track]);
			if (event.track.kind === 'audio') {
				// ¿Es la música de la Jam de ese peer? Se reconoce por el id que anunció.
				if (this.remoteMusicIds.get(peerId) === stream.id) {
					remote.music = stream;
					event.track.addEventListener('ended', () => {
						if (remote.music === stream) {
							remote.music = null;
							this.emit();
						}
					});
				} else if (!remote.audios.includes(stream)) {
					remote.audios.push(stream);
					if (!this.analysers.has(peerId)) this.attachAnalyser(peerId, stream);
				}
			} else {
				remote.video = stream;
				event.track.addEventListener('ended', () => {
					if (remote.video === stream) {
						remote.video = null;
						this.emit();
					}
				});
			}
			this.emit();
		};

		pc.onconnectionstatechange = () => {
			this.states.set(peerId, pc.connectionState);
			console.log(`[pelacord-media] ${peerId} conexión: ${pc.connectionState} (ice: ${pc.iceConnectionState})`);
			this.emit();
			if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
				this.drop(peerId);
				return;
			}
			// Reaplicar el bitrate cuando la conexión está lista (los encodings ya existen).
			if (pc.connectionState === 'connected') {
				for (const sender of pc.getSenders()) {
					if (sender.track?.kind === 'video') this.tuneVideoSender(sender);
				}
			}
		};
		pc.oniceconnectionstatechange = () => {
			const diagnostics = this.diagnostics.get(peerId);
			if (diagnostics) diagnostics.ice = pc.iceConnectionState;
			this.emit();
		};

		await this.syncTracks(pc);
		return pc;
	}

	private async ensureTracksOnAll(): Promise<void> {
		for (const pc of this.pcs.values()) await this.syncTracks(pc);
	}

	/** Agrega a la conexión las pistas locales que todavía no tenga (micrófono, pantalla, audio de pantalla). */
	private async syncTracks(pc: RTCPeerConnection): Promise<void> {
		const existing = new Set(pc.getSenders().map((sender) => sender.track).filter(Boolean));
		const addStream = (stream: MediaStream | null) => {
			if (!stream) return;
			for (const track of stream.getTracks()) {
				if (existing.has(track)) continue;
				existing.add(track);
				if (track.kind === 'video') {
					// addTransceiver con sendEncodings: así el bitrate sí se aplica (setParameters antes de
					// negociar no tenía encodings y se descartaba).
					const transceiver = pc.addTransceiver(track, {
						direction: 'sendonly',
						streams: [stream],
						sendEncodings: [
							{
								maxBitrate: this.screenBitrate(),
								maxFramerate: this.screenOptions.frameRate,
								scaleResolutionDownBy: 1,
								priority: 'high',
								networkPriority: 'high',
							},
						],
					});
					this.preferH264(transceiver);
				} else {
					pc.addTrack(track, stream);
				}
			}
		};
		addStream(this.local);
		addStream(this.screen);
		addStream(this.music);
	}

	private preferH264(transceiver: RTCRtpTransceiver): void {
		try {
			const capabilities = RTCRtpSender.getCapabilities('video');
			if (!capabilities) return;
			const preferred = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() === 'video/h264');
			const rest = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== 'video/h264');
			transceiver.setCodecPreferences([...preferred, ...rest]);
		} catch {
			// algunos navegadores no lo soportan
		}
	}

	/** Bitrate generoso según resolución: priorizamos calidad/movimiento antes que fps. */
	private screenBitrate(): number {
		if (this.screenOptions.maxBitrate) return this.screenOptions.maxBitrate;
		const height = this.screenOptions.height;
		if (height <= 720) return 10_000_000;
		if (height <= 1080) return 18_000_000;
		if (height <= 1440) return 28_000_000;
		return 40_000_000;
	}

	private tuneVideoSender(sender: RTCRtpSender): void {
		try {
			const parameters = sender.getParameters();
			if (!parameters.encodings || parameters.encodings.length === 0) parameters.encodings = [{}];
			parameters.encodings[0].maxBitrate = this.screenBitrate();
			parameters.encodings[0].maxFramerate = this.screenOptions.frameRate;
			parameters.encodings[0].scaleResolutionDownBy = 1;
			parameters.encodings[0].priority = 'high';
			parameters.encodings[0].networkPriority = 'high';
			// Pantalla: mantener la NITIDEZ (no 'maintain-framerate', que baja resolución y emborrona).
			parameters.degradationPreference = 'maintain-resolution';
			void sender.setParameters(parameters).catch(() => {});
		} catch {
			// ignore
		}
	}

	private drop(peerId: string): void {
		this.pcs.get(peerId)?.close();
		this.pcs.delete(peerId);
		this.remotes.delete(peerId);
		this.states.delete(peerId);
		this.makingOffer.delete(peerId);
		this.pendingCandidates.delete(peerId);
		this.remoteReady.delete(peerId);
		this.diagnostics.delete(peerId);
		this.detachAnalyser(peerId);
		this.emit();
	}

	private async onSignal(message: {from: string; payload: unknown}): Promise<void> {
		const payload = message.payload as SignalPayload;
		if (!payload || !payload.kind) return;
		const from = message.from;

		// Aviso de "este stream es la música": no es una señal de WebRTC, se guarda y listo.
		// (Va antes de tocar la conexión: si no, crearía una conexión por un mensaje que no lo es.)
		if (payload.kind === 'music') {
			if (payload.streamId) this.remoteMusicIds.set(from, payload.streamId);
			else this.remoteMusicIds.delete(from);
			const remote = this.remotes.get(from);
			if (remote && payload.streamId === null) remote.music = null;
			this.emit();
			return;
		}

		const pc = await this.pcFor(from);
		const polite = this.myId > from;

		if (payload.kind === 'offer' && payload.sdp) {
			const collision = this.makingOffer.has(from) || pc.signalingState !== 'stable';
			if (!polite && collision) return; // el "impolítico" ignora la oferta y gana la suya
			try {
				if (collision) {
					await pc.setLocalDescription({type: 'rollback'});
				}
				await pc.setRemoteDescription(payload.sdp);
			} catch {
				return;
			}
			this.remoteReady.add(from);
			await this.flushCandidates(from, pc);
			await pc.setLocalDescription();
			this.send(from, {kind: 'answer', sdp: plainSdp(pc.localDescription)});
			return;
		}

		if (payload.kind === 'answer' && payload.sdp) {
			if (pc.signalingState !== 'have-local-offer') return;
			await pc.setRemoteDescription(payload.sdp);
			this.remoteReady.add(from);
			await this.flushCandidates(from, pc);
			return;
		}

		if (payload.kind === 'candidate' && payload.candidate) {
			const diagnostics = this.diagnostics.get(from);
			if (diagnostics) diagnostics.received += 1;
			if (!this.remoteReady.has(from)) {
				const queue = this.pendingCandidates.get(from) ?? [];
				queue.push(payload.candidate);
				this.pendingCandidates.set(from, queue);
				return;
			}
			try {
				await pc.addIceCandidate(payload.candidate);
			} catch {
				// candidato inválido o duplicado
			}
		}
	}

	private async flushCandidates(peerId: string, pc: RTCPeerConnection): Promise<void> {
		const queue = this.pendingCandidates.get(peerId);
		if (!queue) return;
		this.pendingCandidates.delete(peerId);
		for (const candidate of queue) {
			try {
				await pc.addIceCandidate(candidate);
			} catch {
				// se ignora
			}
		}
	}

	private ensureAudioContext(): AudioContext {
		if (!this.audioContext) this.audioContext = new AudioContext();
		void this.audioContext.resume().catch(() => {});
		return this.audioContext;
	}

	private attachAnalyser(id: string, stream: MediaStream): void {
		try {
			const context = this.ensureAudioContext();
			const source = context.createMediaStreamSource(stream);
			const analyser = context.createAnalyser();
			analyser.fftSize = 512;
			source.connect(analyser);
			this.analysers.set(id, {analyser, data: new Uint8Array(analyser.frequencyBinCount)});
			this.startSpeakingLoop();
		} catch {
			// sin audio
		}
	}

	private detachAnalyser(id: string): void {
		this.analysers.delete(id);
		if (this.speaking.delete(id)) this.emit();
	}

	private startSpeakingLoop(): void {
		if (this.speakingTimer) return;
		this.speakingTimer = setInterval(() => {
			let changed = false;
			for (const [id, entry] of this.analysers) {
				entry.analyser.getByteTimeDomainData(entry.data);
				let sum = 0;
				for (let i = 0; i < entry.data.length; i++) {
					const value = (entry.data[i] - 128) / 128;
					sum += value * value;
				}
				const loud = Math.sqrt(sum / entry.data.length) > 0.02;
				if (loud && !this.speaking.has(id)) {
					this.speaking.add(id);
					changed = true;
				} else if (!loud && this.speaking.has(id)) {
					this.speaking.delete(id);
					changed = true;
				}
			}
			if (changed) this.emit();
		}, 100);
	}
}

export const voiceMesh = new VoiceMesh();
