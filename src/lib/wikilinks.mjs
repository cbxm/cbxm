import { existsSync } from 'node:fs';

/** Turns a piece title into its filename and URL slug: "-isms" → "isms", "isn't" → "isnt". */
export const slugify = (/** @type {string} */ title) =>
  title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(?:\|[^\]]*)?\]\]/g;

/**
 * Sätteri plugin: with `features.wikilinks` on, `[[a piece title]]` parses as a link whose url is the raw
 * target. Points those links at `/ander/<slug>` and warns when no piece has that slug. Only urls that appear
 * as a `[[...]]` target in the source are touched, so ordinary relative links pass through.
 *
 * @param {{ source: string }} ctx
 */
export function wikilinks({ source }) {
  const targets = new Set([...source.matchAll(WIKILINK)].map((m) => m[1] + (m[2] ?? '')));
  if (targets.size === 0) return null;
  return {
    name: 'cbxm-wikilinks',
    /**
     * @param {{ url: string }} node
     * @param {{ setProperty: (node: { url: string }, key: 'url', value: string) => void }} ctx
     */
    link(node, ctx) {
      if (!targets.has(node.url)) return;
      const [title, heading] = node.url.split('#');
      const slug = slugify(title);
      if (!existsSync(new URL(`../content/garden/${slug}.mdx`, import.meta.url))) {
        // Sätteri diagnostics (ctx.report) aren't surfaced by Astro, so warn directly.
        console.warn(`[wikilinks] [[${title}]] has no piece at src/content/garden/${slug}.mdx`);
      }
      ctx.setProperty(node, 'url', `/ander/${slug}${heading ? `#${slugify(heading)}` : ''}`);
    },
  };
}
