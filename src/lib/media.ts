import {getDesktopTransport} from '@/lib/desktop';

export interface MeshRemote {
	peerId: string;
	audios: MediaStream[];
	video: MediaStream | null;
}

/**
 * Lo mínimo del transporte que usa la malla.
 *
 * Se pide por función (y no directo al global) para poder probar la negociación con un
 * transporte falso: es la parte más delicada de la llamada y así se verifica sin adivinar.
 */
export interface MeshTransport {
	onSignal(callback: (message: {from: string; payload: unknown}) => void): () => void;
	sendSignal(to: string, payload: unknown): void;
	selectSource?(id: string): void;
}

type SignalPayload = {
	kind: 'offer' | 'answer' | 'candidate';
	sdp?: RTCSessionDescriptionInit;
	candidate?: RTCIceCandidateInit;
};

/** El SDP tiene que ir como objeto plano: RTCSessionDescription no sobrevive al IPC de Electron. */
function plainSdp(description: RTCSessionDescription | null): RTCSessionDescriptionInit | undefined {
	return description ? {type: description.type, sdp: description.sdp} : undefined;
}

/**
 * Malla de voz/video peer-to-peer con "perfect negotiation": cualquier lado puede renegociar
 * (agregar/quitar la pantalla) y los choques se resuelven solos. Sin STUN ni TURN propios.
 */
export class VoiceMesh {
	private pcs = new Map<string, RTCPeerConnection>();
	private remotes = new Map<string, MeshRemote>();
	private states = new Map<string, RTCPeerConnectionState>();
	private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
	private remoteReady = new Set<string>();
	private makingOffer = new Set<string>();
	private listeners = new Set<() => void>();
	private unsubSignal: (() => void) | null = null;
	/** Peers del canal con los que HAY que estar conectado. El vigilante reconecta solo. */
	private desired = new Set<string>();
	/**
	 * Señales en cola por peer: cada uno las procesa de a UNA.
	 *
	 * Sin esto, dos mensajes se procesaban en paralelo y el estado de la conexión cambiaba entre
	 * el chequeo y la llamada real: ahí salía "Failed to set remote answer sdp: Called in wrong
	 * state: stable" (una respuesta se aplicaba dos veces o tarde) y esa conexión quedaba muda.
	 */
	private signalChains = new Map<string, Promise<void>>();
	/** Cuántas veces se reinició el ICE de cada conexión. */
	private iceRestarts = new Map<string, number>();
	/** Desde cuándo cada conexión está "disconnected" (para no reiniciar por un hipo corto). */
	private disconnectedAt = new Map<string, number>();
	private watchdog: ReturnType<typeof setInterval> | null = null;
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

	/** El transporte se inyecta para poder probar la malla con uno falso. */
	private readonly getTransport: () => MeshTransport | null;

	constructor(getTransport: () => MeshTransport | null = () => getDesktopTransport() as MeshTransport | null) {
		this.getTransport = getTransport;
	}

	getRemotes(): MeshRemote[] {
		return [...this.remotes.values()];
	}

	getStates(): Record<string, RTCPeerConnectionState> {
		return Object.fromEntries(this.states);
	}

