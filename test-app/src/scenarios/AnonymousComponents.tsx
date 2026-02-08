import React from 'react';

/**
 * Scenario: Anonymous / Hard-to-Name Components
 *
 * Tests what the library does when a component has no obvious name:
 *   - A named export that re-exports a default-export arrow function
 *   - An inline component rendered via a wrapper
 *
 * In modern bundlers (esbuild/Vite), `const Foo = () => {}` gives the
 * function `name = "Foo"` via the spec's "has-name" inference from
 * variable declarations.  Truly anonymous functions are rare in practice;
 * these test cases verify the boundary behaviour.
 */

// ── Named export of an arrow function ───────────────────────────────────────
// Even though this is a simple arrow, `AnonymousDefault.name === "AnonymousDefault"`
// because of JS name inference from `const` binding.

export const AnonymousDefault = () => {
  console.log('AnonymousDefault render')
  return (
    <button
      data-sc-test-id="anon-default-export"
      data-sc-expect-owner="AnonymousDefault"
      data-sc-expect-file="scenarios/AnonymousComponents.tsx"
      className="test-button"
    >
      "Anonymous" Default Export
    </button>
  );
};

// ── Inline anonymous via wrapper ────────────────────────────────────────────
// The component function assigned to `InlineAnonymous` still gets its name
// from the binding.

export const InlineAnonymous = () => {
  // Render an element whose owner is this component
  return (
    <div
      data-sc-test-id="anon-inline"
      data-sc-expect-owner="InlineAnonymous"
      data-sc-expect-file="scenarios/AnonymousComponents.tsx"
      className="test-card"
    >
      <em>Inline arrow component</em>
      <p>Owner should still be detected as <code>InlineAnonymous</code></p>
    </div>
  );
};
