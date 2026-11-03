import zones from './tz-coords.json';

/** The time zone table (name → [lat, lon]) that /sky-zones.js ships to the browser. */
export { zones };

const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(zones)));

/** Changes whenever the table does, so browsers look their zone up again after a deploy that changes it. */
export const zonesVersion = [...new Uint8Array(digest, 0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
