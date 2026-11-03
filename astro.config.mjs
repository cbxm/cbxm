// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { satteri } from '@astrojs/markdown-satteri';
import { wikilinks } from './src/lib/wikilinks.mjs';

export default defineConfig({
  site: 'https://cbxm.me',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [mdx()],
  markdown: {
    processor: satteri({ features: { wikilinks: true }, mdastPlugins: [wikilinks] }),
  },
});
