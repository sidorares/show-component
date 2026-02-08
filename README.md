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

## API

### `<ShowComponent />`

| Prop | Type | Description |
|---|---|---|
| `sourceRoot` | `string` | Absolute path to the project root. Converts URL-relative paths to absolute filesystem paths. |
| `onNavigate` | `(event: NavigationEvent) => void` | Custom navigation handler. Replaces the default `cursor://` protocol call. |

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

## Requirements

- React 16.8+ (uses fiber internals available in development builds)
- Development mode only — fiber debug info (`_debugOwner`, `_debugStack`) is stripped in production builds

## License

MIT
