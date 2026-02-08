import React from 'react';
import ReactDOM from 'react-dom/client';
import { ShowComponent } from 'show-component';
import type { NavigationEvent } from 'show-component';

// Shared event store (same pattern as main App)
declare global {
  interface Window {
    __sc_nav_events: NavigationEvent[];
  }
}
if (!window.__sc_nav_events) window.__sc_nav_events = [];

function handleNavigate(event: NavigationEvent) {
  window.__sc_nav_events.push(event);
  console.log('[sc:navigate]', JSON.stringify(event));
}

// ─── Root 1 components ────────────────────────────────────────────────────────

function PrimaryButton() {
  return (
    <button
      data-sc-test-id="multi-root-1-button"
      data-sc-expect-owner="PrimaryButton"
      data-sc-expect-file="main-multi-root.tsx"
      className="test-button"
    >
      Root #1 — Primary Button
    </button>
  );
}

const SOURCE_ROOT = '/Users/laplace/Projects/show-component/test-app';

function RootOneApp() {
  return (
    <div className="root-inner">
      <ShowComponent onNavigate={handleNavigate} sourceRoot={SOURCE_ROOT} />
      <PrimaryButton />
      <p
        data-sc-test-id="multi-root-1-text"
        data-sc-expect-owner="RootOneApp"
        data-sc-expect-file="main-multi-root.tsx"
      >
        This paragraph belongs to React Root #1
      </p>
    </div>
  );
}

// ─── Root 2 components ────────────────────────────────────────────────────────

function SecondaryButton() {
  return (
    <button
      data-sc-test-id="multi-root-2-button"
      data-sc-expect-owner="SecondaryButton"
      data-sc-expect-file="main-multi-root.tsx"
      className="test-button secondary"
    >
      Root #2 — Secondary Button
    </button>
  );
}

function RootTwoApp() {
  return (
    <div className="root-inner">
      <ShowComponent onNavigate={handleNavigate} sourceRoot={SOURCE_ROOT} />
      <SecondaryButton />
      <p
        data-sc-test-id="multi-root-2-text"
        data-sc-expect-owner="RootTwoApp"
        data-sc-expect-file="main-multi-root.tsx"
      >
        This paragraph belongs to React Root #2
      </p>
    </div>
  );
}

// ─── Mount two independent React roots ────────────────────────────────────────

const root1El = document.getElementById('root-1');
const root2El = document.getElementById('root-2');

if (root1El) {
  ReactDOM.createRoot(root1El).render(
    <React.StrictMode>
      <RootOneApp />
    </React.StrictMode>
  );
}

if (root2El) {
  ReactDOM.createRoot(root2El).render(
    <React.StrictMode>
      <RootTwoApp />
    </React.StrictMode>
  );
}
