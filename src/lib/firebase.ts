import {type FirebaseApp, initializeApp} from 'firebase/app';
import {type Firestore, getFirestore} from 'firebase/firestore';
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
		db = getFirestore(app);
	}
	return db;
}
