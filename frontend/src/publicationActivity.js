const active = new Set();
const listeners = new Set();

export const isPublishing = () => active.size > 0;
export const subscribePublishing = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function beginPublication() {
  const token = Symbol('publication');
  active.add(token);
  listeners.forEach((listener) => listener());
  return () => {
    if (active.delete(token)) listeners.forEach((listener) => listener());
  };
}
