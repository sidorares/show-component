/**
 * MAIN world content script — has access to the page's JS context
 * (React fiber internals) but cannot use chrome.* APIs.
 *
 * Communicates with the ISOLATED world bridge via window.postMessage.
 */

import { buildFiberChain } from '../../../src/core/fiber-utils';
import { configureSourceRoot, resolveLocation } from '../../../src/core/source-location-resolver';
import type { ClickToNodeInfo } from '../../../src/core/types';
import { MSG_SOURCE } from '../shared/messaging';
import type { GetOptionsResponse, ResolvedLocationMessage } from '../shared/messaging';

// ─── State ───────────────────────────────────────────────────────────────────

let extensionEnabled = true;
let sourceRoot = '';
let debug = false;
let componentDisallowList: string[] = [];
let folderDisallowList: string[] = [];
let mergeConsecutive = false;

// ─── Options sync (received from bridge) ─────────────────────────────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== MSG_SOURCE) return;

  if (event.data.type === 'OPTIONS_UPDATE') {
    const opts = event.data.payload as GetOptionsResponse;
    extensionEnabled = opts.enabled;
    sourceRoot = opts.sourceRoot || '';
    debug = opts.debug;
    componentDisallowList = opts.componentDisallowList || [];
    folderDisallowList = opts.folderDisallowList || [];
    mergeConsecutive = opts.mergeConsecutive;

    if (sourceRoot) {
      configureSourceRoot(sourceRoot);
    }
  }

  if (event.data.type === 'TRIGGER_INSPECT') {
    // Triggered by context menu — we'll use the last known mouse position
    if (lastMouseTarget) {
      showChainOverlay(lastMouseTarget, lastMouseX, lastMouseY);
    }
  }
});

// Request initial options from bridge
window.postMessage({ source: MSG_SOURCE, type: 'REQUEST_OPTIONS' }, '*');

// ─── Mouse tracking for context menu trigger ─────────────────────────────────

let lastMouseTarget: HTMLElement | null = null;
let lastMouseX = 0;
let lastMouseY = 0;

document.addEventListener(
  'mousemove',
  (e) => {
    lastMouseTarget = e.target as HTMLElement;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  },
  true
);

// ─── Chain filtering ─────────────────────────────────────────────────────────

function filterChain(chain: ClickToNodeInfo[]): ClickToNodeInfo[] {
  let filtered = chain;

  if (componentDisallowList.length > 0) {
    filtered = filtered.filter((entry) => !componentDisallowList.includes(entry.componentName));
  }

  if (folderDisallowList.length > 0) {
    filtered = filtered.filter(
      (entry) =>
        !entry.stackFrame ||
        !folderDisallowList.some((folder) => entry.stackFrame?.includes(folder))
    );
  }

  if (mergeConsecutive) {
    const merged: ClickToNodeInfo[] = [];
    for (const entry of filtered) {
      const prev = merged[merged.length - 1];
      if (prev && prev.componentName === entry.componentName) continue;
      merged.push(entry);
    }
    filtered = merged;
  }

  return filtered;
}

// ─── Right-click handler ─────────────────────────────────────────────────────

document.addEventListener(
  'contextmenu',
  (event: MouseEvent) => {
    if (!extensionEnabled) return;
    if (!event.altKey) return;

    event.preventDefault();
    event.stopPropagation();

    const target = event.target as HTMLElement;

    if (event.shiftKey) {
      showChainOverlay(target, event.clientX, event.clientY);
      return;
    }

    // Alt+RightClick: navigate to nearest component
    const chain = filterChain(buildFiberChain(target));
    if (chain.length === 0) return;
    navigateToComponent(chain[0]);
  },
  true
);

document.addEventListener(
  'mousedown',
  (event: MouseEvent) => {
    if (event.button === 2 && event.altKey && extensionEnabled) {
      event.preventDefault();
    }
  },
  true
);

// ─── Source resolution + editor navigation ───────────────────────────────────

async function navigateToComponent(entry: ClickToNodeInfo): Promise<void> {
  if (!entry.stackFrame) return;

  try {
    const resolved = await resolveLocation(entry.stackFrame, debug);
    if (!resolved) return;

    const msg: ResolvedLocationMessage = {
      source: MSG_SOURCE,
      type: 'RESOLVED_LOCATION',
      payload: {
        source: resolved.source,
        line: resolved.line,
        column: resolved.column,
        componentName: entry.componentName,
      },
    };
    window.postMessage(msg, '*');
  } catch (err) {
    if (debug) console.error('[show-component-ext] resolve failed:', err);
  }
}

// ─── Shadow DOM overlay ──────────────────────────────────────────────────────

let overlayHost: HTMLDivElement | null = null;
let overlayRoot: ShadowRoot | null = null;

function ensureOverlay(): ShadowRoot {
  if (overlayRoot) return overlayRoot;

  overlayHost = document.createElement('div');
  overlayHost.id = 'show-component-ext-overlay';
  overlayHost.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(overlayHost);

  overlayRoot = overlayHost.attachShadow({ mode: 'open' });
  return overlayRoot;
}

function removeOverlay(): void {
  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
    overlayRoot = null;
  }
}

function showChainOverlay(target: HTMLElement, x: number, y: number): void {
  const rawChain = buildFiberChain(target);
  const chain = filterChain(rawChain);
  if (chain.length === 0) return;

  removeOverlay();
  const shadow = ensureOverlay();

  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.className = 'sc-ext-popover';

  const maxX = window.innerWidth - 340;
  const maxY = window.innerHeight - Math.min(chain.length * 32 + 20, 400);
  container.style.left = `${Math.min(x, maxX)}px`;
  container.style.top = `${Math.min(y, maxY)}px`;

  const list = document.createElement('div');
  list.className = 'sc-ext-list';

  for (const entry of chain) {
    const row = document.createElement('div');
    row.className = 'sc-ext-row';

    const btn = document.createElement('button');
    btn.className = 'sc-ext-item';
    btn.textContent = entry.componentName;
    btn.addEventListener('click', () => {
      removeOverlay();
      navigateToComponent(entry);
    });
    row.appendChild(btn);

    list.appendChild(row);
  }

  container.appendChild(list);
  shadow.appendChild(container);

  // Close on click outside
  const closeHandler = (e: MouseEvent) => {
    const path = e.composedPath();
    if (!path.includes(container)) {
      removeOverlay();
      document.removeEventListener('mousedown', closeHandler, true);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', closeHandler, true);
  }, 0);

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      removeOverlay();
      document.removeEventListener('keydown', escHandler, true);
    }
  };
  document.addEventListener('keydown', escHandler, true);
}

// ─── Overlay styles (injected into shadow DOM) ──────────────────────────────

const OVERLAY_STYLES = `
.sc-ext-popover {
  position: fixed;
  width: 20rem;
  padding: 0;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 10px 25px -5px rgba(0,0,0,.15), 0 4px 10px -4px rgba(0,0,0,.08);
  color: #1f2937;
  pointer-events: auto;
  z-index: 2147483647;
}
.sc-ext-list {
  padding: 8px 6px;
  max-height: 70vh;
  overflow-y: auto;
}
.sc-ext-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.sc-ext-item {
  flex: 1;
  display: block;
  padding: 5px 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 500;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.1s;
  line-height: 1.4;
}
.sc-ext-item:hover {
  background-color: #f3f4f6;
}
`;
