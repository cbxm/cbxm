// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://cbxm.me',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [mdx()],
});
