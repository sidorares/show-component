import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { normalizeOrigin, originToMatchPattern } from '../shared/origins';
import { type ExtensionOptions, loadOptions, saveOptions } from '../shared/storage';

type ReactBuild = 'checking' | 'development' | 'production' | 'none' | 'unknown';

interface SiteAccess {
  tabId: number;
  origin: string;
  pattern: string;
  granted: boolean;
}

/** Runs in the page (MAIN world). Must be self-contained — it is serialized. */
function detectReactBuild(): 'development' | 'production' | 'none' {
  for (const node of document.querySelectorAll('*')) {
    const key = Object.getOwnPropertyNames(node).find((p) => p.startsWith('__reactFiber'));
    if (!key) continue;
    // Development builds define the _debug* fields on every fiber.
    const fiber = (node as unknown as Record<string, object>)[key];
    return '_debugOwner' in fiber ? 'development' : 'production';
  }
  return 'none';
}

const REACT_BADGE: Record<ReactBuild, { text: string; bg: string; fg: string }> = {
  checking: { text: 'Checking...', bg: '#e5e7eb', fg: '#6b7280' },
  development: { text: 'Development build', bg: '#dcfce7', fg: '#166534' },
  production: { text: 'Production build', bg: '#fef3c7', fg: '#92400e' },
  none: { text: 'Not found', bg: '#fee2e2', fg: '#991b1b' },
  unknown: { text: 'Unknown', bg: '#e5e7eb', fg: '#6b7280' },
};

function PopupApp() {
  const [opts, setOpts] = useState<ExtensionOptions | null>(null);
  const [reactBuild, setReactBuild] = useState<ReactBuild>('checking');
  // undefined: still loading; null: not an http(s) page
  const [site, setSite] = useState<SiteAccess | null | undefined>(undefined);

  useEffect(() => {
    loadOptions().then(setOpts);

    // Opening the popup grants activeTab, so this works even on sites the
    // extension has no host permission for.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id === undefined) return;
      const tabId = tab.id;

      const origin = tab.url ? normalizeOrigin(tab.url) : null;
      const pattern = origin ? originToMatchPattern(origin) : null;
      if (origin && pattern) {
        chrome.permissions
          .contains({ origins: [pattern] })
          .then((granted) => setSite({ tabId, origin, pattern, granted }));
      } else {
        setSite(null);
      }

      chrome.scripting
        .executeScript({ target: { tabId }, func: detectReactBuild, world: 'MAIN' })
        .then((results) => setReactBuild(results?.[0]?.result ?? 'unknown'))
        .catch(() => setReactBuild('unknown'));
    });
  }, []);

  const toggleEnabled = useCallback(async () => {
    if (!opts) return;
    const newEnabled = !opts.enabled;
    await saveOptions({ enabled: newEnabled });
    setOpts((prev) => (prev ? { ...prev, enabled: newEnabled } : prev));
  }, [opts]);

  const enableOnSite = useCallback(async () => {
    if (!site) return;
    // On some platforms the popup closes while Chrome shows the prompt; the
    // background picks up the new permission either way via permissions.onAdded.
    const granted = await chrome.permissions.request({ origins: [site.pattern] });
    if (!granted) return;
    chrome.runtime.sendMessage({ type: 'RELOAD_AFTER_SYNC', tabId: site.tabId });
    window.close();
  }, [site]);

  if (!opts) {
    return <div style={s.loading}>Loading...</div>;
  }

  const badge = REACT_BADGE[reactBuild];
  const siteBadge =
    site === undefined
      ? { text: 'Checking...', bg: '#e5e7eb', fg: '#6b7280' }
      : site === null
        ? { text: 'Unavailable', bg: '#e5e7eb', fg: '#6b7280' }
        : site.granted
          ? { text: 'Active', bg: '#dcfce7', fg: '#166534' }
          : { text: 'Not enabled', bg: '#fef3c7', fg: '#92400e' };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.logo}>{'{ }'}</span>
        <span style={s.headerTitle}>Show Component</span>
      </div>

      {/* Status */}
      <div style={s.statusRow}>
        <span style={s.statusLabel}>Status</span>
        <button
          type="button"
          onClick={toggleEnabled}
          style={{
            ...s.toggleBtn,
            background: opts.enabled ? '#16a34a' : '#9ca3af',
          }}
        >
          {opts.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {/* Site access */}
      <div style={s.statusRow}>
        <span style={s.statusLabel}>This site</span>
        <span style={{ ...s.badge, background: siteBadge.bg, color: siteBadge.fg }}>
          {siteBadge.text}
        </span>
      </div>

      {/* React detection */}
      <div style={s.statusRow}>
        <span style={s.statusLabel}>React on page</span>
        <span style={{ ...s.badge, background: badge.bg, color: badge.fg }}>{badge.text}</span>
      </div>

      {site && !site.granted && (
        <div style={s.notice}>
          Show Component doesn't run on <strong>{site.origin}</strong> yet.
          <button type="button" style={s.enableBtn} onClick={enableOnSite}>
            Enable on this site
          </button>
        </div>
      )}
      {site === null && <div style={s.notice}>Show Component only works on http(s) pages.</div>}
      {reactBuild === 'production' && (
        <div style={s.notice}>
          This page runs a production build of React. Source navigation needs a development build.
        </div>
      )}

      {/* Current config summary */}
      <div style={s.configRow}>
        <span style={s.configLabel}>Editor:</span>
        <span style={s.configValue}>{opts.editorScheme}</span>
      </div>
      {opts.sourceRoot && (
        <div style={s.configRow}>
          <span style={s.configLabel}>Root:</span>
          <span style={{ ...s.configValue, fontSize: 11 }}>
            {opts.sourceRoot.length > 30 ? `...${opts.sourceRoot.slice(-30)}` : opts.sourceRoot}
          </span>
        </div>
      )}

      {/* Usage hint */}
      <div style={s.hint}>
        <strong>Alt + Right-Click</strong> an element to navigate to its source.
        <br />
        <strong>Alt + Shift + Right-Click</strong> to show the full component chain.
      </div>

      {/* Options link */}
      <button type="button" style={s.optionsBtn} onClick={() => chrome.runtime.openOptionsPage()}>
        Open Options
      </button>
    </div>
  );
}

