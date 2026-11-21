import type { QuickLocation } from '../types/civicpulse';

const EARTH_RADIUS_KM = 6371.0;

/**
 * Indoor-demo viewport presets matching key Sri Lankan safety & eco-tourism regions.
 * Pure GPS camera presets — contains zero mock posts or fake alerts.
 */
export const QUICK_JUMP_LOCATIONS: QuickLocation[] = [
  { id: 'sri-lanka', label: 'All Sri Lanka', lat: 7.45, lng: 80.55, zoom: 8 },
  { id: 'gampaha', label: 'Gampaha', lat: 7.0873, lng: 79.999, zoom: 12 },
  { id: 'ella', label: 'Ella', lat: 6.8667, lng: 81.0466, zoom: 13 },
  { id: 'nuwara-eliya', label: 'Nuwara Eliya', lat: 6.9497, lng: 80.7891, zoom: 12 },
  { id: 'galle', label: 'Galle', lat: 6.0267, lng: 80.217, zoom: 12 },
];

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

export function formatDistanceKm(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} m away`;
  }
  return `${km.toFixed(1)} km away`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelativeTime(isoString: string): string {
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return isoString;

  const diffSeconds = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);

  if (abs < 60) return rtf.format(diffSeconds, 'second');
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}
