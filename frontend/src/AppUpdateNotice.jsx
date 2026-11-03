import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function AppUpdateNotice() {
  const [registration, setRegistration] = useState(null);
  const [activatedUpdate, setActivatedUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const reloadRequested = useRef(false);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, value) { setRegistration(value || null); },
    onNeedReload() {
      // Updating another tab must not reload this tab during a wallet request.
      if (reloadRequested.current) window.location.reload();
      else setActivatedUpdate(true);
    },
    onRegisterError(value) { console.warn('App update registration failed:', value); },
  });

  useEffect(() => {
    if (!registration) return;
    let checking = false;
    let lastChecked = 0;
    let disposed = false;
    const check = async () => {
      if (checking || document.visibilityState === 'hidden' || navigator.onLine === false || Date.now() - lastChecked < 60_000) return;
      checking = true;
      lastChecked = Date.now();
      try {
        await registration.update();
        if (!disposed && registration.waiting) setNeedRefresh(true);
      } catch (value) { console.warn('App update check failed:', value); }
      finally { checking = false; }
    };
    const onFocus = () => { void check(); };
    const timer = window.setInterval(onFocus, 60_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    void check();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [registration, setNeedRefresh]);

  const update = async () => {
    setUpdating(true); setError(''); reloadRequested.current = true;
    try {
      if (activatedUpdate) window.location.reload();
      else await updateServiceWorker(true);
    } catch (value) {
      reloadRequested.current = false;
      setError('Could not update yet. Check your connection and try again.');
      console.warn('App update failed:', value);
    } finally { setUpdating(false); }
  };

  if (!needRefresh && !activatedUpdate) return null;
  return (
    <aside role="status" aria-live="polite" className="fixed bottom-4 left-4 right-4 z-50 max-w-md rounded-2xl border border-indigo-200 bg-white p-5 text-slate-900 shadow-xl sm:right-auto">
      <p className="text-sm font-semibold">A newer version of TicketChain is ready</p>
      <p className="mt-1 text-sm text-slate-600">Finish any wallet confirmation and save your draft, then update the app.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      <button onClick={update} disabled={updating} className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {updating ? 'Updating...' : 'Update app'}
      </button>
    </aside>
  );
}
