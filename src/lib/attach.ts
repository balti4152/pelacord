/** Evento global para adjuntar archivos al chat (arrastrar y soltar en cualquier lado). */
const listeners = new Set<(files: File[]) => void>();

export function attachFiles(files: File[]): void {
	for (const listener of [...listeners]) listener(files);
}

export function subscribeAttach(callback: (files: File[]) => void): () => void {
	listeners.add(callback);
	return () => {
		listeners.delete(callback);
	};
}
