import type { BridgeToBackgroundMessage, GetOptionsResponse } from '../shared/messaging';
import {
  LOCAL_DEV_MATCHES,
  extraGrantedPatterns,
  matchPatternToUrlFilters,
  normalizeOrigin,
  originToMatchPattern,
} from '../shared/origins';
import { loadOptions } from '../shared/storage';

const CONTEXT_MENU_ID = 'show-component-chain';
const CONTENT_SCRIPT_IDS = { mainWorld: 'sc-main-world', bridge: 'sc-bridge' } as const;

// Schemes that must never be used as an "editor" — they would navigate the tab
// somewhere instead of handing the path to an external app.
const BLOCKED_EDITOR_SCHEMES = new Set([
  'http',
  'https',
  'file',
  'ftp',
  'ws',
  'wss',
  'data',
  'blob',
  'javascript',
  'about',
  'chrome',
  'chrome-extension',
  'chrome-untrusted',
  'devtools',
  'filesystem',
  'view-source',
]);

// ─── Site access ─────────────────────────────────────────────────────────────

/**
 * Whether the page that sent a message may use the extension: it must be the
 * top frame of a tab, the extension must be enabled, and the extension must
 * currently hold a host permission for the page's origin.
 */
async function isSenderAllowed(sender: chrome.runtime.MessageSender): Promise<boolean> {
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0) {
    return false;
  }
  const origin = sender.origin ?? (sender.url ? normalizeOrigin(sender.url) : null);
  const pattern = origin ? originToMatchPattern(origin) : null;
  if (!pattern) return false;

  const opts = await loadOptions();
  if (!opts.enabled) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}

// ─── Registration sync ───────────────────────────────────────────────────────
// Local dev hosts are covered by the manifest. Everything else the user granted
// gets dynamically registered content scripts, a context menu entry, and an
// "active" toolbar icon. Re-run whenever permissions or the enabled flag change.

async function syncContentScripts(extraPatterns: string[]): Promise<void> {
  const ids = Object.values(CONTENT_SCRIPT_IDS);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids });
  if (existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  }
  if (extraPatterns.length === 0) return;

  const common = {
    matches: extraPatterns,
    // Local dev hosts already get the static scripts; don't inject twice when
    // the user has granted a broad pattern such as "*://*/*".
    excludeMatches: LOCAL_DEV_MATCHES,
    runAt: 'document_idle' as const,
  };
  await chrome.scripting.registerContentScripts([
    { ...common, id: CONTENT_SCRIPT_IDS.mainWorld, js: ['content/main-world.js'], world: 'MAIN' },
    { ...common, id: CONTENT_SCRIPT_IDS.bridge, js: ['content/bridge.js'] },
  ]);
}

async function syncContextMenu(enabled: boolean, grantedPatterns: string[]): Promise<void> {
  await chrome.contextMenus.removeAll();
  if (!enabled || grantedPatterns.length === 0) return;
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Show Component Chain',
    contexts: ['page', 'selection', 'link', 'image'],
    documentUrlPatterns: grantedPatterns,
  });
}

/** Renders the packaged icon at toolbar sizes, optionally greyed out. */
async function renderActionIcon(inactive: boolean): Promise<Record<string, ImageData>> {
  const blob = await (await fetch(chrome.runtime.getURL('icons/icon-128.png'))).blob();
  const bitmap = await createImageBitmap(blob);
  const result: Record<string, ImageData> = {};
  for (const size of [16, 32]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(bitmap, 0, 0, size, size);
    const image = ctx.getImageData(0, 0, size, size);
    if (inactive) {
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        const grey = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        d[i] = grey;
        d[i + 1] = grey;
        d[i + 2] = grey;
        d[i + 3] = Math.round(d[i + 3] * 0.55);
      }
    }
    result[String(size)] = image;
  }
  return result;
}

/**
 * Grey toolbar icon by default; declarativeContent switches it to the coloured
 * one on pages the extension is active on. Needs no host permission, so it also
 * tells the user "not enabled here" on sites we can't see into.
 */
async function syncActionIcon(enabled: boolean, grantedPatterns: string[]): Promise<void> {
  await chrome.action.setIcon({ imageData: await renderActionIcon(true) });
  await new Promise<void>((resolve) =>
    chrome.declarativeContent.onPageChanged.removeRules(undefined, () => resolve())
  );
  if (!enabled) return;

  const conditions = grantedPatterns
    .flatMap(matchPatternToUrlFilters)
    .map((pageUrl) => new chrome.declarativeContent.PageStateMatcher({ pageUrl }));
  if (conditions.length === 0) return;

  const activeIcon = await renderActionIcon(false);
  await new Promise<void>((resolve) =>
    chrome.declarativeContent.onPageChanged.addRules(
      [{ conditions, actions: [new chrome.declarativeContent.SetIcon({ imageData: activeIcon })] }],
      () => resolve()
    )
  );
}

