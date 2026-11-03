/*
 * The page's light before first paint. Base.astro inlines findPlace() and lightSky() in <head>,
 * and /sky-zones.js (src/pages/sky-zones.js.ts) runs placeViewer(), so each function here must
 * stay self-contained: no imports and no references outside its own body.
 *
 * The viewer's place travels as data-place="lat lon" on <html>, and is saved in localStorage
 * under `sky-place` as { tz, v, place } so later pages skip the zone table. `v` is the table's
 * version (src/lib/zones.ts), so a deploy that changes the table looks every zone up again.
 *
 * The viewer's theme is `light` (always day), `dark` (always night), or `dynamic` (following the
 * sun), saved under `sky-theme` and carried as data-theme on <html>.
 */

export type Theme = 'light' | 'dynamic' | 'dark';

export interface SkyFix {
  /** The theme in effect: the viewer's, or `dynamic` while `?sky=` asks for a time. */
  theme: Theme;
  /** The moment the sky shows: now, or the time asked for with `?sky=`. */
  date: Date;
  lat: number;
  lon: number;
  /** The azimuth the view faces: 180 (south) when the sun crosses the meridian south of overhead that day, else 0 (north). */
  facing: number;
  /** The sun's altitude in degrees. */
  alt: number;
}

/**
 * Puts the place saved for this time zone and table `version` on <html>. Without one (a first
 * visit, a new zone, or a new table), writes in `zonesUrl` as a blocking script, so only that
 * page load pays for the table. Without working storage it does neither and lightSky()
 * guesses, rather than block every page on the table.
 */
export function findPlace(zonesUrl: string, version: string) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let raw: string | null;
  try {
    raw = localStorage.getItem('sky-place');
    if (raw === null) localStorage.setItem('sky-place', '');
  } catch {
    return;
  }
  let saved;
  try {
    saved = JSON.parse(raw || 'null');
  } catch {}
  if (saved && saved.tz === tz && saved.v === version) {
    if (saved.place) document.documentElement.dataset.place = saved.place;
    return;
  }
  document.write('<script src="' + zonesUrl + '"></script>');
}

/**
 * Looks the browser's time zone up in `zones` (name → [lat, lon] of its principal city), puts it
 * on <html>, and saves it with the table's `version`. A zone missing from the table is saved
 * without a place, and lightSky() guesses one.
 */
export function placeViewer(zones: Record<string, number[] | undefined>, version: string) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const place = zones[tz]?.join(' ');
  if (place) document.documentElement.dataset.place = place;
  try {
    localStorage.setItem('sky-place', JSON.stringify({ tz, v: version, place }));
  } catch {}
}

/**
 * Lights the page for where the sun is, at the place on <html> or a guess at 40°N on the time
 * zone's meridian. The view's facing is decided on the first call and kept as data-facing, so a
 * page left open while the sun's declination crosses the latitude doesn't mirror its sky. Sets
 * on <html>:
 *
 * - `--low`: 0 with the sun 8° up, 1 at 4° down, where night begins
 * - `--deep`: 0 with the sun 4° down, 1 at 16° down
 * - `--glow`: the warm band near the sun: in from 14° up, strongest around the horizon, gone by 16° down
 * - `--sunset`: how far the sun's disc has reddened, 0 at 20° up to 1 at the horizon
 * - `--sun-x`: the sun across the screen, 0 at the left edge to 1 at the right (see sky.ts for the view)
 * - `--rising`: 1 before solar noon, 0 after
 * - `--sky-clock`: seconds into the hour at first light, so drifting clouds pick up where the last page left them
 * - `data-sky`: `day`, `dawn`, `dusk`, or `night`
 * - `data-theme`: the saved theme, read on the first call or when `rereadTheme` asks
 * - `data-sky-preview`: while `?sky=` asks for a time
 *
 * and sets <meta name="theme-color">. tokens.css turns the rest into the palette. The `light`
 * theme holds the ramps at noon, with no dusk glow or reddened sun, and the `dark` theme at deep
 * night, whatever the sun is doing. `?sky=HH:MM` shows today at that time and `?sky=night` the
 * middle of tonight, both under the `dynamic` theme. The sun comes from a low-precision solar
 * formula, good to about 0.01°.
 */
