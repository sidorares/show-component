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
    if (lastMouseTarget) {
      showChainOverlay(lastMouseTarget, lastMouseX, lastMouseY);
    }
  }
});

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

  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;
  overlayRoot.appendChild(style);

  return overlayRoot;
}

function removeOverlay(): void {
  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
    overlayRoot = null;
  }
}

// ─── Chain popover ───────────────────────────────────────────────────────────

function showChainOverlay(target: HTMLElement, x: number, y: number): void {
  const rawChain = buildFiberChain(target);
  const chain = filterChain(rawChain);
  if (chain.length === 0) return;

  removeOverlay();
  const shadow = ensureOverlay();

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

    const hasProps = entry.props && Object.keys(entry.props).some((k) => k !== 'children');
    if (hasProps) {
      const propsBtn = document.createElement('button');
      propsBtn.className = 'sc-ext-icon-btn';
      propsBtn.title = 'Inspect props';
      propsBtn.innerHTML = ICON_BRACES;
      propsBtn.addEventListener('click', () => {
        openPropsPopup(entry, shadow);
      });
      row.appendChild(propsBtn);
    }

    list.appendChild(row);
  }

  container.appendChild(list);
  shadow.appendChild(container);

  const closeHandler = (e: MouseEvent) => {
    const path = e.composedPath();
    if (!path.includes(container)) {
      container.remove();
      document.removeEventListener('mousedown', closeHandler, true);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', closeHandler, true);
  }, 0);

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      removeOverlay();
      document.removeEventListener('keydown', escHandler, true);
    }
  };
  document.addEventListener('keydown', escHandler, true);
}

// ─── Props popup (draggable, resizable) ──────────────────────────────────────

let propsPopupCount = 0;

function openPropsPopup(entry: ClickToNodeInfo, shadow: ShadowRoot): void {
  const CASCADE = 40;
  const W = 400;
  const H = 300;
  const idx = propsPopupCount++;

  let posX = 200 + idx * CASCADE;
  let posY = 200 + idx * CASCADE;
  if (posX + W > window.innerWidth - 20) posX = 50 + (idx % 5) * CASCADE;
  if (posY + H > window.innerHeight - 20) posY = 100;

  const popup = document.createElement('div');
  popup.className = 'sc-ext-props-popup';
  popup.style.left = `${posX}px`;
  popup.style.top = `${posY}px`;
  popup.style.width = `${W}px`;
  popup.style.height = `${H}px`;

  // ── Header (drag handle) ─────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'sc-ext-props-header';

  const title = document.createElement('span');
  title.className = 'sc-ext-props-title';
  title.textContent = entry.componentName;
  header.appendChild(title);

  const headerBtns = document.createElement('div');
  headerBtns.style.cssText = 'display:flex;gap:2px;align-items:center;';

  const srcBtn = document.createElement('button');
  srcBtn.className = 'sc-ext-icon-btn';
  srcBtn.title = 'Go to source';
  srcBtn.innerHTML = ICON_EXTERNAL_LINK;
  srcBtn.addEventListener('click', () => navigateToComponent(entry));
  headerBtns.appendChild(srcBtn);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sc-ext-icon-btn';
  closeBtn.title = 'Close';
  closeBtn.innerHTML = ICON_CLOSE;
  closeBtn.addEventListener('click', () => {
    popup.remove();
    propsPopupCount = Math.max(0, propsPopupCount - 1);
  });
  headerBtns.appendChild(closeBtn);

  header.appendChild(headerBtns);
  popup.appendChild(header);

  // ── Drag logic ───────────────────────────────────────────────────────────
  let dragging = false;
  let dragOffX = 0;
  let dragOffY = 0;

  header.addEventListener('mousedown', (e: MouseEvent) => {
    dragging = true;
    dragOffX = e.clientX - popup.offsetLeft;
    dragOffY = e.clientY - popup.offsetTop;
    e.preventDefault();
  });

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    popup.style.left = `${e.clientX - dragOffX}px`;
    popup.style.top = `${e.clientY - dragOffY}px`;
  };
  const onMouseUp = () => {
    dragging = false;
  };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // ── Resize handle (bottom-right) ─────────────────────────────────────────
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'sc-ext-resize-se';

  let resizing = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;

  resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = popup.offsetWidth;
    resizeStartH = popup.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  });

  const onResizeMove = (e: MouseEvent) => {
    if (!resizing) return;
    popup.style.width = `${Math.max(200, resizeStartW + e.clientX - resizeStartX)}px`;
    popup.style.height = `${Math.max(120, resizeStartH + e.clientY - resizeStartY)}px`;
  };
  const onResizeUp = () => {
    resizing = false;
  };
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeUp);

  // ── Body (JSON tree) ─────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'sc-ext-props-body';

  if (entry.props) {
    body.appendChild(renderJsonTree(entry.props, 1));
  } else {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#9ca3af;font-size:13px;';
    empty.textContent = 'No props available';
    body.appendChild(empty);
  }

  popup.appendChild(body);
  popup.appendChild(resizeHandle);
  shadow.appendChild(popup);

  // Clean up listeners when popup is removed
  const observer = new MutationObserver(() => {
    if (!shadow.contains(popup)) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeUp);
      observer.disconnect();
    }
  });
  observer.observe(shadow, { childList: true });
}

