// GPS works without internet. We keep the last fix so an emergency can still
// report a location if the GPS is slow to lock.
const KEY = 'lastLocation';

export function lastKnownLocation() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function getLocation({ timeout = 10000, maxAge = 60000 } = {}) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(lastKnownLocation());
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: Date.now(), source: 'gps' };
        try {
          localStorage.setItem(KEY, JSON.stringify(loc));
        } catch {
          /* ignore */
        }
        resolve(loc);
      },
      () => {
        const last = lastKnownLocation();
        resolve(last ? { ...last, source: 'last_known' } : null);
      },
      { enableHighAccuracy: true, timeout, maximumAge: maxAge },
    );
  });
}
