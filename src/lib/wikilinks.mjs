import { existsSync, readFileSync } from 'node:fs';

/** Turns a piece title into its filename and URL slug: "-isms" → "isms", "isn't" → "isnt". */
export const slugify = (/** @type {string} */ title) =>
  title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const WIKILINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
/** Fenced blocks and inline code, where `[[...]]` is literal text rather than a link. */
const CODE = /^(```|~~~)[\s\S]*?^\1|`[^`\n]*`/gm;

const isDraft = (/** @type {string} */ source) => /^draft:\s*true\s*$/m.test(source.split(/^---\s*$/m)[1] ?? '');

/**
 * Sätteri plugin: with `features.wikilinks` on, `[[a piece title]]` parses as a link whose url is the raw
 * target. Points those links at `/ander/<slug>`. Only urls that appear as a `[[...]]` target outside code
 * are touched, so ordinary relative links pass through. A `#heading` part is dropped: Astro's heading ids
 * don't follow `slugify`, so the link goes to the top of the piece.
 *
 * Warns when the target has no piece, or when a published piece links to a draft (which the built site
 * leaves out).
 *
 * @param {{ source: string }} ctx
 */
export function wikilinks({ source }) {
  const targets = new Set([...source.replace(CODE, '').matchAll(WIKILINK)].map((m) => m[1]));
  if (targets.size === 0) return null;
  const fromDraft = isDraft(source);
  return {
    name: 'cbxm-wikilinks',
    /**
     * @param {{ url: string }} node
     * @param {{ setProperty: (node: { url: string }, key: 'url', value: string) => void }} ctx
     */
    link(node, ctx) {
      if (!targets.has(node.url)) return;
      const title = node.url.split('#')[0];
      const slug = slugify(title);
      const file = new URL(`../content/garden/${slug}.mdx`, import.meta.url);
      // Sätteri diagnostics (ctx.report) aren't surfaced by Astro, so warn directly.
      if (!existsSync(file)) {
        console.warn(`[wikilinks] [[${title}]] has no piece at src/content/garden/${slug}.mdx`);
      } else if (!fromDraft && isDraft(readFileSync(file, 'utf8'))) {
        console.warn(`[wikilinks] [[${title}]] points at a draft, which the built site leaves out`);
      }
      ctx.setProperty(node, 'url', `/ander/${slug}`);
    },
  };
}
