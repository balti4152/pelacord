/** Ding-dong del timbre (sintetizado: dos campanitas). */
import {getOutputVolume} from '@/lib/sounds';

let ctx: AudioContext | null = null;

export function playDoorbell(): void {
	try {
		ctx ??= new AudioContext();
		const volume = getOutputVolume() * 0.35;
		if (volume <= 0) return;
		const now = ctx.currentTime;
		for (const [freq, at] of [[659.25, 0], [523.25, 0.42]] as const) {
			for (const [mult, level] of [[1, 1], [2.01, 0.28], [3.02, 0.1]] as const) {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = 'sine';
				osc.frequency.value = freq * mult;
				gain.gain.setValueAtTime(0.0001, now + at);
				gain.gain.exponentialRampToValueAtTime(volume * level, now + at + 0.01);
				gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 1.3);
				osc.connect(gain).connect(ctx.destination);
				osc.start(now + at);
				osc.stop(now + at + 1.35);
			}
		}
	} catch {
		// sin audio
	}
}
