# cbxm.me

Caden's personal site: a writing garden where pieces can carry bespoke interactive toys. It grows one piece at a time. Read `README.md` for how to add a piece; this file covers what isn't obvious from it.

## Spirit

- Build only what the next piece needs. No taxonomy, tags, rooms, or framework ahead of time; the old spec died of being top-heavy.
- The writing is Caden's. Never rewrite, "fix", or re-case prose. The lowercase voice is deliberate. Never invent copy, bios, or contact links; leave a visible placeholder and say so.
- Every toy is bespoke. Start in vanilla JS (a custom element in an Astro `<script>`) in `src/pieces/<slug>/`. Add a framework integration only when a piece needs one.

## Layout

- `src/content/garden/<slug>.mdx`: one file per piece, kept flat (the loader pattern is `*.mdx`, so files in subfolders are ignored).
- `src/content.config.ts`: the schema (`title, date, stage, x, y, description?, draft`). The build fails on bad frontmatter.
- `src/lib/garden.ts`: `getGarden()` is the only way pages read pieces, and it filters drafts. `pieceHref` builds URLs.
- `src/lib/wikilinks.mjs`: `slugify` and the `[[wikilink]]` plugin.
- `src/pages/ander/`: the garden. The route is `/ander` on purpose: cbxm.me/ander reads as "cbxm meander". The nav label and title stay "meander". Never rename the route to `/meander`.
- `src/components/GardenField.astro`, `Plant.astro`, `src/scripts/garden-map.ts`: the map.
- `src/styles/tokens.css`: colours, spacing, and type as custom properties. Plain CSS, no Tailwind.

## Gotchas

- **Astro 7 Markdown is Sätteri, not remark.** `markdown.remarkPlugins` errors, and `mdx({ remarkPlugins })` is silently ignored. Extend the pipeline with `satteri({ features, mdastPlugins })` in `astro.config.mjs`. Sätteri's `ctx.report` diagnostics never print, so use `console.warn`.
- **Wikilinks.** `[[title]]` becomes `/ander/<slugify(title)>`. The filename must equal `slugify(title)`. The build prints `[wikilinks]` warnings when a target has no piece or when a published piece links to a draft. Treat either as a broken link. `[[t#heading]]` links to the top of the page, because Astro's heading ids use github-slugger, not `slugify`.
- **Drafts.** `draft: true` pieces appear in `bun dev` and are absent from `bun run build`. Anything that lists pieces must go through `getGarden()`.
- **Map placement.** `x, y` is in pixels from the origin, and positive y points down. The map opens centred on (0,0), in the space to the right of the legend panel, and the landing page shows a window around (0,0). Plant a piece near the pieces it links to. The field grows to fit, so nothing is out of reach.
- **Never run `cf init` / `cf build` here.** On an Astro project they install the SSR adapter and turn the static site into a server Worker. The pipeline is `astro build` → `cf-wrangler build` → `cf deploy --prebuilt` (the `build:cf` and `deploy` scripts).
- **Cloudflare profile.** This is the personal `default` cf profile, not `x2u`.

## Develop and verify

- `bun dev` for writing (drafts visible). `bun run preview` serves the built Worker with the real asset rules: clean URLs, the 404 page, drafts hidden.
- `bun run deploy:check` builds and dry-runs the deploy without credentials. CI runs it on every PR.
- There are no unit tests, because it is all UI. Verify in a browser: the map (drag, click a plant, the list fallback at phone width), the piece page, and any toy. Run a typecheck with `bunx --package typescript --package @astrojs/check astro-check`.

## Deploy

Push to `main` and the GitHub Action deploys to the `cbxm-me` Worker, which serves `cbxm.me` and `www.cbxm.me` (Worker custom domains; Cloudflare manages those DNS records). Never edit on `main`; use a branch and a PR.
