# cbxm.me

A writing and interactivity playground that grows. Every piece lives in the garden at `/ander` (read it as cbxm meander), planted on a hand-placed map where its stage shows up as the size of its plant: seedling, growing, evergreen.

Astro + MDX, built to static files and served by Cloudflare Workers static assets.

## Add a piece

Make one file, `src/content/garden/<slug>.mdx`. The slug becomes the URL: `/ander/<slug>`.

```mdx
---
title: The golden angle
date: 2026-11-02
stage: growing        # seedling | growing | evergreen
x: -150               # map position in pixels from the center of the field
y: 30                 # positive y is down
description: Optional one-liner for the list, the piece header, and link previews.
---

Prose goes here.
```

The build fails if the frontmatter doesn't match this shape (`src/content.config.ts`).

**Placing it.** The map opens centered on `(0, 0)`. A plant's `x, y` is where its stem meets the ground; the drawing grows up from there and the title sits just below. Plant new pieces near the ones they talk to. The field grows to fit, so anything placed far out is still reachable by dragging.

**Giving it a toy.** Put the piece's own components in `src/pieces/<slug>/` and import them from the MDX:

```mdx
import Phyllotaxis from '../../pieces/golden-angle/Phyllotaxis.astro';

<Phyllotaxis />
```

Toys so far are vanilla custom elements in an Astro `<script>` with scoped styles (see `src/pieces/golden-angle/`). When a piece wants a framework, add that Astro integration then (`bunx astro add svelte`, etc.); Astro mixes frameworks per island.

## Develop

```sh
bun install
bun run dev        # http://localhost:4321
bun run build      # static site in dist/
bun run preview    # the built site served with Cloudflare's asset rules (404s, trailing slashes)
```

The map shows on screens 48rem and wider with JavaScript. Phones, no-JS, and screen readers get the same pieces as a plain list; on the map that list becomes the legend.

## Deploy

Hosting is a Worker with static assets only, configured by `cloudflare.config.ts` (Worker name, 404 page, clean URLs) and `wrangler.config.ts` (where the built files are). It deploys with the `cf` CLI, using the personal (`default`) profile.

```sh
bun run deploy          # build, then upload a new version
bun run deploy:check    # build and validate without uploading or credentials
```

`cf deploy` on its own won't work here: cf detects Astro and expects the `@astrojs/cloudflare` adapter, which a static site doesn't need. The scripts build with Astro, package `dist/` with `cf-wrangler build`, and deploy that with `cf deploy --prebuilt`.

The site serves `cbxm.me` and `www.cbxm.me` (the `domains` list in `cloudflare.config.ts`) and also `cbxm-me.cbxm.workers.dev`. Cloudflare manages those DNS records; a hand-made record on either name makes the deploy fail.

### CI

`.github/workflows/deploy.yml` builds and validates every pull request and deploys every push to `main`. It needs two repository secrets:

- `CLOUDFLARE_API_TOKEN`: a token from the "Edit Cloudflare Workers" template, scoped to the personal account (and the cbxm.me zone once `domains` is set).
- `CLOUDFLARE_ACCOUNT_ID`: the personal account's ID.
