// Apply only after an explicit user click. If activation stalls, retire only
// this app's worker registration and navigate normally. Login, IndexedDB,
// localStorage, cached records and mint-recovery journals are never deleted.
export async function applyAppUpdate({ registration, serviceWorker, reload, isBusy = () => false, timeoutMs = 3_000 }) {
  const ensureIdle = () => {
    if (isBusy()) throw new Error('Ticket publishing is in progress. Finish or stop it before updating.');
  };
  ensureIdle();
  const current = registration || await serviceWorker?.getRegistration?.();
  ensureIdle();
  const worker = current?.waiting || current?.installing;
  if (!worker) { reload(); return; } // Already activated, or an obsolete notice.

  return new Promise((resolve, reject) => {
    let finished = false;
    let messageSent = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      serviceWorker?.removeEventListener('controllerchange', onControllerChange);
      worker.removeEventListener('statechange', onStateChange);
    };
    const fail = (error) => {
      if (finished) return;
      finished = true; cleanup(); reject(error);
    };
    const recover = async () => {
      if (finished) return;
      finished = true; cleanup();
      try {
        ensureIdle();
        if (current.unregister) await current.unregister();
        ensureIdle();
        reload(); resolve();
      } catch (error) { reject(error); }
    };
    const complete = () => {
      if (finished) return;
      try { ensureIdle(); } catch (error) { fail(error); return; }
      finished = true; cleanup();
      try { reload(); resolve(); } catch (error) { reject(error); }
    };
    const onControllerChange = () => { complete(); };
    const onStateChange = () => {
      if (worker.state === 'activated') { complete(); return; }
      if (worker.state === 'redundant') { void recover(); return; }
      if (worker.state === 'installed' && !messageSent) {
        messageSent = true;
        try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch { void recover(); }
      }
    };
    // Listen BEFORE sending the message so even immediate activation is caught.
    serviceWorker?.addEventListener('controllerchange', onControllerChange);
    worker.addEventListener('statechange', onStateChange);
    timer = setTimeout(() => { void recover(); }, timeoutMs);
    onStateChange();
  });
}
