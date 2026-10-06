export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Rough road ETA: city traffic ~30 km/h plus 2 minutes to get moving.
export function etaMinutes(km) {
  return Math.round((km / 30) * 60 + 2);
}

// Default map centre when the user has not shared location: Visakhapatnam.
export const DEFAULT_LOCATION = { lat: 17.6868, lng: 83.2185 };
