/**
 * Message types exchanged between the MAIN-world content script,
 * the ISOLATED-world bridge, and the background service worker.
 */

export const MSG_SOURCE = 'show-component-ext' as const;

export interface ChainEntry {
  componentName: string;
  stackFrame: string | undefined;
  props: Record<string, unknown> | undefined;
}

// ─── Page → Bridge (window.postMessage) ──────────────────────────────────────

export interface FiberChainMessage {
  source: typeof MSG_SOURCE;
  type: 'FIBER_CHAIN';
  payload: {
    chain: ChainEntry[];
    x: number;
    y: number;
  };
}

export interface ResolvedLocationMessage {
  source: typeof MSG_SOURCE;
  type: 'RESOLVED_LOCATION';
  payload: {
    source: string;
    line: number;
    column: number;
    componentName?: string;
  } | null;
}

// ─── Bridge → Background (chrome.runtime.sendMessage) ────────────────────────

export interface GetOptionsRequest {
  type: 'GET_OPTIONS';
}

import type { TransformerRule } from '../../../src/transformers/transformer-rule';

/**
 * The subset of options the MAIN-world script needs. Anything posted to the
 * page is readable by the page's own scripts, so keep this minimal. The
 * background answers `null` when the extension is disabled or the sender's
 * origin has no host permission.
 */
export interface PageOptions {
  sourceRoot: string;
  debug: boolean;
  componentDisallowList: string[];
  folderDisallowList: string[];
  mergeConsecutive: boolean;
  enabledTransformers: string[];
  customTransformerRules: TransformerRule[];
}

export type GetOptionsResponse = PageOptions | null;

/** The editor scheme is read from storage by the background, never taken from the page. */
export interface OpenEditorRequest {
  type: 'OPEN_EDITOR';
  payload: {
    source: string;
    line: number;
    column: number;
  };
}

/** Popup → background, after the user granted access to the active tab's site. */
export interface ReloadAfterSyncRequest {
  type: 'RELOAD_AFTER_SYNC';
  tabId: number;
}

export type BridgeToBackgroundMessage =
  | GetOptionsRequest
  | OpenEditorRequest
  | ReloadAfterSyncRequest;

// ─── Background → Bridge (response) ─────────────────────────────────────────

export interface PageMessage {
  source: typeof MSG_SOURCE;
  type: string;
  payload?: unknown;
}

export function isExtensionMessage(data: unknown): data is PageMessage {
  return typeof data === 'object' && data !== null && (data as PageMessage).source === MSG_SOURCE;
}