async function syncRegistrations(): Promise<void> {
  const opts = await loadOptions();
  const { origins } = await chrome.permissions.getAll();
  // Includes local dev hosts only while Chrome isn't withholding them
  // (site access set to "on click" in chrome://extensions).
  const granted = (origins ?? []).filter(
    (p) => LOCAL_DEV_MATCHES.includes(p) || extraGrantedPatterns([p]).length > 0
  );
  const extra = extraGrantedPatterns(granted);

  await syncContentScripts(extra);
  await syncContextMenu(opts.enabled, granted);
  await syncActionIcon(opts.enabled, granted);
}

// Serialize syncs: overlapping register/unregister calls fail on duplicate IDs.
let syncQueue: Promise<void> = Promise.resolve();
function scheduleSync(): Promise<void> {
  syncQueue = syncQueue
    .then(syncRegistrations)
    .catch((err) => console.error('[show-component-ext] failed to sync registrations:', err));
  return syncQueue;
}

chrome.runtime.onInstalled.addListener(() => {
  // Superseded by optional host permissions.
  chrome.storage.sync.remove('enabledOrigins');
  scheduleSync();
});
chrome.runtime.onStartup.addListener(() => {
  scheduleSync();
});
chrome.permissions.onAdded.addListener(() => {
  scheduleSync();
});
chrome.permissions.onRemoved.addListener(() => {
  scheduleSync();
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && 'enabled' in changes) scheduleSync();
});

// ─── Context menu ────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  if (!tab?.id) return;

  // Fails harmlessly on tabs opened before the content script was registered.
  chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_INSPECT' }).catch(() => {});
});

// ─── Messages from the bridge ────────────────────────────────────────────────

function isValidEditorScheme(scheme: string): boolean {
  return /^[a-z][a-z0-9+.-]*$/i.test(scheme) && !BLOCKED_EDITOR_SCHEMES.has(scheme.toLowerCase());
}

function isValidLocation(payload: unknown): payload is OpenEditorPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const { source, line, column } = payload as Record<string, unknown>;
  return (
    typeof source === 'string' &&
    source.length > 0 &&
    source.length < 4096 &&
    Number.isInteger(line) &&
    (line as number) >= 0 &&
    Number.isInteger(column) &&
    (column as number) >= 0
  );
}

type OpenEditorPayload = Extract<BridgeToBackgroundMessage, { type: 'OPEN_EDITOR' }>['payload'];

async function handleGetOptions(sender: chrome.runtime.MessageSender): Promise<GetOptionsResponse> {
  if (!(await isSenderAllowed(sender))) return null;
  const opts = await loadOptions();
  return {
    sourceRoot: opts.sourceRoot,
    debug: opts.debug,
    componentDisallowList: opts.componentDisallowList,
    folderDisallowList: opts.folderDisallowList,
    mergeConsecutive: opts.mergeConsecutive,
    enabledTransformers: opts.enabledTransformers,
    customTransformerRules: opts.customTransformerRules,
  };
}

async function handleOpenEditor(
  payload: unknown,
  sender: chrome.runtime.MessageSender
): Promise<{ ok: boolean }> {
  if (!isValidLocation(payload) || !(await isSenderAllowed(sender))) return { ok: false };

  const { editorScheme } = await loadOptions();
  if (!isValidEditorScheme(editorScheme)) {
    console.warn('[show-component-ext] refusing to open editor with scheme:', editorScheme);
    return { ok: false };
  }

  const { source, line, column } = payload;
  let cleanPath = source.replace(/^file:\/\//, '');
  cleanPath = decodeURIComponent(cleanPath);
  if (!cleanPath.startsWith('/')) {
    cleanPath = `/${cleanPath}`;
  }
  const encodedPath = cleanPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = `${editorScheme}://file${encodedPath}:${line}:${column + 1}`;

  await chrome.tabs.update(sender.tab?.id as number, { url });
  return { ok: true };
}

chrome.runtime.onMessage.addListener(
  (
    message: BridgeToBackgroundMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message?.type === 'GET_OPTIONS') {
      handleGetOptions(sender).then(sendResponse, () => sendResponse(null));
      return true;
    }

    // From the popup after the user granted access to the current site: the
    // content scripts must be registered before the reload picks them up.
    if (message?.type === 'RELOAD_AFTER_SYNC') {
      if (sender.id !== chrome.runtime.id || sender.tab) return false;
      scheduleSync().then(() => chrome.tabs.reload(message.tabId));
      return false;
    }

    if (message?.type === 'OPEN_EDITOR') {
      handleOpenEditor(message.payload, sender).then(sendResponse, () =>
        sendResponse({ ok: false })
      );
      return true;
    }

    return false;
  }
);
