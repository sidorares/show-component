import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      'content/main-world': 'src/content/main-world.ts',
      'content/bridge': 'src/content/bridge.ts',
      'background/service-worker': 'src/background/service-worker.ts',
    },
    format: ['iife'],
    outExtension: () => ({ js: '.js' }),
    splitting: false,
    sourcemap: false,
    target: 'chrome120',
    noExternal: [/.*/],
    outDir: 'dist',
    esbuildOptions(options) {
      options.alias = { '@core': '../src/core' };
    },
  },
  {
    entry: {
      'popup/popup': 'src/popup/Popup.tsx',
      'options/options': 'src/options/Options.tsx',
    },
    format: ['esm'],
    outExtension: () => ({ js: '.js' }),
    splitting: false,
    sourcemap: false,
    target: 'chrome120',
    jsx: 'automatic',
    noExternal: [/.*/],
    outDir: 'dist',
  },
]);
