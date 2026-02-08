import React, { lazy, Suspense, useState } from 'react';

/**
 * Scenario: Dynamic Import (React.lazy / code splitting)
 *
 * The `LazyTarget` component lives in a separate file and is loaded via
 * `React.lazy(() => import('./LazyTarget'))`.  Vite emits it as a separate
 * chunk with its own source map.
 *
 * This tests that the source map resolver can:
 *   1. Fetch the dynamically-loaded chunk
 *   2. Find its source map (inline or external depending on build config)
 *   3. Map back to the original LazyTarget.tsx source
 */

const LazyTarget = lazy(() => import('./LazyTarget'));

export function DynamicImportScenario() {
  const [show, setShow] = useState(false);

  return (
    <div>
      {!show && (
        <button
          className="test-button"
          onClick={() => setShow(true)}
        >
          Click to load lazy component
        </button>
      )}
      {show && (
        <Suspense
          fallback={
            <div className="test-card" style={{ opacity: 0.5 }}>
              Loading lazy chunk…
            </div>
          }
        >
          <LazyTarget />
        </Suspense>
      )}
    </div>
  );
}
