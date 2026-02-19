import { ShowComponent as ShowComponentImpl } from './react/ShowComponent';

/**
 * In production builds the dev-only component is replaced with a no-op that
 * renders nothing.  Because the import of `ShowComponentImpl` is then unused,
 * bundlers that honour `sideEffects: false` (webpack, Rollup, Vite, esbuild)
 * can tree-shake the entire implementation module **and** its transitive
 * dependencies (`@radix-ui/react-popover`, `@uiw/react-json-view`, etc.).
 */
const ShowComponent: typeof ShowComponentImpl =
  // biome-ignore lint/suspicious/noExplicitAny: noop stub only reachable on the production dead-code path
  process.env.NODE_ENV === 'development' ? ShowComponentImpl : ((() => null) as any);

export { ShowComponent };
export { configureSourceRoot, clearCaches } from './core/source-location-resolver';
export type { ComponentHandle, NavigationEvent, ShowComponentProps } from './react/ShowComponent';
