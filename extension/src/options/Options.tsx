import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TRANSFORMER_PRESETS } from '../../../src/transformers/transformer-rule';
import type { TransformerRule } from '../../../src/transformers/transformer-rule';
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

      {/* Transformers */}
      <Section
        label="Transformers"
        hint="Automatically transform component chains to show more useful labels and navigate to specific prop values."
      >
        <TransformersConfig
          enabledTransformers={opts.enabledTransformers}
          customRules={opts.customTransformerRules}
          onChangeEnabled={(ids) => update('enabledTransformers', ids)}
          onChangeCustom={(rules) => update('customTransformerRules', rules)}
        />
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

// ─── Transformers config ──────────────────────────────────────────────────────

const EMPTY_CUSTOM_RULE: Omit<TransformerRule, 'id'> = {
  name: '',
  componentName: '',
  labelProp: '',
  navigateToProp: '',
  matchStrategy: 'childFiber',
};

function TransformersConfig({
  enabledTransformers,
  customRules,
  onChangeEnabled,
  onChangeCustom,
}: {
  enabledTransformers: string[];
  customRules: TransformerRule[];
  onChangeEnabled: (ids: string[]) => void;
  onChangeCustom: (rules: TransformerRule[]) => void;
}) {
  const [draft, setDraft] = useState<Omit<TransformerRule, 'id'>>(EMPTY_CUSTOM_RULE);

  const togglePreset = (id: string) => {
    onChangeEnabled(
      enabledTransformers.includes(id)
        ? enabledTransformers.filter((t) => t !== id)
        : [...enabledTransformers, id]
    );
  };

  const addCustomRule = () => {
    if (!draft.componentName.trim() || !draft.labelProp.trim()) return;
    const rule: TransformerRule = {
      ...draft,
      id: `custom-${Date.now()}`,
      name: draft.name || `${draft.componentName} → ${draft.labelProp}`,
      navigateToProp: draft.navigateToProp || draft.labelProp,
    };
    onChangeCustom([...customRules, rule]);
    setDraft(EMPTY_CUSTOM_RULE);
  };

  const removeCustomRule = (id: string) => {
    onChangeCustom(customRules.filter((r) => r.id !== id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Presets */}
      <div>
        <span style={{ ...styles.label, fontSize: 12, marginBottom: 6, display: 'block' }}>
          Built-in Presets
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.values(TRANSFORMER_PRESETS).map((preset) => (
            <label key={preset.id} style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={enabledTransformers.includes(preset.id)}
                onChange={() => togglePreset(preset.id)}
              />
              <span>
                {preset.name}
                <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 6 }}>
                  {preset.componentName} → {preset.labelProp}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Custom rules list */}
      {customRules.length > 0 && (
        <div>
          <span style={{ ...styles.label, fontSize: 12, marginBottom: 6, display: 'block' }}>
            Custom Rules
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {customRules.map((rule) => (
              <div
                key={rule.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 8px',
                  background: '#f9fafb',
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                }}
              >
                <span style={{ flex: 1 }}>
                  {rule.componentName} → {rule.labelProp}
                  <span style={{ color: '#9ca3af', marginLeft: 6 }}>({rule.matchStrategy})</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeCustomRule(rule.id)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#ef4444',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: '2px 4px',
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add custom rule form */}
      <div>
        <span style={{ ...styles.label, fontSize: 12, marginBottom: 6, display: 'block' }}>
          Add Custom Rule
        </span>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            padding: 10,
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            background: '#fafafa',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Component Name *</span>
            <input
              type="text"
              style={{ ...styles.input, fontSize: 12, padding: '5px 8px' }}
              placeholder="FormattedMessage"
              value={draft.componentName}
              onChange={(e) => setDraft({ ...draft, componentName: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Label Prop *</span>
            <input
              type="text"
              style={{ ...styles.input, fontSize: 12, padding: '5px 8px' }}
              placeholder="defaultMessage"
              value={draft.labelProp}
              onChange={(e) => setDraft({ ...draft, labelProp: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Navigate to Prop</span>
            <input
              type="text"
              style={{ ...styles.input, fontSize: 12, padding: '5px 8px' }}
              placeholder="(same as label prop)"
              value={draft.navigateToProp}
              onChange={(e) => setDraft({ ...draft, navigateToProp: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Match Strategy</span>
            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
              <label style={{ ...styles.radioLabel, fontSize: 12 }}>
                <input
                  type="radio"
                  name="matchStrategy"
                  checked={draft.matchStrategy === 'childFiber'}
                  onChange={() => setDraft({ ...draft, matchStrategy: 'childFiber' })}
                />
                Child Fiber
              </label>
              <label style={{ ...styles.radioLabel, fontSize: 12 }}>
                <input
                  type="radio"
                  name="matchStrategy"
                  checked={draft.matchStrategy === 'direct'}
                  onChange={() => setDraft({ ...draft, matchStrategy: 'direct' })}
                />
                Direct
              </label>
            </div>
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={addCustomRule}
              disabled={!draft.componentName.trim() || !draft.labelProp.trim()}
              style={{
                ...styles.saveBtn,
                padding: '5px 14px',
                fontSize: 12,
                opacity: !draft.componentName.trim() || !draft.labelProp.trim() ? 0.5 : 1,
              }}
            >
              + Add Rule
            </button>
          </div>
        </div>
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
