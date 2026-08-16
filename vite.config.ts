import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    cssCodeSplit: false,
    emptyOutDir: true,
    minify: 'oxc',
    lib: {
      entry: 'src/browser/main.tsx',
      formats: ['es'],
      fileName: () => 'studio.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: asset => asset.name?.endsWith('.css') ? 'studio.css' : '[name][extname]',
        codeSplitting: false,
      },
    },
  },
})
