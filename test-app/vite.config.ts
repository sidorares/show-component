import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Sourcemap mode can be overridden via VITE_SOURCEMAP env var:
//   "linked"  → build.sourcemap: true       (external .map files)
//   "hidden"  → build.sourcemap: 'hidden'   (maps generated, no comment in bundle)
//   default   → build.sourcemap: 'inline'   (base64 inlined in bundle)
const sourcemapMode = process.env.VITE_SOURCEMAP;
const buildSourcemap =
  sourcemapMode === 'linked' ? true :
  sourcemapMode === 'hidden' ? 'hidden' as const :
  'inline' as const;

const parentSrc = path.resolve(__dirname, '../src');

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Point to the library source so we can test against live code
      // without requiring a build step in the parent package.
      'show-component': parentSrc,
    },
    // Ensure that packages imported by parent source files resolve to
    // the test-app's node_modules (since the parent files live outside
    // this project root, Vite wouldn't check here by default).
    dedupe: [
      'react',
      'react-dom',
      '@jridgewell/source-map',
      '@radix-ui/react-popover',
      '@radix-ui/react-slot',
      '@uiw/react-json-view',
      'class-variance-authority',
      'clsx',
      'convert-source-map',
      'tailwind-merge',
      'lucide-react',
    ],
  },

  // Tell the dep optimizer to look at the parent source as well
  optimizeDeps: {
    include: [
      '@jridgewell/source-map',
      '@radix-ui/react-popover',
      '@radix-ui/react-slot',
      '@uiw/react-json-view',
      'class-variance-authority',
      'clsx',
      'convert-source-map',
      'tailwind-merge',
      'lucide-react',
    ],
  },

  server: {
    port: 5199,
    fs: {
      // Allow Vite to serve files from the parent directory (the library source)
      allow: ['..'],
    },
  },

  build: {
    sourcemap: buildSourcemap,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'multi-root': path.resolve(__dirname, 'multi-root.html'),
      },
    },
  },
});
