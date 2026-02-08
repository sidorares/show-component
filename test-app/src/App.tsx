import React, { lazy, Suspense, useCallback } from 'react';
import { ShowComponent } from 'show-component';
import type { NavigationEvent } from 'show-component';
import { BasicButton, ArrowButton, CardWithContent } from './scenarios/BasicComponents';
import { ForwardRefInput, MemoizedCard, DisplayNameComponent } from './scenarios/WrappedComponents';
import { DeepChainRoot } from './scenarios/DeepChain';
import { AnonymousDefault, InlineAnonymous } from './scenarios/AnonymousComponents';
import { EnhancedButton, EnhancedCard } from './scenarios/HOCPattern';
import { DynamicImportScenario } from './scenarios/DynamicImport';
import { TestRunner } from './test-runner/TestRunner';

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
  const handleNavigate = useCallback((event: NavigationEvent) => {
    window.__sc_nav_events.push(event);
    // Structured log easily parsed by browser_console_messages
    console.log('[sc:navigate]', JSON.stringify(event));
  }, []);

  return (
    <>
      {/* The library's invisible overlay — enables Alt+Click / Alt+Shift+Click */}
      {/* sourceRoot converts URL paths like /src/scenarios/Foo.tsx into
          absolute filesystem paths the editor can open. */}
      <ShowComponent
        onNavigate={handleNavigate}
        sourceRoot="/Users/laplace/Projects/show-component/test-app"
      />

      <header className="page-header">
        <h1>show-component — Test Harness</h1>
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
