import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

// Shared, cached organiser-status lookups.
//
// Both the route guard (useTicketWallet) and the organiser dashboard read the
// same `organisers/{walletAddress}` record. Without sharing, each of them
// (re)fetches on every navigation, and because the two reads settle at slightly
// different times the dashboard briefly sees "not approved" and bounces to
// /organizer/login and back — the "refreshing glitch".
//
// This module fixes that with:
//   • a cache so a status can be rendered synchronously (no spinner flicker),
//   • in-flight de-duplication so concurrent callers share ONE network read and
//     resolve at the same instant (no dashboard↔login ping-pong), and
//   • stale-while-revalidate: callers seed from cache, then await a fresh read
//     so an admin approval that happened elsewhere still shows up.
//
// Canonical statuses: "unregistered" | "pending" | "approved" | "rejected".

const cache = new Map();    // key -> { status, data }
const inFlight = new Map(); // key -> Promise<{ status, data }>

const key = (address) => (address || '').toLowerCase();

// Synchronous read of the last known status (may be stale). undefined if unseen.
export function getCachedOrgStatus(address) {
  return cache.get(key(address));
}

// Update the cache locally (e.g. right after a registration write succeeds) so
// the next render reflects it without waiting for a round-trip.
export function setOrgStatusCache(address, status, data = null) {
  const k = key(address);
  if (k) cache.set(k, { status, data });
}

// Always performs a fresh read (deduped across concurrent callers) and updates
// the cache. Rejects on timeout/error WITHOUT caching, so the next call retries.
export function fetchOrgStatus(address) {
  const k = key(address);
  if (!k) return Promise.resolve({ status: 'unregistered', data: null });
  if (inFlight.has(k)) return inFlight.get(k);

  const promise = (async () => {
    try {
      // Race the read against a timeout so a stalled Firestore connection can't
      // hang the guard / dashboard forever.
      const snap = await Promise.race([
        getDoc(doc(db, 'organisers', address)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      const result = snap.exists()
        ? { status: snap.data().status || 'pending', data: snap.data() }
        : { status: 'unregistered', data: null };
      cache.set(k, result);
      return result;
    } finally {
      inFlight.delete(k);
    }
  })();

  inFlight.set(k, promise);
  return promise;
}