// ─── JSON tree renderer (vanilla DOM, collapsible) ──────────────────────────

function renderJsonTree(value: unknown, collapseDepth: number, depth = 0): HTMLElement {
  if (value === null) return createLeaf('null', 'sc-jt-null');
  if (value === undefined) return createLeaf('undefined', 'sc-jt-undef');

  const t = typeof value;
  if (t === 'boolean') return createLeaf(String(value), 'sc-jt-bool');
  if (t === 'number') return createLeaf(String(value), 'sc-jt-num');
  if (t === 'string') return createLeaf(`"${truncate(value as string, 120)}"`, 'sc-jt-str');
  if (t === 'function') return createLeaf('f()', 'sc-jt-fn');
  if (t === 'symbol') return createLeaf(String(value), 'sc-jt-sym');

  if (Array.isArray(value)) {
    if (value.length === 0) return createLeaf('[]', 'sc-jt-brace');
    return createCollapsible(`Array(${value.length})`, '[', ']', value, true, collapseDepth, depth);
  }

  if (t === 'object') {
    const keys = safeKeys(value as Record<string, unknown>);
    if (keys.length === 0) return createLeaf('{}', 'sc-jt-brace');
    return createCollapsible(
      `{${keys.length}}`,
      '{',
      '}',
      value as Record<string, unknown>,
      false,
      collapseDepth,
      depth
    );
  }

  return createLeaf(String(value), '');
}

function createLeaf(text: string, cls: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = `sc-jt-leaf ${cls}`;
  el.textContent = text;
  return el;
}

function createCollapsible(
  summary: string,
  open: string,
  close: string,
  data: unknown[] | Record<string, unknown>,
  isArray: boolean,
  collapseDepth: number,
  depth: number
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'sc-jt-node';

  const collapsed = depth >= collapseDepth;

  const toggle = document.createElement('span');
  toggle.className = 'sc-jt-toggle';
  toggle.textContent = collapsed ? '▶' : '▼';

  const head = document.createElement('span');
  head.className = 'sc-jt-head';
  head.textContent = collapsed ? `${open} ${summary} ${close}` : open;

  const children = document.createElement('div');
  children.className = 'sc-jt-children';
  children.style.display = collapsed ? 'none' : '';

  let childrenRendered = !collapsed;

  function renderChildren() {
    if (childrenRendered) return;
    childrenRendered = true;
    populateChildren(children, data, isArray, collapseDepth, depth);
  }

  if (!collapsed) {
    populateChildren(children, data, isArray, collapseDepth, depth);
  }

  const tail = document.createElement('span');
  tail.className = 'sc-jt-brace';
  tail.textContent = close;
  tail.style.display = collapsed ? 'none' : '';

  toggle.addEventListener('click', () => {
    const isNowCollapsed = children.style.display === 'none';
    if (isNowCollapsed) {
      renderChildren();
      children.style.display = '';
      tail.style.display = '';
      toggle.textContent = '▼';
      head.textContent = open;
    } else {
      children.style.display = 'none';
      tail.style.display = 'none';
      toggle.textContent = '▶';
      head.textContent = `${open} ${summary} ${close}`;
    }
  });

  wrapper.appendChild(toggle);
  wrapper.appendChild(head);
  wrapper.appendChild(children);
  wrapper.appendChild(tail);
  return wrapper;
}

