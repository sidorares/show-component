# AGENTS.md

Context for coding agents working in this repository. Read this before making changes.

## What this project is

`show-component` is a **dev-only React tool**: Alt + Right-Click any element in the browser and it
opens the source file/line that rendered it in your editor (`cursor://file/…`, `vscode://file/…`, …).

How it works, end to end:

1. Read the React fiber from the DOM node (`__reactFiber$…` property).
2. Walk up the owner chain via `fiber._debugOwner`.
3. For each fiber, take a frame from `fiber._debugStack` (the `Error` React 19 attaches in dev builds).
4. Fetch the bundled JS for that frame, find its source map (inline data URL or external
   `//# sourceMappingURL=`), and map the generated position back to the original file/line.
5. Navigate via `window.location.href = "<scheme>://file/<path>:<line>:<col>"` or call the
   consumer's `onNavigate`.

It deliberately does **not** use `_debugSource` (removed in React 19) and needs no build plugin.
In practice this means **React 19+ in development mode** — `_debugStack` does not exist in older
React or in production builds.

Next.js RSC frames (`rsc://React/Server/file:///…` / `about://React/Server/file:///…` containing
`/.next/`) are resolved through the Next dev server endpoints `POST /__nextjs_original-stack-frames`
and `GET /__nextjs_source-map` instead of fetching the bundle.

## Repository layout

This is **three separate npm projects**, each with its own `package.json` and `package-lock.json`.
There are no workspaces — run `npm ci` in each directory you touch.

```
/                     the published npm package "show-component"
  src/
    index.ts          public entry; swaps ShowComponent for a no-op unless NODE_ENV === 'development'
    core/             framework-agnostic logic (also bundled into the extension)
      fiber-utils.ts             fiber lookup, owner-chain walk, component naming, stack-frame pick
      source-location-resolver.ts  stack-frame parsing, source-map fetch/resolve, Next.js RSC path, caches
      chain-transformer.ts       ChainTransformer types + identity transform
      types.ts                   Fiber, ClickToNodeInfo, ComponentHandle, NavigationEvent
      source-location-resolver.test.ts   the only unit tests (vitest)
    react/ShowComponent.tsx      the <ShowComponent/> UI: context-menu listener, chain popover, props popups
    react/components/ui/         thin Radix Popover wrapper (shadcn-style, inline styles only)
    transformers/                rule-based chain transformers (react-intl FormattedMessage, i18next Trans)
                                 uses @babel/parser to locate a JSX prop value in the original source
extension/            Chrome MV3 extension (private, not published to npm)
  src/content/main-world.ts   runs in the page's MAIN world; imports ../../../src/core + transformers directly
  src/content/bridge.ts       ISOLATED world relay: page postMessage <-> chrome.runtime
  src/background/service-worker.ts  context menu, options, opens editor URL via chrome.tabs.update
  src/popup, src/options      React 19 UIs; options stored in chrome.storage.sync
test-app/             Vite + React 19 app with scenarios and a Playwright e2e harness
  vite.config.ts      aliases 'show-component' -> ../src (tests run against live source, not dist/)
  src/scenarios/      one file per pattern (HOC, memo/forwardRef, lazy/dynamic import, react-intl, …)
  src/test-runner/    in-browser TestRunner; NOTE fiber-utils.ts here is a separate copy, not the library's
  e2e/harness.spec.ts clicks the TestRunner "Run" buttons and asserts on its JSON output
```

## Commands

Root (library):

| Command | What it does |
|---|---|
| `npm ci` | install |
| `npm run lint` / `npm run lint:fix` | Biome check (also covers `extension/src`; ignores `test-app`) |
| `npm run type-check` | `tsc --noEmit` — **excludes `*.test.ts`** |
| `npm test` | vitest unit tests (`src/**/*.test.ts`) — needs Node ≥ 20 |
| `npm run build` | tsup → `dist/` (CJS + ESM + `.d.ts`/`.d.mts`, code-split) |
| `npm run build:extension` | builds the extension (requires `extension/node_modules`) |

Extension (`cd extension`): `npm ci`, `npm run build` (tsup + `scripts/copy-static.mjs` → `extension/dist/`,
load it unpacked in `chrome://extensions`), `npm run type-check`.
The extension bundle resolves `@jridgewell/source-map` / `convert-source-map` imported by `../src/core`
from the **root** `node_modules`, so install root deps first.

