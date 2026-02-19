import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type ExtensionOptions, loadOptions, saveOptions } from '../shared/storage';

function PopupApp() {
  const [opts, setOpts] = useState<ExtensionOptions | null>(null);
  const [reactDetected, setReactDetected] = useState<boolean | null>(null);

  useEffect(() => {
    loadOptions().then(setOpts);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      chrome.scripting
        .executeScript({
          target: { tabId },
          func: () => {
            const el = document.querySelector('[data-reactroot]');
            if (el) return true;
            const allEls = document.querySelectorAll('*');
            for (const node of allEls) {
              const props = Object.getOwnPropertyNames(node);
              if (props.some((p) => p.startsWith('__reactFiber'))) return true;
            }
            return false;
          },
          world: 'MAIN',
        })
        .then((results) => {
          setReactDetected(results?.[0]?.result === true);
        })
        .catch(() => {
          setReactDetected(false);
        });
    });
  }, []);

  const toggleEnabled = useCallback(async () => {
    if (!opts) return;
    const newEnabled = !opts.enabled;
    await saveOptions({ enabled: newEnabled });
    setOpts((prev) => (prev ? { ...prev, enabled: newEnabled } : prev));
  }, [opts]);

  if (!opts) {
    return <div style={s.loading}>Loading...</div>;
  }

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

      {/* React detection */}
      <div style={s.statusRow}>
        <span style={s.statusLabel}>React on page</span>
        <span
          style={{
            ...s.badge,
            background: reactDetected === null ? '#e5e7eb' : reactDetected ? '#dcfce7' : '#fee2e2',
            color: reactDetected === null ? '#6b7280' : reactDetected ? '#166534' : '#991b1b',
          }}
        >
          {reactDetected === null ? 'Checking...' : reactDetected ? 'Detected' : 'Not found'}
        </span>
      </div>

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
