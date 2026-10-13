import {getDesktopTransport} from '@/lib/desktop';
import {voiceMesh} from '@/lib/media';

/**
 * Calidad fija de la transmisión: 1080p a 60 fps.
 *
 * No hay selector de pantalla: se comparte directo. Si querés otra ventana, el atajo de
 * "compartir la ventana enfocada" toma la que tenías adelante.
 */
const SCREEN_OPTIONS = {width: 1920, height: 1080, frameRate: 60, audio: false};

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
export async function prepareShare(kind: ShareKind): Promise<boolean> {
	const transport = getDesktopTransport();
	if (!transport) return false;
	try {
		const sources = await transport.getDesktopSources();
		const target =
			kind === 'window'
				? (sources.find((source) => source.kind === 'window') ?? sources[0])
				: (sources.find((source) => source.kind === 'screen') ?? sources[0]);
		if (!target) return false;
		transport.selectSource(target.id);
		voiceMesh.setScreenOptions(SCREEN_OPTIONS);
		return true;
	} catch {
		// Sin fuentes disponibles: no pasa nada.
		return false;
	}
}
