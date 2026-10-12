/** Evento global para abrir el selector de pantalla desde cualquier parte de la interfaz. */
const listeners = new Set<() => void>();

export function openSharePicker(): void {
	for (const listener of [...listeners]) listener();
}

export function subscribeSharePicker(callback: () => void): () => void {
	listeners.add(callback);
	return () => {
		listeners.delete(callback);
	};
}
