import {type FirebaseApp, initializeApp} from 'firebase/app';
import {type Firestore, initializeFirestore} from 'firebase/firestore';
import {firebaseConfig} from '@/lib/firebaseConfig';

export function isRemoteEnabled(): boolean {
	return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function getDb(): Firestore | null {
	if (!isRemoteEnabled()) return null;
	if (!db) {
		app = initializeApp(firebaseConfig);
		// Los adjuntos no siempre tienen todos los campos (miniatura, host, etc.).
		// Sin esto, Firestore rechaza el documento entero con "Unsupported field value: undefined"
		// y el mensaje con adjunto nunca se guarda.
		db = initializeFirestore(app, {ignoreUndefinedProperties: true});
	}
	return db;
}
