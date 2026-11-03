// Builds src/lib/tz-coords.json: IANA time zone name → [latitude, longitude] of its
// principal city, so the sky can place a viewer from the browser's time zone alone.
//
// Run once, by hand, with files from the tz database (https://data.iana.org/time-zones/tzdb/):
//
//   bun scripts/tz-coords.mjs <zone1970.tab> <zone.tab> <backward>
//
// zone1970.tab is the primary source. zone.tab adds zones that zone1970.tab folds into
// another country's (Europe/Oslo has its own city there), and backward adds the old names
// browsers still report (Asia/Calcutta) at their target's coordinates.

import { readFileSync, writeFileSync } from 'node:fs';

const [zone1970Path, zonePath, backwardPath] = process.argv.slice(2);
if (!backwardPath) {
  console.error('usage: bun scripts/tz-coords.mjs <zone1970.tab> <zone.tab> <backward>');
  process.exit(1);
}

/** ISO 6709 ±DDMM[SS]±DDDMM[SS] → [lat, lon] in degrees, to 0.1°. */
function parseCoords(iso) {
  const m = /^([+-]\d{4}(?:\d{2})?)([+-]\d{5}(?:\d{2})?)$/.exec(iso);
  if (!m) throw new Error(`bad coordinates: ${iso}`);
  const angle = (s, degDigits) => {
    const sign = s[0] === '-' ? -1 : 1;
    const d = Number(s.slice(1, 1 + degDigits));
    const min = Number(s.slice(1 + degDigits, 3 + degDigits));
    const sec = Number(s.slice(3 + degDigits) || 0);
    return Math.round(sign * (d + min / 60 + sec / 3600) * 10) / 10;
  };
  return [angle(m[1], 2), angle(m[2], 3)];
}

const rows = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'));

const coords = new Map();

for (const [, iso, zone] of rows(zone1970Path)) coords.set(zone, parseCoords(iso));
for (const [, iso, zone] of rows(zonePath)) if (!coords.has(zone)) coords.set(zone, parseCoords(iso));

const links = readFileSync(backwardPath, 'utf8')
  .split('\n')
  .map((line) => line.replace(/#.*/, '').trim().split(/\s+/))
  .filter((f) => f[0] === 'Link')
  .map(([, target, name]) => [target, name]);

// Links can chain, so resolve until nothing new lands.
for (let added = true; added; ) {
  added = false;
  for (const [target, name] of links) {
    if (!coords.has(name) && coords.has(target)) {
      coords.set(name, coords.get(target));
      added = true;
    }
  }
}

const out = Object.fromEntries([...coords].sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(new URL('../src/lib/tz-coords.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`tz-coords.json: ${coords.size} zones`);
