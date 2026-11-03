import { useState, useEffect, useCallback } from 'react';
import { fetchProfile, getCachedProfile, saveProfile } from './profileStore';

export function useProfile(address) {
  const [state, setState] = useState(null);
  const cached = getCachedProfile(address);
  const profile = !address ? null : state?.address === address ? state.profile : cached ?? null;
  const loading = !!address && state?.address !== address && cached === undefined;

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    (async () => {
      let fresh = getCachedProfile(address) ?? null;
      try { fresh = await fetchProfile(address); }
      catch (error) { console.warn('[profile] read failed:', error.message); }
      if (!cancelled) setState({ address, profile: fresh });
    })();
    return () => { cancelled = true; };
  }, [address]);

  const save = useCallback(async (data) => {
    const saved = await saveProfile(address, data);
    setState({ address, profile: saved });
    return saved;
  }, [address]);
  const shortAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
  const displayName = profile?.name?.trim() || shortAddress || 'Guest';
  return { profile, displayName, shortAddress, loading, save };
}
