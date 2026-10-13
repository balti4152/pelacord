import {getDesktopTransport, type LinkPreviewData} from '@/lib/desktop';
import {findMediaLinks} from '@/lib/mediaLinks';

export type LinkPreview = LinkPreviewData;

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;

/** Hasta cuántos embeds por mensaje (como Discord, que no llena la pantalla de tarjetas). */
const MAX_EMBEDS = 2;

/**
 * Id del video si el link es de YouTube. Se usa para el reproductor.
 * Acepta watch?v=, youtu.be, shorts y embed.
 */
export function youtubeId(url: string): string | null {
	const match = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
	return match ? match[1] : null;
}

/**
 * Links del mensaje que merecen una tarjeta de preview.
 * Quedan afuera los que ya se muestran como media (imagen/video/audio directo).
 */
export function findPreviewLinks(content: string): string[] {
	if (!content || !content.includes('http')) return [];
	const media = new Set(findMediaLinks(content).map((link) => link.url));
	const found: string[] = [];
	for (const match of content.matchAll(URL_PATTERN)) {
		const url = match[0];
		if (media.has(url) || found.includes(url)) continue;
		found.push(url);
		if (found.length >= MAX_EMBEDS) break;
	}
	return found;
}

/** Caché en memoria: un mismo link no se pide dos veces. */
const previews = new Map<string, LinkPreview | null>();

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
	if (previews.has(url)) return previews.get(url) ?? null;
	const transport = getDesktopTransport();
	if (!transport?.getLinkPreview) return null;
	try {
		const preview = await transport.getLinkPreview(url);
		previews.set(url, preview);
		return preview;
	} catch {
		previews.set(url, null);
		return null;
	}
}
