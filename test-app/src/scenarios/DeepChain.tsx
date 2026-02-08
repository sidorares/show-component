import React from 'react';

/**
 * Scenario: Deep Nesting (5-level ownership chain)
 *
 * Renders:  DeepChainRoot → LevelA → LevelB → LevelC → LevelD → <button>
 *
 * When the leaf <button> is Alt+Shift+Clicked, the popover should show
 * the full chain:  button → LevelD → LevelC → LevelB → LevelA → DeepChainRoot → App → …
 *
 * The `data-sc-expect-chain` attribute lists the expected component-only
 * entries (excluding DOM tag names) from innermost to outermost.
 */

function LevelD() {
  return (
    <button
      data-sc-test-id="deep-chain-leaf"
      data-sc-expect-owner="LevelD"
      data-sc-expect-file="scenarios/DeepChain.tsx"
      data-sc-expect-chain="LevelD,LevelC,LevelB,LevelA,DeepChainRoot"
      className="test-button destructive"
    >
      Leaf (5 levels deep)
    </button>
  );
}

function LevelC() {
  return (
    <div className="chain-level" style={{ marginLeft: 48 }}>
      <span>LevelC →</span>
      <LevelD />
    </div>
  );
}

function LevelB() {
  console.log('<LevelB />')
  return (
    <div className="chain-level" style={{ marginLeft: 32 }}>
      <span>LevelB →</span>
      <LevelC />
    </div>
  );
}

function LevelA() {
  return (
    <div className="chain-level" style={{ marginLeft: 16 }}>
      <span>LevelA →</span>
      <LevelB />
    </div>
  );
}

export function DeepChainRoot() {
  return (
    <div className="deep-chain">
      <div className="chain-level">
        <span>DeepChainRoot →</span>
        <LevelA />
      </div>
    </div>
  );
}