function populateChildren(
  container: HTMLElement,
  data: unknown[] | Record<string, unknown>,
  isArray: boolean,
  collapseDepth: number,
  depth: number
): void {
  const entries = isArray
    ? (data as unknown[]).map((v, i) => [String(i), v] as const)
    : safeKeys(data as Record<string, unknown>).map(
        (k) => [k, (data as Record<string, unknown>)[k]] as const
      );

  for (const [key, val] of entries) {
    const row = document.createElement('div');
    row.className = 'sc-jt-entry';

    const keyEl = document.createElement('span');
    keyEl.className = 'sc-jt-key';
    keyEl.textContent = isArray ? `${key}: ` : `${key}: `;

    row.appendChild(keyEl);
    row.appendChild(renderJsonTree(val, collapseDepth, depth + 1));
    container.appendChild(row);
  }
}

function safeKeys(obj: Record<string, unknown>): string[] {
  try {
    return Object.keys(obj);
  } catch {
    return [];
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ─── SVG icons (inline strings for vanilla DOM) ─────────────────────────────

const ICON_BRACES = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>`;

const ICON_EXTERNAL_LINK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;

const ICON_CLOSE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

// ─── Overlay styles (injected into shadow DOM) ──────────────────────────────

const OVERLAY_STYLES = `
/* ── Chain popover ────────────────────────────────────────────────────────── */
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
.sc-ext-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 5px;
  color: #6b7280;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.1s, color 0.1s;
}
.sc-ext-icon-btn:hover {
  background-color: #e5e7eb;
  color: #1f2937;
}

/* ── Props popup ─────────────────────────────────────────────────────────── */
.sc-ext-props-popup {
  position: fixed;
  z-index: 2147483647;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 10px 25px -5px rgba(0,0,0,.15), 0 4px 10px -4px rgba(0,0,0,.08);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: #1f2937;
  pointer-events: auto;
}
.sc-ext-props-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #f3f4f6;
  border-bottom: 1px solid #e5e7eb;
  cursor: move;
  user-select: none;
  flex-shrink: 0;
}
.sc-ext-props-title {
  font-weight: 600;
  font-size: 13px;
}
.sc-ext-props-body {
  flex: 1;
  overflow: auto;
  padding: 10px;
  overscroll-behavior: contain;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}
.sc-ext-resize-se {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  z-index: 1;
}
.sc-ext-resize-se::after {
  content: '';
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 8px;
  height: 8px;
  background:
    linear-gradient(135deg, transparent 50%, #94a3b8 50%, #94a3b8 55%, transparent 55%,
      transparent 65%, #94a3b8 65%, #94a3b8 70%, transparent 70%,
      transparent 80%, #94a3b8 80%, #94a3b8 85%, transparent 85%);
  opacity: 0.4;
  transition: opacity 0.15s;
  pointer-events: none;
}
.sc-ext-resize-se:hover::after {
  opacity: 0.8;
}

/* ── JSON tree ───────────────────────────────────────────────────────────── */
.sc-jt-node { }
.sc-jt-toggle {
  display: inline-block;
  width: 14px;
  font-size: 9px;
  color: #9ca3af;
  cursor: pointer;
  user-select: none;
  text-align: center;
  vertical-align: middle;
}
.sc-jt-toggle:hover { color: #374151; }
.sc-jt-head { color: #6b7280; }
.sc-jt-brace { color: #6b7280; }
.sc-jt-children { padding-left: 16px; }
.sc-jt-entry { white-space: nowrap; }
.sc-jt-key { color: #7c3aed; }
.sc-jt-leaf { }
.sc-jt-null { color: #9ca3af; }
.sc-jt-undef { color: #9ca3af; font-style: italic; }
.sc-jt-bool { color: #2563eb; }
.sc-jt-num { color: #059669; }
.sc-jt-str { color: #dc2626; }
.sc-jt-fn { color: #9ca3af; font-style: italic; }
.sc-jt-sym { color: #d97706; }
`;
