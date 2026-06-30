import { useState, useEffect, useCallback } from 'react';
import { fetchProfile, getCachedProfile, saveProfile } from './profileStore';

// Hook around the cached profile store (profile.js).
// Seeds synchronously from cache (no flicker), revalidates in the background,
// and exposes a `save` that updates Firestore + local state together.
//
//   displayName — best human label for this wallet: the saved name, else the
//                 short 0x… address, else "Guest". Use it in the navbar/chrome.
export function useProfile(address) {
  const seed = getCachedProfile(address);
  const [profile, setProfile] = useState(seed ?? null);
  // Only "loading" when we have never fetched this address (undefined cache).
  const [loading, setLoading] = useState(seed === undefined && !!address);

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const cached = getCachedProfile(address);
    if (cached !== undefined) {
      setProfile(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    (async () => {
      try {
        const fresh = await fetchProfile(address);
        if (!cancelled) setProfile(fresh);
      } catch (e) {
        // Transient read failure — keep whatever we had; don't strand the UI.
        if (!cancelled) console.warn('[profile] read failed:', e?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [address]);

  const save = useCallback(
    async (data) => {
      const saved = await saveProfile(address, data);
      setProfile(saved);
      return saved;
    },
    [address]
  );

  const shortAddress = address
    ? `${address.substring(0, 6)}…${address.substring(38)}`
    : '';
  const displayName = (profile?.name && profile.name.trim()) || shortAddress || 'Guest';

  return { profile, displayName, shortAddress, loading, save };
}
