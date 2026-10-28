# Chrome Web Store submission checklist

Status of the extension as of 2026-10-28 (manifest `1.0.0`, library `2.3.0`), and what is left
before it can be published on the Chrome Web Store (CWS).

Legend: ✅ done · ⚠️ exists but needs work · ❌ missing

## 1. Blockers: fix before the first upload

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1.1 | **Store icon (128×128 PNG in the zip)** | ⚠️ | `icons/icon-128.png` renders as a white square with blue corners. The `{ }` glyph from `scripts/generate-icons.mjs` doesn't show. Redraw it: 96×96 artwork centered with 16 px transparent padding, readable on light and dark backgrounds. Regenerate the 16 and 48 px icons from the same source, and add a 32 px icon for Windows. |
| 1.2 | **Host permissions / injection scope** | ✅ | `<all_urls>` in `host_permissions` and in both `content_scripts` injects a ~690 KB MAIN-world script into every site the user visits. A broad host permission puts the extension into CWS "in-depth review" (slower, more rejections), and reviewers ask why a dev tool runs on every site. Done in §4.1. |
| 1.3 | **Options leak to every page** | ✅ | `bridge.ts` posts the full options (including `sourceRoot`, a local filesystem path) with `window.postMessage(…, '*')` on every page. Any site's scripts can read it. Any page can also forge `RESOLVED_LOCATION` and make the background open `cursor://file/<any path>`. Fixed in §4.1. |
| 1.4 | **Version strategy** | ❌ | release-please doesn't bump `extension/manifest.json`, but every CWS upload needs a higher `version`. Pick one: (a) add the manifest to release-please `extra-files` so the extension tracks the library version (2.3.0 → next), or (b) version the extension separately and bump it by hand. (a) is simpler, and the release zip is already named after the library version. |
| 1.5 | **Privacy policy URL** | ❌ | The dashboard asks for one, and it is required once any "user data" box is ticked. Add a short `PRIVACY.md`: everything stays local, settings go to `chrome.storage.sync`, no analytics, no remote servers; it fetches only the page's own scripts and source maps. Link it by its GitHub URL. |
| 1.6 | **At least one screenshot (1280×800 or 640×400)** | ❌ | See §3. |

## 2. Manifest changes

- [ ] `version`: per 1.4.
- [x] `minimum_chrome_version`: `"111"` (the minimum for `"world": "MAIN"` content scripts).
- [ ] `homepage_url`: `https://github.com/sidorares/show-component`.
- [ ] `description` (≤132 chars). The current text says "Right-click", but the gesture is **Alt + Right-Click** or the context menu entry. Suggested: *"Alt + Right-Click any element in a React 19 dev build to open the component source file and line in your editor."* (112 chars)
- [x] `permissions`: `activeTab`, `scripting`, `storage`, `contextMenus`, `declarativeContent`; host permissions limited to local dev hosts, with `*://*/*` as an optional host permission (§4.1). Every permission needs a justification in the dashboard (§5).
- [ ] `icons` + `action.default_icon`: add the 32 px icon.
- [ ] Optional: `"short_name": "Show Component"`.

## 3. Store listing assets

| Asset | Required | Size | Plan |
|---|---|---|---|
| Store icon | yes | 128×128 PNG | Same file as the manifest icon (1.1). |
| Screenshots | ≥1, up to 5 | 1280×800 (or 640×400), square corners, no padding | Capture from `test-app` with the unpacked extension loaded (Playwright `--load-extension`, headful Chromium): ① component-chain popover after Alt + Right-Click; ② props popup; ③ the editor open at the right line (side-by-side composite); ④ options page (source root, editor scheme, transformers); ⑤ toolbar popup ("React on page: detected"). |
| Small promo tile | optional (recommended) | 440×280 | Icon + "Show Component" + "Jump from UI to source". |
| Marquee | optional | 1400×560 | Skip for v1. |
| Promo video | optional | YouTube URL | Optional 20–30 s screen capture of the Alt + Right-Click → editor flow. |

## 4. Code and repo work (proposed PRs)

### 4.1 `fix(extension)`: narrow the injection scope and stop leaking options ✅ (implemented)
- Static content scripts and required `host_permissions` cover local dev hosts only: `localhost`, `*.localhost`, `127.0.0.1` (http and https).
- Other sites are `optional_host_permissions`, granted from the popup ("Enable on this site") or the options page ("Site Access"). The service worker registers content scripts for whatever is granted (`chrome.scripting.registerContentScripts`) and re-syncs on `permissions.onAdded/onRemoved`. The old `enabledOrigins` setting is gone.
- The toolbar icon is greyed out by default and turns coloured (via `declarativeContent`) on sites where the extension is active. The context menu entry only appears on those sites.
- The popup shows whether the extension is active on the current site, and whether the page runs a React development build, a production build, or no React.
- The background answers `GET_OPTIONS` with `null` unless the sender's origin is granted and the extension is enabled. The page only receives the options it needs: no editor scheme, no origin list.
- `OPEN_EDITOR` checks the sender (top frame, granted origin) and the payload types. It reads the editor scheme from storage, refuses `http`/`javascript`/`file`/… schemes, and navigates the sender's tab only.
- Not done: no user-gesture check on `OPEN_EDITOR`. A script on a granted origin can still forge a navigation to `<scheme>://file/<path>`. Resolution is async, so the user activation can expire first; a check would be unreliable.