	getDiagnostics(): Record<string, {sent: number; received: number; ice: RTCIceConnectionState; signaling?: RTCSignalingState; canales?: string}> {
		const result: Record<string, {sent: number; received: number; ice: RTCIceConnectionState; signaling?: RTCSignalingState; canales?: string}> = {};
		for (const [peerId, entry] of this.diagnostics) {
			const pc = this.pcs.get(peerId);
			result[peerId] = {
				...entry,
				signaling: pc?.signalingState ?? 'closed',
				// Los canales de la conexión, en orden: es lo que permite ver si el otro lado tiene
				// la misma estructura (voz, música, pantalla) o si algo se desalineó.
				canales: pc
					? pc
							.getTransceivers()
							.map((transceiver) => `${transceiver.receiver.track?.kind ?? '?'}/${transceiver.currentDirection ?? '-'}@${transceiver.mid ?? '-'}`)
							.join(' ')
					: '',
			};
		}
		return result;
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
		const transport = this.getTransport();
		if (!transport) return;
		this.myId = myId;
		if (!this.unsubSignal) {
			this.unsubSignal = transport.onSignal((message) => this.onSignal(message));
		}
		this.startWatchdog();
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
		this.stopWatchdog();
		this.desired.clear();
		this.signalChains.clear();
		this.iceRestarts.clear();
		this.disconnectedAt.clear();
		this.senders.clear();
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

	/**
	 * Los "senders" de cada conexión, por rol: voz y pantalla.
	 *
	 * Se llenan con `addTrack` la primera vez que hace falta y después sólo se les cambia la pista
	 * con `replaceTrack` (así no se agregan canales de más ni se renegocia al empezar a compartir).
	 *
	 * IMPORTANTE: se usa `addTrack` y NO `addTransceiver`. La diferencia no es cosmética: cuando
	 * los dos lados agregan una pista al mismo tiempo, WebRTC REUTILIZA el canal creado con
	 * `addTrack` pero NO el creado con `addTransceiver`: con `addTransceiver` cada lado terminaba
	 * con los suyos y los del otro (6 canales en vez de 3) y la negociación se rompía con
	 * "The order of m-lines in subsequent offer doesn't match order from previous offer/answer" —
	 * la conexión quedaba MUDA (dos no se escuchaban y el tercero sí). Ese error lo encontramos
	 * midiendo, y antes se perdía en un catch vacío.
	 */
	private senders = new Map<string, {voice?: RTCRtpSender; screen?: RTCRtpSender}>();

	/** Cambia la pista de un rol (si ese canal todavía no existe, no hace nada). */
	private async replace(peerId: string, kind: 'voice' | 'screen', track: MediaStreamTrack | null): Promise<void> {
		const sender = this.senders.get(peerId)?.[kind];
		if (!sender) return;
		await sender.replaceTrack(track).catch(() => {});
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
		for (const [peerId, pc] of this.pcs) {
			const roles = this.senders.get(peerId) ?? {};
			if (roles.voice) await roles.voice.replaceTrack(nextTrack).catch(() => {});
			else roles.voice = pc.addTrack(nextTrack, stream);
			this.senders.set(peerId, roles);
		}
		previousTrack?.stop();
		if (this.local) this.attachAnalyser(this.myId, this.local);
		this.emit();
	}

	/** Conecta con un peer del canal. La negociación la maneja onnegotiationneeded. */
	async connect(peerId: string): Promise<void> {
		if (peerId === this.myId) return;
		this.desired.add(peerId);
		await this.pcFor(peerId);
	}

	disconnect(peerId: string): void {
		this.desired.delete(peerId);
		this.drop(peerId);
	}

	async startScreen(sourceId?: string): Promise<void> {
		const transport = this.getTransport();
		if (sourceId && transport) transport.selectSource?.(sourceId);
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
		// Se deja de mandar por el canal de pantalla (sin renegociar): el otro lado lo detecta por
		// el "mute" de la pista y esconde el video.
		for (const peerId of this.pcs.keys()) void this.replace(peerId, 'screen', null);
		for (const track of stream.getTracks()) track.stop();
		this.emit();
	}

	private send(to: string, payload: SignalPayload): void {
		this.getTransport()?.sendSignal(to, payload);
	}

	private async pcFor(peerId: string): Promise<RTCPeerConnection> {
		const existing = this.pcs.get(peerId);
		if (existing) return existing;
		const pc = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.l.google.com:19302'}]});
		this.pcs.set(peerId, pc);
		this.remotes.set(peerId, {peerId, audios: [], video: null});
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
				if (!remote.audios.includes(stream)) {
					remote.audios.push(stream);
					if (!this.analysers.has(peerId)) this.attachAnalyser(peerId, stream);
				}
			} else {
				// La pantalla se corta con "mute" (se deja de mandar sin renegociar). Acá se guarda el
				// stream igual y la INTERFAZ decide (useRemoteVideo mira `muted`): si acá se pusiera en
				// null mientras la pista arranca muteada, no se vería nunca la pantalla.
				remote.video = stream;
				const refrescar = () => this.emit();
				event.track.addEventListener('mute', refrescar);
				event.track.addEventListener('unmute', refrescar);
				event.track.addEventListener('ended', refrescar);
			}
			this.emit();
		};

