// Apply only after an explicit user click. Workbox's reload callback can be
// missed when a waiting worker was found manually or activated by another tab.
export async function applyAppUpdate({ registration, serviceWorker, reload, isBusy = () => false, timeoutMs = 10_000 }) {
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
    const complete = () => {
      if (finished) return;
      try { ensureIdle(); } catch (error) { fail(error); return; }
      finished = true; cleanup();
      try { reload(); resolve(); } catch (error) { reject(error); }
    };
    const onControllerChange = () => { complete(); };
    const onStateChange = () => {
      if (worker.state === 'activated') { complete(); return; }
      if (worker.state === 'redundant') { fail(new Error('The update was replaced. Try Update app again.')); return; }
      if (worker.state === 'installed' && !messageSent) {
        messageSent = true;
        try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (error) { fail(error); }
      }
    };
    // Listen BEFORE sending the message so even immediate activation is caught.
    serviceWorker?.addEventListener('controllerchange', onControllerChange);
    worker.addEventListener('statechange', onStateChange);
    timer = setTimeout(() => fail(new Error('The update is taking longer than expected. Check your connection and try again.')), timeoutMs);
    onStateChange();
  });
}
