import React from 'react';

/**
 * Scenario: Basic Components
 *
 * Tests the simplest cases — standard function declarations and arrow-function
 * components.  The library should detect the component name from `fiber.type.name`
 * and resolve the source file via the fiber's `_debugStack`.
 */

// ── Named function declaration ──────────────────────────────────────────────

export function BasicButton() {
  return (
    <button
      data-sc-test-id="basic-named-fn"
      data-sc-expect-owner="BasicButton"
      data-sc-expect-file="scenarios/BasicComponents.tsx"
      className="test-button"
    >
      Named Function Button
    </button>
  );
}

// ── Arrow function (const binding) ──────────────────────────────────────────

export const ArrowButton = () => {
  return (
    <button
      data-sc-test-id="basic-arrow-fn"
      data-sc-expect-owner="ArrowButton"
      data-sc-expect-file="scenarios/BasicComponents.tsx"
      className="test-button secondary"
    >
      Arrow Function Button
    </button>
  );
};

// ── Component with multiple child elements ──────────────────────────────────
// Both the root <div> and the inner <p> are test targets.
// They should both resolve to CardWithContent as their owner.

export function CardWithContent() {
  return (
    <div
      data-sc-test-id="basic-card-root"
      data-sc-expect-owner="CardWithContent"
      data-sc-expect-file="scenarios/BasicComponents.tsx"
      className="test-card"
    >
      <h3>Card Title</h3>
      <p
        data-sc-test-id="basic-card-paragraph"
        data-sc-expect-owner="CardWithContent"
        data-sc-expect-file="scenarios/BasicComponents.tsx"
      >
        This paragraph and the wrapping div should both resolve to{' '}
        <strong>CardWithContent</strong>.
      </p>
    </div>
  );
}
