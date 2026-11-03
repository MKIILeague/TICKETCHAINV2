export function formatEventWindow(unixSec) {
  if (!unixSec) return 'Date to be announced';
  const d = new Date(unixSec * 1000);
  const date = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
}
