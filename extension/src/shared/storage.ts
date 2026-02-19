export interface ExtensionOptions {
  enabled: boolean;
  sourceRoot: string;
  editorScheme: string;
  debug: boolean;
  componentDisallowList: string[];
  folderDisallowList: string[];
  mergeConsecutive: boolean;
  enabledOrigins: string[];
}

export const DEFAULT_OPTIONS: ExtensionOptions = {
  enabled: true,
  sourceRoot: '',
  editorScheme: 'cursor',
  debug: false,
  componentDisallowList: [],
  folderDisallowList: [],
  mergeConsecutive: false,
  enabledOrigins: [],
};

export async function loadOptions(): Promise<ExtensionOptions> {
  const stored = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  return { ...DEFAULT_OPTIONS, ...stored } as ExtensionOptions;
}

export async function saveOptions(opts: Partial<ExtensionOptions>): Promise<void> {
  await chrome.storage.sync.set(opts);
}

export function onOptionsChanged(
  callback: (changes: Partial<ExtensionOptions>) => void
): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName !== 'sync') return;
    const partial: Partial<ExtensionOptions> = {};
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_OPTIONS) {
        (partial as Record<string, unknown>)[key] = change.newValue;
      }
    }
    if (Object.keys(partial).length > 0) {
      callback(partial);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
