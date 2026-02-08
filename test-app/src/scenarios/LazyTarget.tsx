import React from 'react';

/**
 * This component is loaded via React.lazy() from DynamicImport.tsx.
 * It will be emitted in a separate chunk by Vite / Rollup.
 *
 * The test verifies that source map resolution works across code-split chunks.
 */

export default function LazyTarget() {
  return (
    <div
      data-sc-test-id="dynamic-lazy"
      data-sc-expect-owner="LazyTarget"
      data-sc-expect-file="scenarios/LazyTarget.tsx"
      className="test-card"
    >
      <strong>Lazy-loaded component</strong>
      <p>I was loaded dynamically via <code>React.lazy()</code></p>
    </div>
  );
}
