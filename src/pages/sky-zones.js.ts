import zones from '../lib/tz-coords.json';
import { placeViewer } from '../scripts/sky-light';

/** /sky-zones.js: the time zone table, which Base.astro's <head> loads only until the browser has saved its place. */
export function GET() {
  return new Response(`(${placeViewer})(${JSON.stringify(zones)});\n`, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
}
