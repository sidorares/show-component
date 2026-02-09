# show-component

> Inspired by [react-show-in-atom](https://github.com/sidorares/react-show-in-atom) and [click-to-component](https://github.com/ericclemmons/click-to-component).

Development tool for React apps. Right-click any element to jump straight to the component source code in your editor.

Works by reading React fiber internals and resolving source maps in the browser — no server or build plugin required.

## Background

Tools like [click-to-component](https://github.com/ericclemmons/click-to-component), [react-dev-inspector](https://github.com/zthxxx/react-dev-inspector), and [locatorjs](https://github.com/infi-pc/locatorjs) let you click any React element in the browser to jump to its source in your editor. They all relied on `_debugSource` — a property that React attached to fiber nodes when the codebase was compiled with [`@babel/plugin-transform-react-jsx-source`](https://www.npmjs.com/package/babel-plugin-transform-react-jsx-source).

React 19 [removed `_debugSource`](https://github.com/facebook/react/pull/28265), breaking the entire ecosystem of click-to-source tools ([facebook/react#32574](https://github.com/facebook/react/issues/32574)). The removal was intentional — the Babel transform had limitations: it only worked with JSX, didn't compose with source maps, and was DEV-only.

**show-component** takes a different approach. Instead of relying on a build-time Babel transform, it reads `_debugStack` — the `Error` stack trace that React 19 attaches to every fiber node at render time — and resolves original source locations through your bundler's standard source maps at runtime.

This means:
- **No build plugin required** — works with any bundler that emits source maps (Vite, webpack, esbuild, etc.)
- **No Babel JSX transform** — no `@babel/plugin-transform-react-jsx-source` or similar needed
- **React 19 compatible** — uses the same mechanism React itself now uses for component stacks

This library does not fall back to `_debugSource` and exclusively relies on `_debugStack`. If you are on React 18 or earlier, you are better served by [click-to-component](https://github.com/ericclemmons/click-to-component) or [react-dev-inspector](https://github.com/zthxxx/react-dev-inspector), which are designed around the Babel JSX source transform.

## Installation

```bash
npm install show-component
```

## Setup

Render `<ShowComponent />` once at the root of your app (usually next to your router or providers). It does not wrap children — it attaches a global context-menu listener.

```tsx
import { ShowComponent } from 'show-component';

function App() {
  return (
    <>
      <ShowComponent />
      <YourApp />
    </>
  );
}
```

## Usage

| Shortcut | Action |
|---|---|
| **Alt + Right Click** | Navigate directly to the source of the clicked component |
| **Alt + Shift + Right Click** | Show a popover with the full component chain; click any entry to navigate, or inspect its props |

Navigation opens the file in your editor via a custom protocol URL (default `cursor://file/…`). Use the [`editorScheme`](#editor-scheme) prop to target a different editor.

## Source Root

By default, resolved paths are URL-relative (e.g. `/src/components/Foo.tsx`). To get absolute paths your editor can open directly, set the project root:

```tsx
// Via prop
<ShowComponent sourceRoot="/Users/me/project" />

// Via global
window.__SHOW_COMPONENT_SOURCE_ROOT__ = '/Users/me/project';

// Programmatic
import { configureSourceRoot } from 'show-component';
configureSourceRoot('/Users/me/project');
```

## Editor Scheme

By default, navigation uses the `cursor://` protocol. To open files in a different editor, pass the `editorScheme` prop with the appropriate URL scheme:

```tsx
// VS Code
<ShowComponent editorScheme="vscode" />

// VS Code Insiders
<ShowComponent editorScheme="vscode-insiders" />

// Windsurf
<ShowComponent editorScheme="windsurf" />
```

The scheme is the part before `://` in the generated URL (e.g. `vscode://file/path/to/File.tsx:12:5`).

## Custom Navigation

Override the default editor-opening behavior with `onNavigate`:

```tsx
<ShowComponent
  onNavigate={({ source, line, column, url, componentName }) => {
    console.log(`${componentName} → ${source}:${line}:${column}`);
  }}
/>
```

When `onNavigate` is provided, the protocol handler is not triggered — the consumer decides what to do with the resolved location.

## Custom Click Target

By default, **Alt + Right Click** navigates to the component closest to the clicked DOM element (index 0 in the chain). Use `getClickTarget` to choose a different component:

```tsx
<ShowComponent
  getClickTarget={(chain) => {
    // Skip design-system primitives, navigate to the first "real" component
    const skip = new Set(['Button', 'Icon', 'Text', 'Box']);
    const idx = chain.findIndex((c) => !skip.has(c.componentName));
    return idx >= 0 ? idx : undefined; // undefined = default (index 0)
  }}
/>
```

Each entry in the chain is a `ComponentHandle` with the component name and props available immediately. Source-map resolution is **lazy** — it only happens if you call `resolveSource()`:

```tsx
<ShowComponent
  getClickTarget={async (chain) => {
    // Prefer deciding by name alone (zero overhead)
    const byName = chain.findIndex((c) => c.componentName === 'PageContent');
    if (byName >= 0) return byName;

    // Fall back to resolving source locations when names aren't enough
    for (const handle of chain) {
      const loc = await handle.resolveSource();
      if (loc && !loc.source.includes('node_modules')) return handle.index;
    }
    return undefined;
  }}
/>
```

The callback can return synchronously (just a number) or asynchronously (a Promise). Returning `null` or `undefined` falls back to the default behaviour.

## API

### `<ShowComponent />`

| Prop | Type | Default | Description |
|---|---|---|---|
| `sourceRoot` | `string` | — | Absolute path to the project root. Converts URL-relative paths to absolute filesystem paths. |
| `editorScheme` | `string` | `"cursor"` | URL scheme for editor navigation (e.g. `"vscode"`, `"vscode-insiders"`, `"windsurf"`). See [Editor Scheme](#editor-scheme). |
| `onNavigate` | `(event: NavigationEvent) => void` | — | Custom navigation handler. Replaces the default protocol call. |
| `getClickTarget` | `(chain: ComponentHandle[]) => number \| null \| undefined \| Promise<…>` | — | Customise which component Alt+Right-Click navigates to. See [Custom Click Target](#custom-click-target). |

### `configureSourceRoot(root: string | undefined)`

Sets the source root programmatically. Equivalent to the `sourceRoot` prop.

### `NavigationEvent`

```ts
interface NavigationEvent {
  source: string;       // Resolved source file path
  line: number;         // Line number in the original source
  column: number;       // Column number in the original source
  url: string;          // The editor protocol URL (e.g. cursor://file/…)
  componentName?: string;
}
```

### `ComponentHandle`

Passed to `getClickTarget`. Immediate data is available synchronously; source resolution is lazy.

```ts
interface ComponentHandle {
  componentName: string;                    // Display name of the component
  props: Record<string, unknown> | undefined; // Component props (from fiber)
  index: number;                            // Position in the chain (0 = closest to DOM)
  resolveSource: () => Promise<{            // Lazy source-map resolution (cached)
    source: string;
    line: number;
    column: number;
  } | null>;
}
```

## Requirements

- React 16.8+ (uses fiber internals available in development builds)
- Development mode only — fiber debug info (`_debugOwner`, `_debugStack`) is stripped in production builds

## License

MIT
