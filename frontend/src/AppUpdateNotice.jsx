import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { applyAppUpdate } from './appUpdate';
import { isPublishing, subscribePublishing } from './publicationActivity';

export default function AppUpdateNotice() {
  const [registration, setRegistration] = useState(null);
  const [activatedUpdate, setActivatedUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const updateInProgress = useRef(false);
  const publishing = useSyncExternalStore(subscribePublishing, isPublishing, () => false);
  const { needRefresh: [needRefresh, setNeedRefresh] } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, value) { setRegistration(value || null); },
    onNeedReload() {
      // Activation alone never reloads a tab. The user's update action owns
      // the activation listeners and checks publication activity before reload.
      setActivatedUpdate(true);
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
    if (updateInProgress.current || isPublishing()) return;
    updateInProgress.current = true;
    setUpdating(true); setError('');
    try {
      await applyAppUpdate({ registration, serviceWorker: navigator.serviceWorker,
        reload: () => window.location.reload(), isBusy: isPublishing });
    } catch (value) {
      setError(value.message || 'Could not update yet. Check your connection and try again.');
      console.warn('App update failed:', value);
      setUpdating(false);
    } finally { updateInProgress.current = false; }
  };

  if (!needRefresh && !activatedUpdate) return null;
  return (
    <aside role="status" aria-live="polite" className="fixed bottom-4 left-4 right-4 z-50 max-w-md rounded-2xl border border-indigo-200 bg-white p-5 text-slate-900 shadow-xl sm:right-auto">
      <p className="text-sm font-semibold">A newer version of TicketChain is ready</p>
      <p className="mt-1 text-sm text-slate-600">{publishing ? 'Ticket publishing is in progress. Finish or stop after the current batch, then update.' : 'Finish any wallet confirmation and save your draft, then update the app.'}</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      <button onClick={update} disabled={updating || publishing} className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {publishing ? 'Finish publishing to update' : updating ? 'Updating...' : 'Update app'}
      </button>
    </aside>
  );
}
