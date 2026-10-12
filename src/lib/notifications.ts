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

/** Muestra una notificación nativa de Windows. */
export function showNotification(payload: {title: string; body: string; channelId?: string}): void {
	getDesktopTransport()?.notify(payload);
}

/** Avisa a la interfaz cuando el usuario hace click en una notificación. */
export function subscribeNotificationClick(callback: (channelId?: string) => void): () => void {
	const transport = getDesktopTransport();
	if (!transport) return () => {};
	return transport.onNotificationClick((message) => callback(message?.channelId));
}
