/**
 * Música de la Arena: un "director" que elige qué suena según la fase de la partida.
 *
 *   Lobby (sin partida)   → lista tranqui mezclada (Main Menu, Town…), un tema detrás de otro.
 *   Cartel + juego        → el tema que va con el juego (Short Fuse para la bomba, Home Run para el
 *                           fútbol…) arranca con el cartel de instrucciones y sigue hasta que termina
 *                           ese juego. Se elige con la semilla de la partida: todos escuchan el mismo.
 *   Resultados            → corta la música y suena un jingle de victoria (solo, limpio).
 *   Podio final           → el jingle más largo y después el "Scoreboard" (sólo al final de todo).
 *
 * Nunca se pisan dos temas: el que sale se apaga antes de que entre un jingle, y entre temas de fondo
 * hay un fundido corto. El volumen sigue al volumen general de la app y al botón de sonidos del mundo,
 * y baja solo si estás escuchando música en la Jam.
 */
import {getOutputVolume, routeMediaOutput, subscribeOutputVolume} from '@/lib/sounds';
import {currentMusicAudio} from '@/lib/musicPlayer';
import type {PartyState} from '@/world/party';
import type {GameId} from '@/world/partyGames';

const PATH = 'sounds/arena/';

/** Tema de fondo (se puede repetir) o jingle (suena una vez, a todo volumen). */
type Track = {file: string; kind: 'bed' | 'stinger'};
const MUSIC_LEVEL = 0.34;
const STINGER_LEVEL = 0.5;
const VOLUME_KEY = 'pelacord.arena.musicVolume';

function readVolume(): number {
	try {
		const raw = localStorage.getItem(VOLUME_KEY);
		const value = raw === null ? NaN : Number(raw);
		return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.4;
	} catch {
		return 0.4;
	}
}

const LOBBY = ['menu', 'town', 'jungle_town', 'alpine_town', 'mg_intro_1', 'mg_intro_2'];
const WINS = ['win_1', 'win_2', 'win_3', 'win_5'];
const FINAL_WIN = 'win_4';

/** Qué temas van con cada juego (por el nombre del tema). */
const GAME_TRACKS: Record<GameId, string[]> = {
	race: ['conveyor', 'factory', 'alpine_factory'],
	floor: ['conveyor', 'alpine_factory', 'factory'],
	king: ['fire_hole', 'jungle', 'mg_1'],
	bomb: ['short_fuse'],
	fruit: ['pinata', 'candy'],
	colors: ['candy', 'mg_2', 'mg_3'],
	soccer: ['home_run'],
	paint: ['jungle', 'mg_4', 'alpine'],
	boat: ['fire_hole', 'alpine', 'mg_3'],
};

/** Lo que tiene que sonar ahora: una secuencia de temas (el último se repite o la lista vuelve a empezar). */
interface Program {
	key: string;
	steps: Track[];
	/** 'last': repite el último paso. 'cycle': vuelve al primero. 'none': termina y queda en silencio. */
	repeat: 'last' | 'cycle' | 'none';
	/** Cómo entra: 'cut' apaga lo anterior rápido y entra de una (jingles, arranque del juego). */
	entry: 'cut' | 'fade';
}

function hash(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return h >>> 0;
}

function pick<T>(list: T[], seed: string): T {
	return list[hash(seed) % list.length];
}

/** El tema de cada ronda, sin repetir el de la ronda anterior (si el juego tiene otra opción). */
function gameTrack(s: PartyState, round: number): string {
	let previous = '';
	let choice = '';
	for (let r = 0; r <= round; r++) {
		const pool = GAME_TRACKS[s.games[r]] ?? ['mg_1', 'mg_2', 'mg_3', 'mg_4'];
		const options = pool.length > 1 ? pool.filter((f) => f !== previous) : pool;
		choice = pick(options, `${s.id}:${r}`);
		previous = choice;
	}
	return choice;
}