const s = {
  container: {
    padding: 0,
  } as const,
  loading: {
    padding: 16,
    textAlign: 'center' as const,
    color: '#6b7280',
  } as const,
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb',
  } as const,
  logo: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 16,
    fontWeight: 700,
    color: '#2563eb',
  } as const,
  headerTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#111827',
  } as const,
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
  } as const,
  statusLabel: {
    fontSize: 12,
    color: '#6b7280',
  } as const,
  toggleBtn: {
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
  } as const,
  badge: {
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 10,
  } as const,
  notice: {
    margin: '4px 12px 8px',
    padding: '8px 10px',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 6,
    fontSize: 11,
    lineHeight: 1.5,
    color: '#78350f',
    wordBreak: 'break-word' as const,
  } as const,
  enableBtn: {
    display: 'block',
    width: '100%',
    marginTop: 6,
    padding: '6px 0',
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    background: '#2563eb',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  } as const,
  configRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 12px',
  } as const,
  configLabel: {
    fontSize: 11,
    color: '#9ca3af',
  } as const,
  configValue: {
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    color: '#374151',
  } as const,
  hint: {
    margin: '10px 12px',
    padding: '8px 10px',
    background: '#f9fafb',
    borderRadius: 6,
    fontSize: 11,
    lineHeight: 1.5,
    color: '#4b5563',
  } as const,
  optionsBtn: {
    display: 'block',
    width: 'calc(100% - 24px)',
    margin: '0 12px 12px',
    padding: '7px 0',
    fontSize: 12,
    fontWeight: 600,
    color: '#2563eb',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 6,
    cursor: 'pointer',
    textAlign: 'center' as const,
  } as const,
} as const;

// ─── Mount ───────────────────────────────────────────────────────────────────

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<PopupApp />);
}
