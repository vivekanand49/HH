// navigator.onLine only says "some network exists". A small /api/health ping
// tells us whether the server is actually reachable (captive Wi-Fi, 2G drops).
import { store, setOnline } from '../store';

async function ping() {
  if (!navigator.onLine) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkNetwork() {
  const ok = await ping();
  if (store.getState().network.online !== ok) store.dispatch(setOnline(ok));
  return ok;
}

export function watchNetwork(onBackOnline) {
  const handle = async () => {
    const was = store.getState().network.online;
    const now = await checkNetwork();
    if (now && !was) onBackOnline?.();
  };
  window.addEventListener('online', handle);
  window.addEventListener('offline', handle);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && handle());
  const timer = setInterval(handle, 30000);
  handle();
  return () => {
    window.removeEventListener('online', handle);
    window.removeEventListener('offline', handle);
    clearInterval(timer);
  };
}
