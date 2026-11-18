const key = (wallet) => `ticketchain:pending-publish:${wallet?.toLowerCase()}`;

export async function withPublicationLock(wallet, work) {
  const locks = globalThis.navigator?.locks;
  if (!locks) return work();
  return locks.request(key(wallet), { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error("Publication is active in another tab. Pause it there first.");
    return work();
  });
}

export function readPendingPublish(wallet) {
  if (!wallet) return null;
  try { return JSON.parse(localStorage.getItem(key(wallet)) || 'null'); }
  catch { return null; }
}

export function savePendingPublish(wallet, record) {
  localStorage.setItem(key(wallet), JSON.stringify(record));
}

export function clearPendingPublish(wallet) {
  localStorage.removeItem(key(wallet));
}
