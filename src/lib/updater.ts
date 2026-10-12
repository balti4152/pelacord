import {useEffect, useState} from 'react';
import {getDesktopTransport} from '@/lib/desktop';

export interface UpdateStatus {
	state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error';
	percent?: number;
	version?: string;
	error?: string;
}

let current: UpdateStatus = {state: 'idle'};
const listeners = new Set<() => void>();

export function getUpdateStatus(): UpdateStatus {
	return current;
}

export function setUpdateStatus(status: UpdateStatus): void {
	current = status;
	for (const listener of listeners) listener();
}

export function subscribeUpdate(callback: () => void): () => void {
	listeners.add(callback);
	return () => {
		listeners.delete(callback);
	};
}

/** Conecta el estado de actualizaciones con el proceso principal. */
export function initUpdater(): void {
	const transport = getDesktopTransport();
	if (!transport) return;
	transport.onUpdateStatus((status) => setUpdateStatus(status as UpdateStatus));
}

export function checkUpdates(): void {
	void getDesktopTransport()?.checkUpdate();
}

export function installUpdate(): void {
	void getDesktopTransport()?.installUpdate();
}

export function useUpdater(): UpdateStatus {
	const [status, setStatus] = useState<UpdateStatus>(getUpdateStatus());
	useEffect(() => subscribeUpdate(() => setStatus(getUpdateStatus())), []);
	return status;
}
