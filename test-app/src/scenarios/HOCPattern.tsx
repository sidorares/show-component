import React from 'react';

/**
 * Scenario: Higher-Order Component (HOC) Pattern
 *
 * Tests a classic HOC that wraps components.  The key question is:
 * which component does the library report as the owner of the inner
 * DOM element — the HOC wrapper or the base component?
 *
 * In React's fiber tree, the ownership chain for `<EnhancedButton>` is:
 *   <button> → BaseButton → WithLogger(BaseButton) → App → …
 *
 * The _debugOwner of the <button> DOM fiber is the BaseButton fiber
 * (since BaseButton is the component that renders <button> in its JSX).
 * The HOC wrapper appears further up the chain.
 */

// ── The HOC ─────────────────────────────────────────────────────────────────

function withLogger<P extends Record<string, unknown>>(
  WrappedComponent: React.ComponentType<P>,
  componentName: string
) {
  const WithLogger = (props: P) => {
    // In a real HOC this might add logging, tracking, etc.
    return <WrappedComponent {...props} />;
  };
  WithLogger.displayName = `WithLogger(${componentName})`;
  return WithLogger;
}

// ── Base components ─────────────────────────────────────────────────────────

function BaseButton({ label }: { label: string }) {
  return (
    <button
      data-sc-test-id="hoc-button"
      data-sc-expect-owner="BaseButton"
      data-sc-expect-file="scenarios/HOCPattern.tsx"
      className="test-button"
    >
      {label}
    </button>
  );
}

function BaseCard({ title }: { title: string }) {
  return (
    <div
      data-sc-test-id="hoc-card"
      data-sc-expect-owner="BaseCard"
      data-sc-expect-file="scenarios/HOCPattern.tsx"
      className="test-card"
    >
      <strong>HOC Card:</strong> {title}
    </div>
  );
}

// ── Enhanced (wrapped) exports ──────────────────────────────────────────────

export const EnhancedButton = withLogger(BaseButton, 'BaseButton');
export const EnhancedCard = withLogger(BaseCard, 'BaseCard');
