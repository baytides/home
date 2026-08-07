// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// Pages that should never appear in the XML sitemap: transactional steps,
// the PWA offline fallback, and the 404 page.
const SITEMAP_EXCLUDE = ['/checkout/', '/offline/', '/404/'];

// https://astro.build/config
export default defineConfig({
  site: 'https://baytides.org',
  outDir: './dist',
  publicDir: './public',

  build: {
    assets: 'assets',
  },

  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
  },

  integrations: [
    react(),
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname;
        return !SITEMAP_EXCLUDE.includes(path);
      },
      changefreq: 'monthly',
      lastmod: new Date(),
    }),
  ],
});
