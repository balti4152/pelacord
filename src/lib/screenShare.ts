import {getDesktopTransport, type DesktopSource} from '@/lib/desktop';

/**
 * Calidad fija de la transmisión: 1080p a 60 fps.
 *
 * No hay selector de pantalla: se comparte directo. Si querés otra ventana, el atajo de
 * "compartir la ventana enfocada" toma la que tenías adelante.
 */
export interface ShareOptions {
	width: number;
	height: number;
	frameRate: number;
	audio: boolean;
	maxBitrate: number;
}

export const DEFAULT_SHARE_OPTIONS: ShareOptions = {width: 1920, height: 1080, frameRate: 60, audio: true, maxBitrate: 14_000_000};

export type ShareKind = 'screen' | 'window';

/**
 * Prepara la transmisión SIN abrir ningún selector: elige la fuente y deja todo listo.
 *
 * - `screen`: el monitor principal (el que Chromium reporta primero).
 * - `window`: la ventana que estaba adelante (Chromium las devuelve por uso reciente).
 *
 * Devuelve false si no hay nada para compartir. Ojo: NO trae la ventana al frente, porque si no
 * "compartir la ventana enfocada" perdería el sentido.
 */
export async function findShareSource(kind: ShareKind): Promise<DesktopSource | null> {
	const transport = getDesktopTransport();
	if (!transport) return null;
	try {
		const sources = await transport.getDesktopSources();
		return sources.find((source) => source.kind === kind) ?? null;
	} catch {
		return null;
	}
}
