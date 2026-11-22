import { getLocale } from './i18n';

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/** MET in DDD/HH:MM:SS format (like the cockpit clock, but with mission time). Before liftoff, signed: -000/00:00:06. */
export function formatMet(t: number): string {
  const neg = t < 0;
  const s = Math.floor(Math.abs(neg ? Math.ceil(t) : t));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${neg ? '-' : ''}${pad(d, 3)}/${pad(h, 2)}:${pad(m, 2)}:${pad(s % 60, 2)}`;
}

/**
 * Countdown time relative to liftoff: T−MM:SS before (T‑0 included) and T+MM:SS after, with
 * hours when needed or asked for (`hours`: T−00:09:58, like the countdown clock). As in
 * `formatMet`, the seconds are truncated toward T‑0. With `fraction`, a time that is not a
 * whole second keeps two decimals (the RS‑25 start at T−00:06.36).
 */
export function formatCountdown(t: number, fraction = false, hours = false): string {
  const a = Math.abs(t);
  const whole = Math.floor(a + 1e-9);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const frac = a - whole;
  let sec = pad(whole % 60, 2);
  if (fraction && frac > 1e-6) sec += `${getLocale() === 'es' ? ',' : '.'}${pad(Math.round(frac * 100), 2)}`;
  const hm = h > 0 || hours ? `${pad(h, 2)}:${pad(m, 2)}` : pad(m, 2);
  return `T${t <= 0 ? '−' : '+'}${hm}:${sec}`;
}

/** Short duration: 1d 02:03:04 or 02:03:04. */
export function formatDuration(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hms = `${pad(h, 2)}:${pad(m, 2)}:${pad(s % 60, 2)}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}

/** Number with the current language's separators: "1.234,5" in Spanish, "1,234.5" in English. */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '---';
  const es = getLocale() === 'es';
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, es ? '.' : ',');
  return `${value < 0 ? '-' : ''}${grouped}${frac ? `${es ? ',' : '.'}${frac}` : ''}`;
}

/** Signed Δv in m/s. */
export const formatDvMs = (kms: number): string => {
  const ms = kms * 1000;
  return `${ms >= 0 ? '+' : '-'}${formatNumber(Math.abs(ms), 1)}`;
};
