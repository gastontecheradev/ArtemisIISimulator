import { Locale, getLocale } from './i18n';

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/**
 * Time span in words, as the tutorial and the guides write it: "7 s", "6.36 s" (with the language's
 * decimal mark, up to two decimals), "2 min 8 s", "10 min", "3 h 23 min" (from an hour on, to the
 * nearest minute).
 */
export function formatSpan(t: number, locale: Locale = getLocale()): string {
  const a = Math.abs(t);
  if (a >= 3600) {
    const total = Math.round(a / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }
  const whole = Math.round(a);
  if (a >= 60 || Math.abs(a - whole) < 1e-6) {
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    if (m === 0) return `${s} s`;
    return s > 0 ? `${m} min ${s} s` : `${m} min`;
  }
  const text = String(Number(a.toFixed(2)));
  return `${locale === 'es' ? text.replace('.', ',') : text} s`;
}

/** Time before liftoff in words: "T‑10 min", "T‑33 s", "T‑6.36 s", "T‑0" (non-breaking hyphen, as in the texts). */
export const formatTMinus = (t: number, locale: Locale = getLocale()): string => (t === 0 ? 'T‑0' : `T‑${formatSpan(t, locale)}`);

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
