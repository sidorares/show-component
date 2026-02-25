import React, { lazy, Suspense, useCallback, useState } from 'react';
import { IntlProvider } from 'react-intl';
import { ShowComponent } from 'show-component';
import { createFormattedMessageTransformer } from 'show-component/transformers/formatted-message';
import type { NavigationEvent } from 'show-component';
import { BasicButton, ArrowButton, CardWithContent } from './scenarios/BasicComponents';
import { ForwardRefInput, MemoizedCard, DisplayNameComponent } from './scenarios/WrappedComponents';
import { DeepChainRoot } from './scenarios/DeepChain';
import { AnonymousDefault, InlineAnonymous } from './scenarios/AnonymousComponents';
import { EnhancedButton, EnhancedCard } from './scenarios/HOCPattern';
import { DynamicImportScenario } from './scenarios/DynamicImport';
import { WelcomeBanner } from './scenarios/IntlBasicMessage';
import { PersonalGreeting } from './scenarios/IntlGreeting';
import { NotificationBadge } from './scenarios/IntlPluralMessage';
import { TestRunner } from './test-runner/TestRunner';

const fmTransformer = createFormattedMessageTransformer();

// ─── Navigation event capture ───────────────────────────────────────────────
// Stores every navigation event the library would have fired so that:
//   1. browser_console_messages  → can read them via console.log
//   2. browser_evaluate          → can read window.__sc_nav_events
//   3. The visible event log     → humans can inspect in the UI

declare global {
  interface Window {
    __sc_nav_events: NavigationEvent[];
  }
}
window.__sc_nav_events = [];

// ─── Ground truth manifest ──────────────────────────────────────────────────
// This is THE source of truth. Every test case is registered here.
// The TestRunner reads data-sc-* attrs from the DOM, detects via fibers,
// and compares against these expected values.

export const TEST_MANIFEST = [
  // Basic components
  { testId: 'basic-named-fn',      expectOwner: 'BasicButton',           expectFile: 'scenarios/BasicComponents.tsx' },
  { testId: 'basic-arrow-fn',      expectOwner: 'ArrowButton',           expectFile: 'scenarios/BasicComponents.tsx' },
  { testId: 'basic-card-root',     expectOwner: 'CardWithContent',       expectFile: 'scenarios/BasicComponents.tsx' },
  { testId: 'basic-card-paragraph',expectOwner: 'CardWithContent',       expectFile: 'scenarios/BasicComponents.tsx' },

  // Wrapped types
  { testId: 'wrapped-forward-ref', expectOwner: 'ForwardRefInput',       expectFile: 'scenarios/WrappedComponents.tsx' },
  { testId: 'wrapped-memo',        expectOwner: 'MemoizedCard',          expectFile: 'scenarios/WrappedComponents.tsx' },
  { testId: 'wrapped-display-name',expectOwner: 'DisplayNameComponent',  expectFile: 'scenarios/WrappedComponents.tsx' },

  // Deep chain (5 levels)
  { testId: 'deep-chain-leaf',     expectOwner: 'LevelD',               expectFile: 'scenarios/DeepChain.tsx',
    expectChain: 'LevelD,LevelC,LevelB,LevelA,DeepChainRoot' },

  // Anonymous components
  { testId: 'anon-default-export', expectOwner: 'AnonymousDefault',      expectFile: 'scenarios/AnonymousComponents.tsx' },
  { testId: 'anon-inline',         expectOwner: 'InlineAnonymous',       expectFile: 'scenarios/AnonymousComponents.tsx' },

  // HOC pattern
  { testId: 'hoc-button',          expectOwner: 'BaseButton',            expectFile: 'scenarios/HOCPattern.tsx' },
  { testId: 'hoc-card',            expectOwner: 'BaseCard',              expectFile: 'scenarios/HOCPattern.tsx' },

  // Dynamic import (lazy)
  { testId: 'dynamic-lazy',        expectOwner: 'LazyTarget',            expectFile: 'scenarios/LazyTarget.tsx' },

  // Multi-root (on separate page /multi-root.html)
  { testId: 'multi-root-1-button', expectOwner: 'PrimaryButton',         expectFile: 'main-multi-root.tsx' },
  { testId: 'multi-root-2-button', expectOwner: 'SecondaryButton',       expectFile: 'main-multi-root.tsx' },
] as const;

