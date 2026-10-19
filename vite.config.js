import { defineConfig } from 'vite'

// Dev server owns port 4174 (4173 is taken on this machine). The build
// keeps flat, stable file names on purpose: the service worker precaches
// the shell by name and every deploy re-versions the cache, so hashed
// filenames would only churn the shell list for no gain.
export default defineConfig({
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
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
