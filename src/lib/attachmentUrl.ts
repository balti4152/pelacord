import type {Attachment, Member} from '@/types';

/**
 * De dónde se baja un adjunto.
 *
 * Los archivos viven en la máquina del que los mandó, así que la URL sale de combinar:
 * - lo que quedó guardado en el mensaje (host:puerto de cuando se mandó), y
 * - lo que ese peer informa AHORA en su presencia (puede haber cambiado de puerto o de IP).
 *
 * Dos cuidados que costaron un bug real:
 * 1. Un puerto 0 NO es válido: `getFileEndpoint()` puede devolver 0 si el servidor de archivos
 *    todavía no terminó de escuchar. Si se usa igual, la URL queda sin puerto, el `<img>` falla y
 *    el adjunto se muestra como "descargar" en vez de verse.
 * 2. Para los mensajes RECIBIDOS, `attachment.url` viene vacío a propósito (no se manda el link del
 *    que lo subió). Así que si no hay host/puerto, no hay URL: hay que caer al respaldo.
 */
export function attachmentFileUrl(attachment: Attachment, members: Member[]): string {
	const dueno = attachment.ownerId ? members.find((member) => member.id === attachment.ownerId) : undefined;
	const host = dueno?.fileHost || attachment.ownerHost;
	const port = dueno?.filePort && dueno.filePort > 0 ? dueno.filePort : attachment.ownerPort;
	if (host && port && port > 0) return `http://${host}:${port}/file/${attachment.id}`;
	return attachment.url;
}
