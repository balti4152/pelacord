/**
 * Links del mensaje que apuntan DIRECTO a un archivo de imagen, video o audio.
 *
 * Se detecta por la extensión de la URL (no se hace una petición previa: sería lento en cada
 * mensaje). Los que no son media quedan como texto, como siempre.
 */
export type MediaLinkKind = 'image' | 'video' | 'audio';

export interface MediaLink {
	url: string;
	kind: MediaLinkKind;
	/** Nombre del archivo, para mostrarlo. */
	name: string;
}

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'];
const VIDEO = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const AUDIO = ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'opus', 'aac'];

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;

/** Hasta cuántos media se muestran por mensaje (para no llenar la pantalla). */
const MAX_PER_MESSAGE = 3;

export function findMediaLinks(content: string): MediaLink[] {
	if (!content || !content.includes('http')) return [];
	const found: MediaLink[] = [];
	for (const match of content.matchAll(URL_PATTERN)) {
		const url = match[0];
		if (found.some((item) => item.url === url)) continue;
		const withoutQuery = url.split(/[?#]/)[0];
		const dot = withoutQuery.lastIndexOf('.');
		if (dot < 0) continue;
		const extension = withoutQuery.slice(dot + 1).toLowerCase();
		const kind: MediaLinkKind | null = IMAGE.includes(extension)
			? 'image'
			: VIDEO.includes(extension)
				? 'video'
				: AUDIO.includes(extension)
					? 'audio'
					: null;
		if (!kind) continue;
		const rawName = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
		let name = rawName;
		try {
			name = decodeURIComponent(rawName);
		} catch {
			// nombre raro: se usa tal cual
		}
		found.push({url, kind, name: name || url});
		if (found.length >= MAX_PER_MESSAGE) break;
	}
	return found;
}
