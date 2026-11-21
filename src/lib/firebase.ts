import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, serverTimestamp, type Firestore, type Timestamp } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyDVWr39GUNMF6d5ytjc7gH9XshS2LbP3vc',
  authDomain: 'edd2-58582.firebaseapp.com',
  projectId: 'edd2-58582',
  storageBucket: 'edd2-58582.firebasestorage.app',
  messagingSenderId: '9804174722',
  appId: '1:9804174722:web:528d298ce333316cbeab9b',
  measurementId: 'G-BQCF64RTVY',
};

const app: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export { serverTimestamp };

export function createSecondaryFirebaseAuth() {
  const secondaryApp = initializeApp(firebaseConfig, `Secondary_${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  return {
    secondaryAuth,
    cleanup: async () => {
      await secondaryAuth.signOut().catch(() => {});
      await deleteApp(secondaryApp).catch(() => {});
    },
  };
}

export function toJsDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    const d = (value as Timestamp).toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
