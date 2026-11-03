import { zones, zonesVersion } from '../lib/zones';
import { placeViewer } from '../scripts/sky-light';

/** /sky-zones.js: the time zone table, which Base.astro's <head> loads only until the browser has saved its place. */
export function GET() {
  return new Response(`(${placeViewer})(${JSON.stringify(zones)}, ${JSON.stringify(zonesVersion)});\n`, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
}
