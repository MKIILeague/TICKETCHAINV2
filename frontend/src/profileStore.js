import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

// Shared, cached user-profile lookups.
//
// Stored in Firestore as `profiles/{walletAddress}` (lowercased) — the same
// pattern as `organisers/{walletAddress}` (see orgStatus.js). A profile holds
// the user-entered { name, birthday } so the app can show a friendly name
// instead of a raw 0x… address. Email is NOT stored here — it comes straight
// from Privy (user.email.address) and is always live.
//
// Like orgStatus.js this provides:
//   • a cache so a name can render synchronously (no navbar flicker),
//   • in-flight de-duplication so concurrent callers share ONE read, and
//   • a timeout so a stalled Firestore connection can't hang forever.

const cache = new Map();    // key -> { name, birthday } | null
const inFlight = new Map(); // key -> Promise<{ name, birthday } | null>

const key = (address) => (address || '').toLowerCase();

// Synchronous read of the last known profile (may be stale).
// Returns the profile object, null (known-empty), or undefined (never fetched).
export function getCachedProfile(address) {
  return cache.get(key(address));
}

// Always performs a fresh read (deduped across concurrent callers) and updates
// the cache. Rejects on timeout/error WITHOUT caching, so the next call retries.
export function fetchProfile(address) {
  const k = key(address);
  if (!k) return Promise.resolve(null);
  if (inFlight.has(k)) return inFlight.get(k);

  const promise = (async () => {
    try {
      const snap = await Promise.race([
        getDoc(doc(db, 'profiles', k)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      const result = snap.exists()
        ? { name: snap.data().name || '', birthday: snap.data().birthday || '' }
        : null;
      cache.set(k, result);
      return result;
    } finally {
      inFlight.delete(k);
    }
  })();

  inFlight.set(k, promise);
  return promise;
}

// Writes { name, birthday } to `profiles/{address}` (merge) and updates the
// cache so the next render reflects it without a round-trip.
export async function saveProfile(address, { name, birthday }) {
  const k = key(address);
  if (!k) throw new Error('No wallet address');
  const data = {
    name: (name || '').trim(),
    birthday: birthday || '',
    updatedAt: Date.now(),
  };
  await setDoc(doc(db, 'profiles', k), data, { merge: true });
  cache.set(k, { name: data.name, birthday: data.birthday });
  return cache.get(k);
}
