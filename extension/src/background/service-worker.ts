import type { BridgeToBackgroundMessage, GetOptionsResponse } from '../shared/messaging';
import { loadOptions } from '../shared/storage';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'show-component-chain',
    title: 'Show Component Chain',
    contexts: ['page', 'selection', 'link', 'image'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'show-component-chain') return;
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_INSPECT' });
});

chrome.runtime.onMessage.addListener(
  (
    message: BridgeToBackgroundMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message.type === 'GET_OPTIONS') {
      loadOptions().then((opts) => {
        const response: GetOptionsResponse = {
          enabled: opts.enabled,
          sourceRoot: opts.sourceRoot,
          editorScheme: opts.editorScheme,
          debug: opts.debug,
          componentDisallowList: opts.componentDisallowList,
          folderDisallowList: opts.folderDisallowList,
          mergeConsecutive: opts.mergeConsecutive,
          enabledOrigins: opts.enabledOrigins,
        };
        sendResponse(response);
      });
      return true;
    }

    if (message.type === 'OPEN_EDITOR') {
      const { source, line, column, editorScheme } = message.payload;
      let cleanPath = source.replace(/^file:\/\//, '');
      cleanPath = decodeURIComponent(cleanPath);
      if (!cleanPath.startsWith('/')) {
        cleanPath = `/${cleanPath}`;
      }
      const encodedPath = cleanPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const url = `${editorScheme}://file${encodedPath}:${line}:${column}`;

      chrome.tabs.update({ url });
      sendResponse({ ok: true });
      return false;
    }

    return false;
  }
);
