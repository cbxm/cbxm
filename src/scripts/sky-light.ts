export interface SkyFix {
  /** The moment the sky shows: now, or the time asked for with `?sky=`. */
  date: Date;
  lat: number;
  lon: number;
  /** The sun's altitude in degrees. */
  alt: number;
  /** The sun's azimuth in degrees clockwise from north. */
  az: number;
}

/**
 * Lights the page for where the sun is. Sets on <html>:
 *
 * - `--sun-alt`: the sun's altitude in degrees
 * - `--sun-x`: the sun across the screen, 0 at the left edge to 1 at the right (see sky.ts for the view)
 * - `--rising`: 1 before solar noon, 0 after
 * - `--sky-clock`: seconds into the hour at first light, so drifting clouds pick up where the last page left them
 * - `data-sky`: `day`, `dawn`, `dusk`, or `night`, which starts once the sun is 4° below the horizon
 *
 * tokens.css turns these into the palette. `?sky=HH:MM` shows today at that time and `?sky=night` the
 * middle of tonight.
 *
 * Base.astro inlines this function's source in <head> so the first paint already has the right light,
 * so it must stay self-contained: no imports and no references outside its own body. Without `where`,
 * it uses the place sky.ts last saved for this time zone, or a guess at 40°N on the zone's meridian.
 * The sun comes from a low-precision solar formula, good to about 0.01°.
 */
export function lightSky(where?: { lat: number; lon: number }): SkyFix {
  const RAD = Math.PI / 180;
  const root = document.documentElement;

  if (!where) {
    try {
      const saved = JSON.parse(localStorage.getItem('sky-where') ?? 'null');
      if (saved && saved.tz === Intl.DateTimeFormat().resolvedOptions().timeZone) where = saved;
    } catch {}
  }
  if (!where) {
    const year = new Date().getFullYear();
    const standardOffset = Math.max(new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset());
    where = { lat: 40, lon: -standardOffset / 4 };
  }
  const { lat, lon } = where;

  const date = new Date();
  const asked = new URLSearchParams(location.search).get('sky') ?? '';
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(asked);
  if (hhmm) date.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0);
  else if (asked === 'night')
    date.setTime(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1) - (lon / 15) * 36e5);

  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const ecliptic = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const tilt = (23.439 - 3.6e-7 * d) * RAD;
  const ra = Math.atan2(Math.cos(tilt) * Math.sin(ecliptic), Math.cos(ecliptic));
  const dec = Math.asin(Math.sin(tilt) * Math.sin(ecliptic));
  const hourAngle = (280.46061837 + 360.98564736629 * d + lon) * RAD - ra;
  const phi = lat * RAD;
  const alt =
    Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle)) / RAD;
  const az =
    (Math.atan2(
      -Math.sin(hourAngle) * Math.cos(dec),
      Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(hourAngle),
    ) /
      RAD +
      360) %
    360;
  const rising = Math.sin(hourAngle) < 0;

  const ahead = (((az - (lat < 0 ? 0 : 180)) % 360) + 540) % 360 - 180;
  root.style.setProperty('--sun-alt', alt.toFixed(2));
  root.style.setProperty('--sun-x', Math.min(1.2, Math.max(-0.2, 0.5 + ahead / 180)).toFixed(3));
  root.style.setProperty('--rising', rising ? '1' : '0');
  if (!root.style.getPropertyValue('--sky-clock'))
    root.style.setProperty('--sky-clock', String(Math.round(Date.now() / 1000) % 3600));
  root.dataset.sky = alt < -4 ? 'night' : alt < 8 ? (rising ? 'dawn' : 'dusk') : 'day';

  return { date, lat, lon, alt, az };
}
