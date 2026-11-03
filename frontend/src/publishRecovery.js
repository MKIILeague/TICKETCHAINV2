const key = (wallet) => `ticketchain:pending-publish:${wallet?.toLowerCase()}`;

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