// ─── App ────────────────────────────────────────────────────────────────────

export function App() {
  const [scEnabled, setScEnabled] = useState(true);
  const handleNavigate = useCallback((event: NavigationEvent) => {
    window.__sc_nav_events.push(event);
    // Structured log easily parsed by browser_console_messages
    console.log('[sc:navigate]', JSON.stringify(event));
  }, []);

  return (
    <>
      {scEnabled && (
        <ShowComponent
          onNavigate={handleNavigate}
          sourceRoot="/Users/laplace/Projects/show-component/test-app"
          chainTransformer={fmTransformer}
        />
      )}

      <header className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0 }}>show-component — Test Harness</h1>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ opacity: scEnabled ? 1 : 0.5 }}>ShowComponent {scEnabled ? 'ON' : 'OFF'}</span>
            <input
              type="checkbox"
              checked={scEnabled}
              onChange={(e) => setScEnabled(e.target.checked)}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
          </label>
        </div>
        <p>
          Every bordered box below is a test case. DOM elements carry{' '}
          <code>data-sc-test-id</code>, <code>data-sc-expect-owner</code>, and{' '}
          <code>data-sc-expect-file</code> attributes as ground truth.
        </p>
        <p style={{ marginTop: 4 }}>
          <a href="/multi-root.html" className="back-link">→ Multi-root test page</a>
        </p>
      </header>

      <div className="instructions">
        <strong>Manual testing:</strong>{' '}
        <kbd>Alt</kbd>+<kbd>Right Click</kbd> on any element to jump to its source.{' '}
        <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Right Click</kbd> to see the full ownership chain.
      </div>

      {/* ── Automated test runner ────────────────────────────────────────── */}
      <TestRunner />

      {/* ── Scenario sections ────────────────────────────────────────────── */}
      <div className="scenario-grid">

        {/* 1. Basic Components */}
        <section className="scenario-section" id="scenario-basic">
          <div className="scenario-header">
            Basic Components <span className="tag">function / arrow</span>
          </div>
          <div className="scenario-body">
            <div className="test-case" data-sc-test-id="basic-named-fn">
              <BasicButton />
              <span className="test-case-meta">expect owner: BasicButton</span>
            </div>
            <div className="test-case" data-sc-test-id="basic-arrow-fn">
              <ArrowButton />
              <span className="test-case-meta">expect owner: ArrowButton</span>
            </div>
            <div className="test-case" data-sc-test-id="basic-card-root">
              <CardWithContent />
              <span className="test-case-meta">expect owner: CardWithContent (two test IDs inside)</span>
            </div>
          </div>
        </section>

        {/* 2. Wrapped Types */}
        <section className="scenario-section" id="scenario-wrapped">
          <div className="scenario-header">
            Wrapped Types <span className="tag">forwardRef / memo / displayName</span>
          </div>
          <div className="scenario-body">
            <div className="test-case" data-sc-test-id="wrapped-forward-ref">
              <ForwardRefInput placeholder="forwardRef input" />
              <span className="test-case-meta">expect owner: ForwardRefInput</span>
            </div>
            <div className="test-case" data-sc-test-id="wrapped-memo">
              <MemoizedCard title="Memoized Card Content" />
              <span className="test-case-meta">expect owner: MemoizedCard</span>
            </div>
            <div className="test-case" data-sc-test-id="wrapped-display-name">
              <DisplayNameComponent />
              <span className="test-case-meta">expect owner: DisplayNameComponent</span>
            </div>
          </div>
        </section>

        {/* 3. Deep Nesting */}
        <section className="scenario-section" id="scenario-deep">
          <div className="scenario-header">
            Deep Nesting <span className="tag">5-level ownership chain</span>
          </div>
          <div className="scenario-body">
            <div className="test-case" style={{ width: '100%' }}>
              <DeepChainRoot />
              <span className="test-case-meta">
                expect chain: LevelD → LevelC → LevelB → LevelA → DeepChainRoot
              </span>
            </div>
          </div>
        </section>

        {/* 4. Anonymous Components */}
        <section className="scenario-section" id="scenario-anonymous">
          <div className="scenario-header">
            Anonymous Components <span className="tag">edge cases</span>
          </div>
          <div className="scenario-body">
            <div className="test-case" data-sc-test-id="anon-default-export">
              <AnonymousDefault />
              <span className="test-case-meta">expect owner: AnonymousDefault</span>
            </div>
            <div className="test-case" data-sc-test-id="anon-inline">
              <InlineAnonymous />
              <span className="test-case-meta">expect owner: InlineAnonymous</span>
            </div>
          </div>
        </section>

        {/* 5. HOC Pattern */}
        <section className="scenario-section" id="scenario-hoc">
          <div className="scenario-header">
            Higher-Order Components <span className="tag">withLogger HOC</span>
          </div>
          <div className="scenario-body">
            <div className="test-case" data-sc-test-id="hoc-button">
              <EnhancedButton label="HOC-Wrapped Button" />
              <span className="test-case-meta">expect owner: BaseButton (inner)</span>
            </div>
            <div className="test-case" data-sc-test-id="hoc-card">
              <EnhancedCard title="HOC-Wrapped Card" />
              <span className="test-case-meta">expect owner: BaseCard (inner)</span>
            </div>
          </div>
        </section>

        {/* 6. Dynamic Import */}
        <section className="scenario-section" id="scenario-dynamic">
          <div className="scenario-header">
            Dynamic Import <span className="tag">React.lazy / code splitting</span>
          </div>
          <div className="scenario-body">
            <div className="test-case" style={{ width: '100%' }}>
              <DynamicImportScenario />
              <span className="test-case-meta">expect owner: LazyTarget (after load)</span>
            </div>
          </div>
        </section>

        {/* 7. Intl / FormattedMessage */}
        <section className="scenario-section" id="scenario-intl">
          <div className="scenario-header">
            FormattedMessage <span className="tag">react-intl chain transformer</span>
          </div>
          <div className="scenario-body">
            <IntlProvider locale="en" defaultLocale="en">
              <div className="test-case" data-sc-test-id="intl-basic">
                <WelcomeBanner />
                <span className="test-case-meta">
                  transformer collapses span → FormattedMessage to message text
                </span>
              </div>
              <div className="test-case" data-sc-test-id="intl-greeting">
                <PersonalGreeting name="Alice" />
                <span className="test-case-meta">
                  message with &#123;name&#125; interpolation
                </span>
              </div>
              <div className="test-case" data-sc-test-id="intl-plural">
                <NotificationBadge count={5} />
                <span className="test-case-meta">
                  ICU plural syntax
                </span>
              </div>
            </IntlProvider>
          </div>
        </section>
      </div>

      {/* ── Ground truth manifest (always visible) ───────────────────────── */}
      <div className="manifest" id="ground-truth-manifest">
        <div className="manifest-header">
          Ground Truth Manifest — {TEST_MANIFEST.length} test cases
        </div>
        <table className="manifest-table">
          <thead>
            <tr>
              <th>Test ID</th>
              <th>Expected Owner</th>
              <th>Expected File</th>
              <th>Expected Chain</th>
            </tr>
          </thead>
          <tbody>
            {TEST_MANIFEST.map((entry) => (
              <tr key={entry.testId}>
                <td>{entry.testId}</td>
                <td>{entry.expectOwner}</td>
                <td>{entry.expectFile}</td>
                <td>{'expectChain' in entry ? entry.expectChain : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* JSON version for programmatic access */}
      <script
        type="application/json"
        id="sc-manifest-json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(TEST_MANIFEST, null, 2) }}
      />
    </>
  );
}
