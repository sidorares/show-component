import React, { forwardRef, memo } from 'react';

/**
 * Scenario: Wrapped Component Types
 *
 * Tests components created via React.forwardRef, React.memo, and components
 * with a custom `displayName`.  These exercise the `getComponentName` function's
 * ability to unwrap React's higher-order type wrappers.
 *
 * Library behaviour (from getComponentName):
 *   forwardRef  → reads obj.render.name  → "ForwardRef(RenderFnName)"
 *   memo        → reads obj.type.name    → "Memo(WrappedName)"
 *   displayName → func.name takes priority over func.displayName
 */

// ── forwardRef ──────────────────────────────────────────────────────────────
// The render function is *named* so the library can extract "ForwardRefInput".
// In the ownership chain the fiber wrapping the <input> has _debugOwner
// pointing to the ForwardRefInput fiber whose type.render.name = "ForwardRefInput".

export const ForwardRefInput = forwardRef<HTMLInputElement, { placeholder?: string }>(
  function ForwardRefInput(props, ref) {
    return (
      <input
        ref={ref}
        data-sc-test-id="wrapped-forward-ref"
        data-sc-expect-owner="ForwardRefInput"
        data-sc-expect-file="scenarios/WrappedComponents.tsx"
        className="test-input"
        placeholder={props.placeholder || 'forwardRef input'}
      />
    );
  }
);

// ── memo ────────────────────────────────────────────────────────────────────

export const MemoizedCard = memo(function MemoizedCard({ title }: { title: string }) {
  return (
    <div
      data-sc-test-id="wrapped-memo"
      data-sc-expect-owner="MemoizedCard"
      data-sc-expect-file="scenarios/WrappedComponents.tsx"
      className="test-card"
    >
      <strong>Memo:</strong> {title}
    </div>
  );
});

// ── displayName ─────────────────────────────────────────────────────────────
// NOTE: The library checks `func.name || func.displayName`.  Since arrow
// functions assigned to `const` get their name from the variable binding,
// `func.name` will be "DisplayNameComponent" and `func.displayName` is ignored.
// The expected owner is therefore "DisplayNameComponent", NOT "CustomDisplayName".

export const DisplayNameComponent = () => {
  return (
    <button
      data-sc-test-id="wrapped-display-name"
      data-sc-expect-owner="DisplayNameComponent"
      data-sc-expect-file="scenarios/WrappedComponents.tsx"
      className="test-button"
    >
      Component with displayName
    </button>
  );
};
DisplayNameComponent.displayName = 'CustomDisplayName';