		pc.onconnectionstatechange = () => {
			this.states.set(peerId, pc.connectionState);
			console.log(`[pelacord-media] ${peerId} conexión: ${pc.connectionState} (ice: ${pc.iceConnectionState})`);
			this.emit();
			if (pc.connectionState === 'failed') {
				// OJO: NO se tira la conexión. Antes se cerraba y nadie la volvía a armar, así que
				// dos personas quedaban sin escucharse para siempre (la llamada "a medias").
				// Primero se intenta reiniciar el ICE; si no da, el vigilante la rearma.
				this.tryIceRestart(peerId, pc);
				return;
			}
			if (pc.connectionState === 'closed') {
				this.drop(peerId);
				return;
			}
			if (pc.connectionState === 'disconnected') {
				if (!this.disconnectedAt.has(peerId)) this.disconnectedAt.set(peerId, Date.now());
				return;
			}
			if (pc.connectionState === 'connected') {
				this.iceRestarts.set(peerId, 0);
				this.disconnectedAt.delete(peerId);
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

		await this.syncTracks(peerId, pc);
		return pc;
	}

	private async ensureTracksOnAll(): Promise<void> {
		for (const [peerId, pc] of this.pcs) await this.syncTracks(peerId, pc);
	}

	/**
	 * Deja en la conexión las pistas locales que haya ahora: micrófono, música y pantalla.
	 *
	 * La primera vez que hace falta un canal se crea con `addTrack`; después sólo se cambia la pista
	 * (replaceTrack). Nunca se agregan canales de más (ver la nota de `senders`).
	 */
	private async syncTracks(peerId: string, pc: RTCPeerConnection): Promise<void> {
		const roles = this.senders.get(peerId) ?? {};
		const voiceTrack = this.local?.getAudioTracks()[0] ?? null;
		if (voiceTrack && this.local) {
			if (roles.voice) await roles.voice.replaceTrack(voiceTrack).catch(() => {});
			else roles.voice = pc.addTrack(voiceTrack, this.local);
		}
		const screenTrack = this.screen?.getVideoTracks()[0] ?? null;
		if (screenTrack && this.screen) {
			if (roles.screen) await roles.screen.replaceTrack(screenTrack).catch(() => {});
			else {
				roles.screen = pc.addTrack(screenTrack, this.screen);
				const transceiver = pc.getTransceivers().find((candidate) => candidate.sender === roles.screen);
				if (transceiver) this.preferH264(transceiver);
				// El bitrate de la pantalla se aplica cuando el encoding ya existe.
				this.tuneVideoSender(roles.screen);
				setTimeout(() => this.tuneVideoSender(roles.screen as RTCRtpSender), 800);
			}
		}
		this.senders.set(peerId, roles);
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
		this.disconnectedAt.delete(peerId);
		this.senders.delete(peerId);
		this.detachAnalyser(peerId);
		this.emit();
	}

	/** Reinicia el ICE de una conexión. Si ya se reinició demasiadas veces, la tira para rearmarla. */
	private tryIceRestart(peerId: string, pc: RTCPeerConnection): void {
		const attempts = (this.iceRestarts.get(peerId) ?? 0) + 1;
		this.iceRestarts.set(peerId, attempts);
		if (attempts > 3) {
			console.warn(`[pelacord-media] ${peerId}: se rearma la conexión desde cero`);
			this.drop(peerId);
			return;
		}
		try {
			pc.restartIce();
		} catch {
			this.drop(peerId);
		}
	}

	/**
	 * Vigilante: cada 5 s revisa que todos los peers del canal tengan una conexión viva.
	 *
	 * Recrea las que faltan o se cayeron, y corta las que ya no corresponden. Esto es lo que hace
	 * que la llamada se ARREGLE SOLA: antes, si una conexión se caía, quedaba muerta hasta salir y
	 * volver a entrar al canal (era justo el caso "dos no se escuchan y el tercero sí").
	 */
	private startWatchdog(): void {
		if (this.watchdog) return;
		this.watchdog = setInterval(() => {
			for (const peerId of this.desired) {
				const pc = this.pcs.get(peerId);
				if (!pc) {
					void this.pcFor(peerId);
					continue;
				}
				if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
					this.tryIceRestart(peerId, pc);
					continue;
				}
				if (pc.connectionState === 'disconnected') {
					const since = this.disconnectedAt.get(peerId) ?? Date.now();
					if (Date.now() - since > 12000) this.tryIceRestart(peerId, pc);
				}
			}
			for (const peerId of [...this.pcs.keys()]) {
				if (!this.desired.has(peerId)) this.drop(peerId);
			}
		}, 5000);
	}