### 4.2 `chore(release)`: version and packaging
- Add `extension/manifest.json` to release-please `extra-files` (`jsonpath: $.version`), and probably `extension/package.json` too.
- Optional: auto-publish to CWS from `release.yml` with `chrome-webstore-upload-cli` and secrets `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`. The first upload has to be manual, since that is how the extension ID is assigned.

### 4.3 `feat(extension)`: icons + store assets
- Fix `generate-icons.mjs`, or replace it with a hand-made SVG rasterized to 16/32/48/128.
- Add `extension/store/` with screenshots, the promo tile, and a script that regenerates them from `test-app`.

### 4.4 `docs`: `PRIVACY.md`, plus a README update with the CWS install link once it is live.

Not needed: the bundles contain no `eval`/`new Function` and no remote code, and they are unminified (not obfuscated), which is fine. Total `dist/` is about 2 MB.

## 5. Developer dashboard: privacy and permissions tab (draft answers)

**Single purpose:**
> Lets React developers open the source code of the component that rendered any element on a page, by Alt + Right-Clicking it, in their local code editor.

**Permission justifications:**
- `contextMenus`: adds a "Show Component Chain" item to the right-click menu that opens the component inspector for the element under the cursor.
- `storage`: saves the user's settings (editor URL scheme, source root, enabled origins, disallow lists, transformer rules) in `chrome.storage.sync`.
- `scripting`: the toolbar popup runs a small read-only check on the active tab to report whether a React development build is present, and the service worker registers the content scripts for sites the user has granted.
- `declarativeContent`: greys out the toolbar icon on sites where the extension isn't active, without needing access to those sites.
- `activeTab`: lets the popup check above run on the current tab, only when the user opens the popup.
- Host permissions: the inspector must run in the page's JavaScript context to read React's development-mode component data, and must fetch the page's own scripts and source maps to map a component back to its original file and line. Required host access covers only local development hosts (localhost, 127.0.0.1). Other sites are optional permissions the user grants one at a time from the popup or options page.

**Remote code:** No. All JavaScript is in the package.

**Data usage:** the extension doesn't collect or transmit user data. It reads page scripts and source maps locally, and opens a local editor URL. Leave all categories unticked and tick the three certifications. (If the reviewer pushes back, "Website content" is the closest category; it is used only locally.)

## 6. Listing text (draft)

**Name:** `Show Component`. Optionally `Show Component – Open React source in your editor` (≤75 chars) for search.

**Category:** Developer Tools. **Language:** English.

**Detailed description:**

> Show Component takes you from any element on screen to the exact line of React code that rendered it.
>
> Alt + Right-Click an element (or use the "Show Component Chain" context-menu item) to see the chain of components that produced it. Click any entry to open that file and line in your editor: Cursor, VS Code, VS Code Insiders, WebStorm, Zed, or any editor with a URL scheme.
>
> • Works with React 19 development builds, with nothing to add to your app: no Babel plugin, no build config
> • Resolves locations through source maps (inline or external), including Next.js server components
> • Inspect a component's props from the chain popover
> • Transformers jump straight to the translation call site for react-intl FormattedMessage and i18next Trans
> • Hide noisy wrappers with component and folder disallow lists
> • Choose which origins it runs on
>
> Privacy: everything runs locally in your browser. No analytics, no servers. The extension only reads the page's own scripts and source maps.
>
> Requires a React 19+ development build (React 18 dev builds are supported on a best-effort basis). Open source (MIT): https://github.com/sidorares/show-component

**Support URL:** `https://github.com/sidorares/show-component/issues`

## 7. Account / one-time setup (manual, owner only)

- [ ] Register a CWS developer account ($5 one-time) at https://chrome.google.com/webstore/devconsole.
- [ ] Enable 2-step verification on the Google account (required to publish).
- [ ] Set and verify the publisher contact email.
- [ ] Complete the trader / non-trader declaration (EU DSA). A free open-source hobby project is normally non-trader.
- [ ] Optional: verify the publisher website/domain.

## 8. Submission order

1. Land §4.1–4.4 (code, icons, privacy policy, versioning).
2. `npm ci && cd extension && npm ci && npm run build`, smoke-test `extension/dist` unpacked against `test-app` and a Next.js app.
3. Zip the contents of `dist/` (manifest at the zip root), or take the zip from the GitHub release.
4. Dashboard → New item → upload the zip → fill in the Store listing (§3, §6), Privacy (§5), and Distribution (Public, all regions, free).
5. Submit for review. Expect a few days, longer with broad host permissions.
6. After approval: add the CWS link and badge to the README, and wire up auto-publish (§4.2) for later releases.