Test app (`cd test-app`): `npm ci`, `npm run dev` (port 5199), `npx playwright install chromium`,
`npm test` (Playwright starts Vite itself). Also needs root deps installed (`@babel/parser` is resolved
from the root `node_modules`).

Before committing, at minimum run in the root: `npm run lint && npm run type-check && npm test && npm run build`.

## Conventions

- **Formatting/linting: Biome 1.9** (`biome.json`): 2-space indent, single quotes, trailing commas `es5`,
  line width 100, `organizeImports` on. Run `npm run lint:fix` rather than hand-formatting.
  CI fails on any Biome diagnostic, including formatting.
- TypeScript `strict`. Avoid `any`; when unavoidable, use a `// biome-ignore lint/...: reason` comment
  as existing code does.
- No CSS files or Tailwind in the library: styles are inline or in the `SC_STYLES` string injected by
  `ShowComponent`. Classes are prefixed `sc-`. Keep it that way so consumers need no CSS setup.
- Keep dependencies light — `lucide-react` was removed for size; icons are inline SVG.
- Fiber access is defensive: wrap property reads that may throw, return fallbacks rather than throwing.
- Debug logging is gated behind the `debug` prop/option and prefixed `[show-component]`
  (`[show-component-ext]` in the extension).
- Code in `src/core` must stay React-free and browser-safe — the extension's MAIN-world script bundles it.
- Public API is whatever `src/index.ts` exports. Keep README's API section in sync when changing it.

## Commits and releases

- **Conventional Commits are required** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, optional scope
  like `fix(extension):`). release-please (`release-please-config.json`, `.release-please-manifest.json`)
  turns them into the CHANGELOG and version bumps.
- Do not edit `CHANGELOG.md` or the version in `package.json` / `.release-please-manifest.json` by hand.
- Merging the release-please PR on `main` publishes to npm (`release.yml`) and attaches the extension zip
  to the GitHub release. The extension's own `manifest.json` version is **not** bumped by release-please.

## CI (`.github/workflows`)

All workflows use Node 24.

- `ci.yml` (push/PR to `main`): Biome lint, type-check, unit tests, library build, extension build; a
  separate job runs the Playwright harness in `test-app`.
- `extension-build.yml` (PRs): builds the extension, uploads a zip artifact, comments on the PR
  (comment skipped for fork PRs).
- `release.yml` (push to `main`): release-please; on release, lint + type-check + tests + build +
  extension zip, then `npm publish --provenance` and upload of the zip to the GitHub release.
- `canary.yml` (push to `main`): publishes `<next-patch>-canary.<sha>` under the npm `canary` tag, unless
  the commit subject is `docs:`, `ci:`, `chore(deps):`, `chore(main):` (release-please) and similar.

## Gotchas

- The library only activates when `process.env.NODE_ENV === 'development'` (see `src/index.ts`); under
  `test` or `production` `<ShowComponent/>` renders nothing. The bundler must define `process.env.NODE_ENV`.
- `STACK_FRAME_INDEX = 1` in `fiber-utils.ts` picks the 2nd non-internal frame of `_debugStack`
  (the first is usually `jsxDEV`). Changing frame filtering affects every scenario — run the e2e harness.
- Column handling: stack-trace columns are 1-based, source-map lookups and `ResolvedSourceInfo.column`
  are treated as 0-based, and `openInEditor` adds 1 when building the URL. Be careful with off-by-one changes.
- `resolveSourcePath` treats absolute sources containing `/src/` or `/node_modules/` as already
  filesystem-absolute and does not prepend `sourceRoot`.
- `transformers/formatted-message.ts` and `transformers/transformer-rule.ts` import each other
  (circular); only functions/consts used at call time cross the cycle — keep it that way.
- Resolver caches (`resultCache`, `sourceMapCache`) are module-level; call `clearCaches()` in tests.
- The extension relays page `postMessage` traffic; messages are only checked for `source === window`
  and a `MSG_SOURCE` tag, so page scripts can forge them. Don't add privileged message types without
  thinking about that.
- The `react`/`react-dom` peer range is intentionally `>=16.8.0` (the component is a harmless no-op
  outside React 19 dev builds); don't narrow it without treating it as a breaking change.
  Everything inside the repo (root dev install, `extension/`, `test-app/`) uses React 19 and
  `@types/react` 19.