	private stopWatchdog(): void {
		if (!this.watchdog) return;
		clearInterval(this.watchdog);
		this.watchdog = null;
	}

	/**
	 * Encola la señal: cada peer procesa las suyas de a UNA.
	 *
	 * Si se procesan en paralelo, el estado de la conexión cambia entre el chequeo y la llamada
	 * real (dos respuestas aplicadas a la vez) y sale "Called in wrong state: stable": esa
	 * conexión quedaba muda. Con la cola, cada mensaje ve el estado verdadero.
	 */
	private onSignal(message: {from: string; payload: unknown}): void {
		const from = message?.from;
		if (!from) return;
		const previous = this.signalChains.get(from) ?? Promise.resolve();
		const next = previous
			.then(() => this.applySignal(message))
			.catch((error) => console.warn('[pelacord-media] señal descartada:', String(error)));
		this.signalChains.set(from, next);
	}

	private async applySignal(message: {from: string; payload: unknown}): Promise<void> {
		const payload = message.payload as SignalPayload;
		if (!payload || !payload.kind) return;
		const from = message.from;

		// Si el peer no está en el canal (y nunca hablamos con él), se ignora: si no, alguien que
		// ya se fue puede rearmar la conexión y armar una guerra de reconexiones.
		if (!this.desired.has(from) && !this.pcs.has(from)) return;

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
			} catch (error) {
				// Se muestra QUÉ canales trae el otro y cuáles tengo yo: si se desalinean, WebRTC
				// rechaza la oferta ("The order of m-lines...") y la conexión queda muda. Antes este
				// error se perdía en un catch vacío y parecía que "la llamada no anda y listo".
				const suyos = String(payload.sdp.sdp ?? '')
					.split('\n')
					.filter((line) => line.startsWith('m='))
					.map((line) => line.slice(2).split(' ')[0])
					.join(' ');
				const mios = pc
					.getTransceivers()
					.map((transceiver) => `${transceiver.receiver.track?.kind ?? '?'}@${transceiver.mid ?? '-'}`)
					.join(' ');
				console.warn(
					`[pelacord-media] ${from}: no pude aplicar la oferta (${String(error)}) · su oferta: [${suyos}] · mis canales: [${mios}]`,
				);
				return;
			}
			this.remoteReady.add(from);
			await this.flushCandidates(from, pc);
			try {
				await pc.setLocalDescription();
			} catch (error) {
				console.warn(`[pelacord-media] ${from}: no pude armar la respuesta`, String(error));
				return;
			}
			this.send(from, {kind: 'answer', sdp: plainSdp(pc.localDescription)});
			return;
		}

		if (payload.kind === 'answer' && payload.sdp) {
			// Si la respuesta llega cuando ya no la esperábamos (duplicada o tarde) se ignora:
			// antes esto tiraba "Called in wrong state: stable" y ensuciaba la negociación.
			if (pc.signalingState !== 'have-local-offer') return;
			try {
				await pc.setRemoteDescription(payload.sdp);
			} catch (error) {
				console.warn(`[pelacord-media] ${from}: no pude aplicar la respuesta`, String(error));
				return;
			}
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
