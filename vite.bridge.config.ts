import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: 'oxc',
    lib: {
      entry: 'src/bridge/main.ts',
      formats: ['iife'],
      name: 'DshWebuiStudioBridge',
      fileName: () => 'bridge.js',
    },
  },
})
