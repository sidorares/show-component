/**
 * ISOLATED world content script — can use chrome.* APIs but cannot
 * access page JS. Acts as a relay between the MAIN world script
 * (via window.postMessage) and the background service worker
 * (via chrome.runtime.sendMessage).
 */

import { MSG_SOURCE, isExtensionMessage } from '../shared/messaging';
import type { GetOptionsResponse } from '../shared/messaging';

// ─── Forward options to MAIN world ───────────────────────────────────────────

async function sendOptionsToPage(): Promise<void> {
  const opts: GetOptionsResponse = await chrome.runtime.sendMessage({
    type: 'GET_OPTIONS',
  });
  window.postMessage({ source: MSG_SOURCE, type: 'OPTIONS_UPDATE', payload: opts }, '*');
}

// ─── Listen for messages from MAIN world ─────────────────────────────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!isExtensionMessage(event.data)) return;

  const { type, payload } = event.data;

  if (type === 'REQUEST_OPTIONS') {
    sendOptionsToPage();
    return;
  }

  if (type === 'RESOLVED_LOCATION' && payload) {
    const loc = payload as {
      source: string;
      line: number;
      column: number;
      componentName?: string;
    };

    chrome.runtime
      .sendMessage({
        type: 'GET_OPTIONS',
      })
      .then((opts: GetOptionsResponse) => {
        const editorScheme = opts.editorScheme || 'cursor';
        chrome.runtime.sendMessage({
          type: 'OPEN_EDITOR',
          payload: {
            source: loc.source,
            line: loc.line,
            column: loc.column,
            editorScheme,
          },
        });
      });
    return;
  }
});

// ─── Listen for messages from background (e.g. context menu trigger) ─────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TRIGGER_INSPECT') {
    window.postMessage({ source: MSG_SOURCE, type: 'TRIGGER_INSPECT' }, '*');
  }
});

// ─── Re-sync options when storage changes ────────────────────────────────────

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === 'sync') {
    sendOptionsToPage();
  }
});

// Initial options push
sendOptionsToPage();
