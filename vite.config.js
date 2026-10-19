import { defineConfig } from 'vite'

// Dev server owns port 4174 (4173 is taken on this machine). The build
// keeps flat, stable file names on purpose: the service worker precaches
// the shell by name and every deploy re-versions the cache, so hashed
// filenames would only churn the shell list for no gain.
// base './' keeps asset URLs relative: Pages serves this game from the
// /neon-groundss/ subpath, where absolute /index.js-style URLs 404.
export default defineConfig({
  base: './',
  server: {
    port: 4174,
    strictPort: true,
  },
  preview: {
    port: 4175,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Landing page at /, game at /play/. The landing is dependency-free
      // (inline script + shots), so the game bundle stays exactly one chunk.
      input: {
        main: 'index.html',
        play: 'play/index.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
