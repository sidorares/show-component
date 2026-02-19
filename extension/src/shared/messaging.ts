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

export interface GetOptionsResponse {
  enabled: boolean;
  sourceRoot: string;
  editorScheme: string;
  debug: boolean;
  componentDisallowList: string[];
  folderDisallowList: string[];
  mergeConsecutive: boolean;
  enabledOrigins: string[];
}

export interface OpenEditorRequest {
  type: 'OPEN_EDITOR';
  payload: {
    source: string;
    line: number;
    column: number;
    editorScheme: string;
  };
}

export type BridgeToBackgroundMessage = GetOptionsRequest | OpenEditorRequest;

// ─── Background → Bridge (response) ─────────────────────────────────────────

export interface PageMessage {
  source: typeof MSG_SOURCE;
  type: string;
  payload?: unknown;
}

export function isExtensionMessage(data: unknown): data is PageMessage {
  return typeof data === 'object' && data !== null && (data as PageMessage).source === MSG_SOURCE;
}