export function lightSky(rereadTheme = false): SkyFix {
  const RAD = Math.PI / 180;
  const root = document.documentElement;
  const unit = (n: number) => Math.min(1, Math.max(0, n));

  let lat = 40;
  let lon: number;
  const place = root.dataset.place?.split(' ').map(Number);
  if (place) [lat, lon] = place;
  else {
    const year = new Date().getFullYear();
    const standardOffset = Math.max(new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset());
    lon = -standardOffset / 4;
  }

  if (rereadTheme || !root.dataset.theme) {
    try {
      const saved = localStorage.getItem('sky-theme');
      root.dataset.theme = saved === 'light' || saved === 'dark' ? saved : 'dynamic';
    } catch {
      root.dataset.theme ??= 'dynamic';
    }
  }

  const date = new Date();
  const asked = new URLSearchParams(location.search).get('sky') ?? '';
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(asked);
  if (hhmm) date.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0);
  else if (asked === 'night')
    date.setTime(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1) - (lon / 15) * 36e5);
  const preview = Boolean(hhmm) || asked === 'night';
  root.toggleAttribute('data-sky-preview', preview);
  const theme = (preview ? 'dynamic' : root.dataset.theme) as Theme;

  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const ecliptic = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const tilt = (23.439 - 3.6e-7 * d) * RAD;
  const ra = Math.atan2(Math.cos(tilt) * Math.sin(ecliptic), Math.cos(ecliptic));
  const dec = Math.asin(Math.sin(tilt) * Math.sin(ecliptic));
  const sidereal = (280.46061837 + 360.98564736629 * d + lon) * RAD;
  const hourAngle = sidereal - ra;
  const phi = lat * RAD;
  const alt =
    Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle)) / RAD;
  const rising = Math.sin(hourAngle) < 0;
  root.dataset.facing ??= dec / RAD < lat ? '180' : '0';
  const facing = Number(root.dataset.facing);

  // sky.ts draws the half of the ecliptic above the horizon, starting from its end with the
  // greater longitude (the rising point, except inside the polar circles at times); the sun's
  // glow sits where the sun is along that span. sky.ts moves it to match the band's real span.
  const ascendant = Math.atan2(Math.cos(sidereal), -(Math.sin(tilt) * Math.tan(phi) + Math.cos(tilt) * Math.sin(sidereal)));
  const past = ((((ascendant - ecliptic) / RAD) % 360) + 360) % 360;
  const across = (past > 270 ? past - 360 : past) / 180;
  const sunX = Math.min(1.2, Math.max(-0.2, across));

  const dynamic = theme === 'dynamic';
  const low = dynamic ? unit((8 - alt) / 12) : theme === 'dark' ? 1 : 0;
  const deep = dynamic ? unit((-4 - alt) / 12) : theme === 'dark' ? 1 : 0;
  const glow = dynamic ? unit(Math.min((14 - alt) / 14, (alt + 16) / 12)) : 0;
  root.style.setProperty('--low', low.toFixed(3));
  root.style.setProperty('--deep', deep.toFixed(3));
  root.style.setProperty('--glow', glow.toFixed(3));
  root.style.setProperty('--sunset', (theme === 'light' ? 0 : unit(1 - alt / 20)).toFixed(3));
  root.style.setProperty('--sun-x', (facing === 180 ? sunX : 1 - sunX).toFixed(3));
  root.style.setProperty('--rising', rising ? '1' : '0');
  if (!root.style.getPropertyValue('--sky-clock'))
    root.style.setProperty('--sky-clock', String(Math.round(Date.now() / 1000) % 3600));
  const night = dynamic ? alt < -4 : theme === 'dark';
  root.dataset.sky = night ? 'night' : !dynamic || alt >= 8 ? 'day' : rising ? 'dawn' : 'dusk';

  // --paper's two ends for this mode in tokens.css, mixed in sRGB.
  const [from, to, t] = night ? ['2b2b3d', '141824', deep] : ['f3ede1', 'ecd6be', low];
  const channel = (i: number) =>
    Math.round(parseInt(from.slice(i, i + 2), 16) * (1 - t) + parseInt(to.slice(i, i + 2), 16) * t)
      .toString(16)
      .padStart(2, '0');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `#${channel(0)}${channel(2)}${channel(4)}`);

  return { theme, date, lat, lon, facing, alt };
}
