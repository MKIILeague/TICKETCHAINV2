import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAoM4aMS-pFJ6suhkaL36bvtTLTBI_UHDY",
  authDomain: "ticketchain-1247c.firebaseapp.com",
  projectId: "ticketchain-1247c",
  storageBucket: "ticketchain-1247c.firebasestorage.app",
  messagingSenderId: "686116787854",
  appId: "1:686116787854:web:34db88c0ebd96794d01bdf"
};

// Reuse the existing app/firestore instance if it's already initialized
// (e.g. Vite HMR re-runs this module against the persisted singletons).
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Firestore's default WebChannel transport can stall indefinitely behind some
// networks, proxies, VPNs, or ad-blockers — which makes getDoc() hang forever
// and leaves the organizer dashboard spinning on "Checking registration...".
// Auto-detecting long-polling falls back to plain HTTP requests in those cases.
// initializeFirestore() can only be called once, so fall back to the existing
// instance if it was already set up.
let db;
try {
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
  });
} catch {
  db = getFirestore(app);
}

export { db };
