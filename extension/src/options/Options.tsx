import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_OPTIONS,
  type ExtensionOptions,
  loadOptions,
  saveOptions,
} from '../shared/storage';

const EDITOR_PRESETS = [
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'vscode-insiders', label: 'VS Code Insiders' },
  { value: 'windsurf', label: 'Windsurf' },
] as const;

function OptionsApp() {
  const [opts, setOpts] = useState<ExtensionOptions>(DEFAULT_OPTIONS);
  const [saved, setSaved] = useState(false);
  const [customScheme, setCustomScheme] = useState(false);

  useEffect(() => {
    loadOptions().then((loaded) => {
      setOpts(loaded);
      setCustomScheme(!EDITOR_PRESETS.some((p) => p.value === loaded.editorScheme));
    });
  }, []);

  const handleSave = useCallback(async () => {
    await saveOptions(opts);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [opts]);

  const update = <K extends keyof ExtensionOptions>(key: K, value: ExtensionOptions[K]) => {
    setOpts((prev) => ({ ...prev, [key]: value }));
  };

  const parseList = (value: string): string[] =>
    value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Show Component Options</h1>

      {/* Source Root */}
      <Section
        label="Source Root"
        hint="Absolute path to the project root, used to resolve source map paths to files your editor can open."
      >
        <input
          type="text"
          style={styles.input}
          placeholder="/Users/me/my-project"
          value={opts.sourceRoot}
          onChange={(e) => update('sourceRoot', e.target.value)}
        />
      </Section>

      {/* Editor Scheme */}
      <Section label="Editor" hint="Protocol scheme for opening files.">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {EDITOR_PRESETS.map((preset) => (
            <label key={preset.value} style={styles.radioLabel}>
              <input
                type="radio"
                name="editorScheme"
                checked={!customScheme && opts.editorScheme === preset.value}
                onChange={() => {
                  setCustomScheme(false);
                  update('editorScheme', preset.value);
                }}
              />
              {preset.label}
            </label>
          ))}
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="editorScheme"
              checked={customScheme}
              onChange={() => setCustomScheme(true)}
            />
            Custom
          </label>
        </div>
        {customScheme && (
          <input
            type="text"
            style={{ ...styles.input, marginTop: 6 }}
            placeholder="my-editor"
            value={opts.editorScheme}
            onChange={(e) => update('editorScheme', e.target.value)}
          />
        )}
      </Section>

      {/* Component Disallow List */}
      <Section
        label="Component Disallow List"
        hint="Component names to hide from the chain (one per line). Useful for wrapper components you never want to navigate to."
      >
        <textarea
          style={styles.textarea}
          placeholder={'React.Fragment\nStyled(Box)\nForwardRef(Anonymous)'}
          value={opts.componentDisallowList.join('\n')}
          onChange={(e) => update('componentDisallowList', parseList(e.target.value))}
          rows={4}
        />
      </Section>

      {/* Folder/Package Disallow List */}
      <Section
        label="Folder / Package Disallow List"
        hint="Folder or package paths to filter out (one per line). Components whose source resolves to these paths are hidden. Useful for packages that don't ship original source."
      >
        <textarea
          style={styles.textarea}
          placeholder={'node_modules/@radix-ui\nnode_modules/@emotion'}
          value={opts.folderDisallowList.join('\n')}
          onChange={(e) => update('folderDisallowList', parseList(e.target.value))}
          rows={4}
        />
      </Section>

      {/* Merge Consecutive */}
      <Section label="Chain Display">
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={opts.mergeConsecutive}
            onChange={(e) => update('mergeConsecutive', e.target.checked)}
          />
          Collapse consecutive components with the same name
        </label>
      </Section>

      {/* Enabled Origins */}
      <Section
        label="Enabled Origins"
        hint="Leave empty to enable on all origins. Otherwise, list origins where the extension should be active (one per line)."
      >
        <textarea
          style={styles.textarea}
          placeholder={'http://localhost:3000\nhttps://staging.example.com'}
          value={opts.enabledOrigins.join('\n')}
          onChange={(e) => update('enabledOrigins', parseList(e.target.value))}
          rows={3}
        />
      </Section>

      {/* Debug */}
      <Section label="Debugging">
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={opts.debug}
            onChange={(e) => update('debug', e.target.checked)}
          />
          Enable verbose console logging for source-map resolution
        </label>
      </Section>

      {/* Save */}
      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" style={styles.saveBtn} onClick={handleSave}>
          Save Options
        </button>
        {saved && <span style={{ color: '#16a34a', fontSize: 13 }}>Saved</span>}
      </div>
    </div>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.section}>
      <span style={styles.label}>{label}</span>
      {hint && <p style={styles.hint}>{hint}</p>}
      {children}
    </div>
  );
}

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  } as const,
  title: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 24,
    color: '#111827',
  } as const,
  section: {
    marginBottom: 20,
  } as const,
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 4,
  } as const,
  hint: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
    lineHeight: 1.4,
  } as const,
  input: {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    outline: 'none',
    color: '#1f2937',
    background: '#fff',
  } as const,
  textarea: {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    outline: 'none',
    color: '#1f2937',
    background: '#fff',
    resize: 'vertical' as const,
    lineHeight: 1.5,
  } as const,
  radioLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
    cursor: 'pointer',
  } as const,
  checkboxLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    cursor: 'pointer',
  } as const,
  saveBtn: {
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    background: '#2563eb',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  } as const,
} as const;

// ─── Mount ───────────────────────────────────────────────────────────────────

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<OptionsApp />);
}