function shuffled(list: string[], seed: number): string[] {
	const out = [...list];
	let x = seed || 1;
	for (let i = out.length - 1; i > 0; i--) {
		x = (Math.imul(x, 1103515245) + 12345) >>> 0;
		const j = x % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

const bed = (file: string): Track => ({file, kind: 'bed'});
const stinger = (file: string): Track => ({file, kind: 'stinger'});

/** Qué programa corresponde al estado de la partida (null = silencio). */
export function programFor(s: PartyState | null, inArena: boolean): Program | null {
	if (!inArena) return null;
	if (!s) return {key: 'lobby', steps: shuffled(LOBBY, Math.floor(Date.now() / 1000)).map(bed), repeat: 'cycle', entry: 'fade'};
	const round = `${s.id}:${s.round}`;
	switch (s.phase) {
		// El cartel de instrucciones y el juego comparten programa: el tema no cambia al arrancar.
		case 'intro':
		case 'play':
			return {key: `game:${round}`, steps: [bed(gameTrack(s, s.round))], repeat: 'last', entry: 'cut'};
		case 'results':
			return {key: `results:${round}`, steps: [stinger(pick(WINS, `win:${round}`))], repeat: 'none', entry: 'cut'};
		case 'final':
			return {key: `final:${s.id}`, steps: [stinger(FINAL_WIN), bed('scoreboard')], repeat: 'last', entry: 'cut'};
	}
}

interface Voice {
	audio: HTMLAudioElement;
	track: Track;
	/** Volumen propio (0..1) del fundido, se multiplica por el del tipo de tema. */
	gain: number;
	target: number;
	/** Velocidad del fundido (unidades de gain por segundo). */
	rate: number;
	/** Cuando llega a 0, se descarta. */
	dying: boolean;
}

class ArenaMusic {
	private program: Program | null = null;
	private step = 0;
	private voice: Voice | null = null;
	private dying: Voice[] = [];
	private timer: number | null = null;
	private startTimer: number | null = null;
	private lastTick = 0;
	private enabled = true;
	private device = 'default';
	private preloaded = new Map<string, HTMLAudioElement>();
	/** Volumen de la música que elige cada uno (se guarda y queda siempre así). */
	private volume = readVolume();

	getVolume(): number {
		return this.volume;
	}

	setVolume(value: number): void {
		this.volume = Math.min(1, Math.max(0, value));
		try { localStorage.setItem(VOLUME_KEY, String(this.volume)); } catch { /* sin almacenamiento */ }
		this.applyVolumes();
	}

	constructor() {
		subscribeOutputVolume(() => this.applyVolumes());
	}

	setEnabled(on: boolean): void {
		if (this.enabled === on) return;
		this.enabled = on;
		if (!on) this.silence(0.4);
		else {
			const program = this.program;
			this.program = null;
			if (program) this.play(program);
		}
	}

	setOutputDevice(device: string): void {
		if (this.device === device) return;
		this.device = device;
		for (const v of [this.voice, ...this.dying]) if (v) void routeMediaOutput(v.audio, device);
	}

	/** Se llama cada vez que cambia la partida o la sala: si el programa es el mismo, no toca nada. */
	update(s: PartyState | null, inArena: boolean): void {
		if (inArena) this.preload(s);
		const next = programFor(s, inArena);
		if ((next?.key ?? '') === (this.program?.key ?? '')) return;
		if (!next) {
			this.program = null;
			this.silence(1);
			return;
		}
		this.play(next);
	}

	/** Deja todo listo de antemano para que los jingles entren justo a tiempo. */
	private preload(s: PartyState | null): void {
		const files = [...WINS, FINAL_WIN, 'scoreboard'];
		if (s) for (let r = 0; r < s.games.length; r++) files.push(gameTrack(s, r));
		for (const file of files) {
			if (this.preloaded.has(file)) continue;
			const audio = new Audio(PATH + file + '.ogg');
			audio.preload = 'auto';
			this.preloaded.set(file, audio);
		}
	}

	private play(program: Program): void {
		const cut = program.entry === 'cut';
		this.program = program;
		this.step = 0;
		if (this.startTimer !== null) window.clearTimeout(this.startTimer);
		this.startTimer = null;
		if (!this.enabled) return;
		// Lo que estaba sonando se va: rápido si entra un jingle o arranca el juego, suave si no.
		const hadMusic = Boolean(this.voice);
		this.silence(cut ? 0.3 : 1.1);
		// Un jingle no entra encima de nada: espera a que se apague lo anterior.
		const wait = hadMusic ? (cut ? 320 : 450) : 0;
		const key = program.key;
		const start = () => {
			this.startTimer = null;
			if (this.program?.key === key) this.startStep(cut ? 0.12 : 1.4);
		};
		if (wait) this.startTimer = window.setTimeout(start, wait);
		else start();
	}

	private startStep(fadeIn: number): void {
		const program = this.program;
		if (!program || !this.enabled) return;
		const track = program.steps[this.step];
		if (!track) return;
		const audio = this.take(track.file);
		const lastStep = this.step === program.steps.length - 1;
		audio.loop = lastStep && program.repeat === 'last' && track.kind === 'bed';
		audio.currentTime = 0;
		const voice: Voice = {audio, track, gain: track.kind === 'stinger' ? 1 : 0, target: 1, rate: 1 / Math.max(0.05, fadeIn), dying: false};
		const key = program.key;
		audio.onended = () => {
			if (this.voice !== voice || this.program?.key !== key) return;
			this.voice = null;
			this.next(track);
		};
		this.voice = voice;
		this.applyVolume(voice);
		void audio.play().catch(() => {
			// Sin permiso de reproducción todavía (no hubo clic): se reintenta en la próxima actualización.
			if (this.voice === voice) this.voice = null;
			if (this.program?.key === key) this.program = null;
		});
		this.ensureTimer();
	}

	/** Terminó un paso: sigue el próximo, vuelve a empezar la lista o queda en silencio. */
	private next(ended: Track): void {
		const program = this.program;
		if (!program) return;
		if (this.step < program.steps.length - 1) this.step += 1;
		else if (program.repeat === 'cycle') this.step = 0;
		else if (program.repeat === 'last') this.step = program.steps.length - 1;
		else return;
		// Después de un jingle, el fondo entra suave; entre temas del lobby, también.
		this.startStep(ended.kind === 'stinger' ? 0.8 : 1.2);
	}

	private take(file: string): HTMLAudioElement {
		let audio = this.preloaded.get(file);
		const busy = audio && (audio === this.voice?.audio || this.dying.some((v) => v.audio === audio));
		if (!audio || busy) {
			audio = new Audio(PATH + file + '.ogg');
			audio.preload = 'auto';
			if (!busy) this.preloaded.set(file, audio);
		}
		if (this.device !== 'default') void routeMediaOutput(audio, this.device);
		return audio;
	}

	private silence(seconds: number): void {
		if (this.voice) {
			this.voice.dying = true;
			this.voice.target = 0;
			this.voice.rate = 1 / Math.max(0.05, seconds);
			this.voice.audio.onended = null;
			this.dying.push(this.voice);
			this.voice = null;
		}
		for (const v of this.dying) v.rate = Math.max(v.rate, 1 / Math.max(0.05, seconds));
		this.ensureTimer();
	}

	private ensureTimer(): void {
		if (this.timer !== null) return;
		this.lastTick = performance.now();
		this.timer = window.setInterval(() => this.tick(), 50);
	}

	private tick(): void {
		const now = performance.now();
		const dt = Math.min(1, (now - this.lastTick) / 1000);
		this.lastTick = now;
		const step = (v: Voice) => {
			const delta = v.rate * dt;
			v.gain = v.gain < v.target ? Math.min(v.target, v.gain + delta) : Math.max(v.target, v.gain - delta);
			this.applyVolume(v);
		};
		if (this.voice) step(this.voice);
		for (const v of [...this.dying]) {
			step(v);
			if (v.gain <= 0) {
				v.audio.pause();
				v.audio.onended = null;
				this.dying.splice(this.dying.indexOf(v), 1);
			}
		}
		// Sin nada que fundir ni nada sonando, el reloj se apaga.
		if (!this.voice && !this.dying.length && this.timer !== null) {
			window.clearInterval(this.timer);
			this.timer = null;
		}
	}

	private applyVolumes(): void {
		for (const v of [this.voice, ...this.dying]) if (v) this.applyVolume(v);
	}

	private applyVolume(v: Voice): void {
		const jam = currentMusicAudio();
		const duck = jam && !jam.paused && jam.volume > 0 ? 0.2 : 1;
		const level = v.track.kind === 'stinger' ? STINGER_LEVEL : MUSIC_LEVEL;
		v.audio.volume = Math.min(1, Math.max(0, v.gain * level * duck * this.volume * getOutputVolume()));
	}
}

export const arenaMusic = new ArenaMusic();
