import {getDesktopTransport} from '@/lib/desktop';

/**
 * Dibuja el globito rojo (con número) que Windows muestra sobre el ícono de la barra de
 * tareas. Se dibuja acá, en el renderer, porque es donde hay canvas.
 */
export function drawBadge(count: number): string {
	const size = 32;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d');
	if (!context) return '';
	context.beginPath();
	context.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
	context.fillStyle = '#f23f43';
	context.fill();
	const label = count > 9 ? '9+' : String(count);
	context.fillStyle = '#ffffff';
	context.font = `bold ${label.length > 1 ? 15 : 19}px "Segoe UI", sans-serif`;
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.fillText(label, size / 2, size / 2 + 1);
	return canvas.toDataURL('image/png');
}

/** Pone (o saca) el puntito rojo con el total de mensajes sin leer. */
export function setTaskbarBadge(count: number): void {
	const transport = getDesktopTransport();
	if (!transport) return;
	if (count <= 0) {
		transport.setBadge({});
		return;
	}
	transport.setBadge({
		dataUrl: drawBadge(count),
		description: count === 1 ? '1 mensaje sin leer' : `${count} mensajes sin leer`,
	});
}

/**
 * Convierte la foto de perfil en un PNG chico (data URL) para el ícono de la notificación.
 *
 * Se hace acá y no en el proceso principal porque `nativeImage` sólo decodifica PNG/JPEG: si el
 * avatar es un GIF, allá fallaba y Windows mostraba el ícono de Pelacord. Con un canvas sirve
 * cualquier formato (de un GIF se toma el primer cuadro). El servidor P2P manda
 * `Access-Control-Allow-Origin: *`, así que el canvas no queda "manchado".
 */
export async function avatarIconDataUrl(url?: string): Promise<string | null> {
	if (!url) return null;
	try {
		const image = await new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('no carga'));
			img.src = url;
		});
		const size = 128;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const context = canvas.getContext('2d');
		if (!context) return null;
		// Recorte cuadrado centrado (los avatares son cuadrados, pero por las dudas).
		const side = Math.max(1, Math.min(image.width, image.height));
		context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
		return canvas.toDataURL('image/png');
	} catch {
		return null;
	}
}

/** Muestra una notificación nativa de Windows. `iconUrl` es la foto de quien escribió. */
export function showNotification(payload: {
	title: string;
	body: string;
	channelId?: string;
	iconUrl?: string;
	iconDataUrl?: string;
}): void {
	getDesktopTransport()?.notify(payload);
}

/** Avisa a la interfaz cuando el usuario hace click en una notificación. */
export function subscribeNotificationClick(callback: (channelId?: string) => void): () => void {
	const transport = getDesktopTransport();
	if (!transport) return () => {};
	return transport.onNotificationClick((message) => callback(message?.channelId));
}
