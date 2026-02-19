import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // Second entry so ESM code-splitting places the dev-only component
    // (and its transitive deps) in a separate chunk that the consumer's
    // bundler can drop entirely in production.
    ShowComponent: 'src/react/ShowComponent.tsx',
  },
  format: ['cjs', 'esm'],
  dts: true,
  // Enables chunk-level code-splitting for ESM (CJS ignores this).
  splitting: true,
  sourcemap: true,
  clean: true,
  target: 'es2015',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  jsx: 'automatic',
});
