export interface Identity {
	id: string;
	name: string;
	color: string;
}

const KEY = 'pelacord.identity';

function randomId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function randomColor(): string {
	return `hsl(${Math.floor(Math.random() * 360)}, 62%, 48%)`;
}

function randomName(): string {
	return `user-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function getIdentity(): Identity {
	if (typeof localStorage === 'undefined') {
		return {id: randomId(), name: randomName(), color: randomColor()};
	}
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Identity>;
			if (parsed.id) {
				return {id: parsed.id, name: parsed.name ?? randomName(), color: parsed.color ?? randomColor()};
			}
		}
	} catch {
		// fall through to a fresh identity
	}
	const identity: Identity = {id: randomId(), name: randomName(), color: randomColor()};
	saveIdentity(identity);
	return identity;
}

export function saveIdentity(identity: Identity): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(KEY, JSON.stringify(identity));
	} catch {
		// best effort
	}
}

const NAMED_KEY = 'pelacord.named';

/** ¿El usuario ya eligió su nombre? (primer arranque). */
export function hasChosenName(): boolean {
	if (typeof localStorage === 'undefined') return true;
	return localStorage.getItem(NAMED_KEY) === '1';
}

/** Marca el nombre como elegido y lo persiste. */
export function confirmName(identity: Identity, name: string): Identity {
	const next = {...identity, name: name.trim() || identity.name};
	saveIdentity(next);
	if (typeof localStorage !== 'undefined') localStorage.setItem(NAMED_KEY, '1');
	return next;
}
