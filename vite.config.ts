import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about.html'),
        contact: resolve(__dirname, 'contact.html'),
        donate: resolve(__dirname, 'donate.html'),
        volunteer: resolve(__dirname, 'volunteer.html'),
        projects: resolve(__dirname, 'projects.html'),
        events: resolve(__dirname, 'events.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
        accessibility: resolve(__dirname, 'accessibility.html'),
        sitemap: resolve(__dirname, 'sitemap-page.html'),
        '404': resolve(__dirname, '404.html'),
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  server: {
    port: 8080,
    open: true,
  },
});
