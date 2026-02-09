# show-component

Development tool for React apps. Right-click any element to jump straight to the component source code in your editor.

Works by reading React fiber internals and resolving source maps in the browser — no server or build plugin required.

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

Navigation opens the file in Cursor/VS Code via the `cursor://file/…` protocol.

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

## Custom Navigation

Override the default editor-opening behavior with `onNavigate`:

```tsx
<ShowComponent
  onNavigate={({ source, line, column, url, componentName }) => {
    console.log(`${componentName} → ${source}:${line}:${column}`);
  }}
/>
```

When `onNavigate` is provided, the `cursor://` protocol handler is not triggered.

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

| Prop | Type | Description |
|---|---|---|
| `sourceRoot` | `string` | Absolute path to the project root. Converts URL-relative paths to absolute filesystem paths. |
| `onNavigate` | `(event: NavigationEvent) => void` | Custom navigation handler. Replaces the default `cursor://` protocol call. |
| `getClickTarget` | `(chain: ComponentHandle[]) => number \| null \| undefined \| Promise<…>` | Customise which component Alt+Right-Click navigates to. See [Custom Click Target](#custom-click-target). |

### `configureSourceRoot(root: string | undefined)`

Sets the source root programmatically. Equivalent to the `sourceRoot` prop.

### `NavigationEvent`

```ts
interface NavigationEvent {
  source: string;       // Resolved source file path
  line: number;         // Line number in the original source
  column: number;       // Column number in the original source
  url: string;          // The cursor:// URL
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
