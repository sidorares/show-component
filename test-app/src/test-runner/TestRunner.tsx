import React, { useCallback, useState } from 'react';
import { resolveLocation } from 'show-component/core/source-location-resolver';
import type { NavigationEvent } from 'show-component';
import {
  findFiberFromNode,
  getComponentName,
  getSourceUrl,
  getComponentChain,
  type Fiber,
} from './fiber-utils';

// ─── Fiber-level test types ─────────────────────────────────────────────────

interface FiberTestResult {
  testId: string;
  expectOwner: string;
  expectFile: string;
  expectChain: string | null;
  detectedOwner: string | null;
  detectedFile: string | null;
  detectedChain: string | null;
  ownerMatch: boolean;
  fileMatch: boolean | null;
  chainMatch: boolean | null;
  error: string | null;
}

// ─── Navigation integration test types ──────────────────────────────────────

interface NavTestResult {
  testId: string;
  expectFile: string;
  capturedSource: string | null;
  capturedLine: number | null;
  capturedColumn: number | null;
  capturedUrl: string | null;
  capturedComponent: string | null;
  fileMatch: boolean;
  error: string | null;
}

// ─── Helper: wait until condition or timeout ────────────────────────────────

function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 100,
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(check, pollMs);
    };
    check();
  });
}

// ─── TestRunner component ───────────────────────────────────────────────────

export function TestRunner() {
  // ── Fiber test state ────────────────────────────────────────────────────
  const [fiberResults, setFiberResults] = useState<FiberTestResult[]>([]);
  const [fiberRunning, setFiberRunning] = useState(false);
  const [fiberElapsed, setFiberElapsed] = useState<number | null>(null);

  // ── Navigation integration test state ───────────────────────────────────
  const [navResults, setNavResults] = useState<NavTestResult[]>([]);
  const [navRunning, setNavRunning] = useState(false);
  const [navElapsed, setNavElapsed] = useState<number | null>(null);

  // ════════════════════════════════════════════════════════════════════════
  // TEST 1: Fiber introspection (direct fiber walking + source map resolve)
  // ════════════════════════════════════════════════════════════════════════

  const runFiberTests = useCallback(async () => {
    setFiberRunning(true);
    setFiberResults([]);
    const t0 = performance.now();

    const elements = document.querySelectorAll<HTMLElement>('[data-sc-test-id]');
    const pending: FiberTestResult[] = [];

    for (const el of elements) {
      const testId = el.getAttribute('data-sc-test-id')!;
      const expectOwner = el.getAttribute('data-sc-expect-owner') || '(not set)';
      const expectFile = el.getAttribute('data-sc-expect-file') || '(not set)';
      const expectChain = el.getAttribute('data-sc-expect-chain') || null;

      const fiber = findFiberFromNode(el);
      if (!fiber) {
        pending.push({
          testId, expectOwner, expectFile, expectChain,
          detectedOwner: null, detectedFile: null, detectedChain: null,
          ownerMatch: false, fileMatch: null, chainMatch: null,
          error: 'No __reactFiber found on DOM node',
        });
        continue;
      }

      const ownerFiber: Fiber | null = fiber._debugOwner;
      const detectedOwner = ownerFiber ? getComponentName(ownerFiber) : null;
      const ownerMatch = detectedOwner === expectOwner;

      const chain = getComponentChain(fiber);
      const detectedChain = chain.map((c) => c.componentName).join(',');
      const chainMatch = expectChain ? detectedChain.startsWith(expectChain) : null;

      let detectedFile: string | null = null;
      let fileMatch: boolean | null = null;
      let error: string | null = null;

      const sourceUrl = getSourceUrl(fiber);
      if (sourceUrl) {
        try {
          const resolved = await resolveLocation(sourceUrl);
          if (resolved) {
            detectedFile = resolved.source;
            fileMatch = detectedFile.includes(expectFile);
          } else {
            error = 'resolveLocation returned null';
          }
        } catch (e) {
          error = `Source resolve error: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else {
        error = 'No _debugStack / source URL on fiber';
      }

      pending.push({
        testId, expectOwner, expectFile, expectChain,
        detectedOwner, detectedFile, detectedChain,
        ownerMatch, fileMatch, chainMatch, error,
      });
    }

    setFiberResults(pending);
    setFiberElapsed(Math.round(performance.now() - t0));
    setFiberRunning(false);
  }, []);

  // ════════════════════════════════════════════════════════════════════════
  // TEST 2: Navigation integration (synthetic Alt+Click → onNavigate)
  //
  // This simulates exactly what happens when a user Alt+Right-Clicks an
  // element: the library's contextmenu handler fires, walks the fiber,
  // resolves the source map, and calls the onNavigate callback.
  //
  // We intercept via window.__sc_nav_events (populated by App's onNavigate).
  // ════════════════════════════════════════════════════════════════════════

  const runNavTests = useCallback(async () => {
    setNavRunning(true);
    setNavResults([]);
    const t0 = performance.now();

    // Reset the event store
    window.__sc_nav_events = [];

    const elements = document.querySelectorAll<HTMLElement>('[data-sc-test-id]');
    const pending: NavTestResult[] = [];

    for (const el of elements) {
      const testId = el.getAttribute('data-sc-test-id')!;
      const expectFile = el.getAttribute('data-sc-expect-file') || '(not set)';

      const startCount = window.__sc_nav_events.length;

      // Dispatch a synthetic Alt+Right-Click (contextmenu with altKey)
      const rect = el.getBoundingClientRect();
      const syntheticEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        altKey: true,
        shiftKey: false,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 2,
      });
      el.dispatchEvent(syntheticEvent);

      // Poll for the navigation event (source resolution is async)
      const arrived = await waitFor(
        () => window.__sc_nav_events.length > startCount,
        15_000, // generous timeout for first cold resolution
        150,
      );

      if (arrived) {
        const navEvent = window.__sc_nav_events[window.__sc_nav_events.length - 1];
        const fileMatch = navEvent.source.includes(expectFile);

        pending.push({
          testId,
          expectFile,
          capturedSource: navEvent.source,
          capturedLine: navEvent.line,
          capturedColumn: navEvent.column,
          capturedUrl: navEvent.url,
          capturedComponent: navEvent.componentName || null,
          fileMatch,
          error: null,
        });

        // Structured log for browser_console_messages / MCP scraping
        console.log(
          `[sc:nav-test] ${testId}: ${fileMatch ? 'PASS' : 'FAIL'}`,
          JSON.stringify({ testId, expectFile, capturedSource: navEvent.source, fileMatch }),
        );
      } else {
        pending.push({
          testId,
          expectFile,
          capturedSource: null,
          capturedLine: null,
          capturedColumn: null,
          capturedUrl: null,
          capturedComponent: null,
          fileMatch: false,
          error: 'No navigation event captured within 15 s',
        });
        console.log(`[sc:nav-test] ${testId}: TIMEOUT`);
      }
    }

    setNavResults(pending);
    setNavElapsed(Math.round(performance.now() - t0));
    setNavRunning(false);
  }, []);

  // ── Summary stats ───────────────────────────────────────────────────────

  const fTotal = fiberResults.length;
  const fOwnerPass = fiberResults.filter((r) => r.ownerMatch).length;
  const fFilePass = fiberResults.filter((r) => r.fileMatch === true).length;
  const fFileSkip = fiberResults.filter((r) => r.fileMatch === null).length;
  const fChainPass = fiberResults.filter((r) => r.chainMatch === true).length;
  const fChainSkip = fiberResults.filter((r) => r.chainMatch === null).length;

  const nTotal = navResults.length;
  const nPass = navResults.filter((r) => r.fileMatch).length;
  const nFail = navResults.filter((r) => !r.fileMatch && !r.error).length;
  const nError = navResults.filter((r) => !!r.error).length;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* ═══ Fiber introspection tests ═══════════════════════════════════ */}
      <div className="test-runner" id="test-runner-fiber">
        <div className="test-runner-header">
          <h2>Test 1 — Fiber Introspection</h2>
          <button className="run-button" onClick={runFiberTests} disabled={fiberRunning}>
            {fiberRunning ? 'Running…' : 'Run Fiber Tests'}
          </button>
          {fiberElapsed !== null && (
            <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{fiberElapsed} ms</span>
          )}
        </div>

        {fiberResults.length > 0 && (
          <>
            <div
              className="test-runner-summary"
              id="fiber-test-summary"
              data-total={fTotal}
              data-owner-pass={fOwnerPass}
              data-file-pass={fFilePass}
            >
              <strong>Fiber results:</strong>{' '}
              Owner: {fOwnerPass}/{fTotal} |{' '}
              File: {fFilePass}/{fTotal - fFileSkip} ({fFileSkip} skip) |{' '}
              Chain: {fChainPass}/{fTotal - fChainSkip} ({fChainSkip} n/a)
            </div>
            <table className="test-results-table" id="fiber-results-table">
              <thead>
                <tr>
                  <th>Test ID</th>
                  <th>Expect Owner</th>
                  <th>Detected</th>
                  <th>OK</th>
                  <th>Expect File</th>
                  <th>Detected File</th>
                  <th>OK</th>
                  <th>Chain</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {fiberResults.map((r) => (
                  <tr key={r.testId} data-sc-result-id={r.testId}>
                    <td>{r.testId}</td>
                    <td>{r.expectOwner}</td>
                    <td>{r.detectedOwner ?? '—'}</td>
                    <td className={r.ownerMatch ? 'match-pass' : 'match-fail'}>
                      {r.ownerMatch ? '✓' : '✗'}
                    </td>
                    <td>{r.expectFile}</td>
                    <td title={r.detectedFile ?? undefined}>
                      {r.detectedFile
                        ? r.detectedFile.length > 50
                          ? '…' + r.detectedFile.slice(-50)
                          : r.detectedFile
                        : '—'}
                    </td>
                    <td
                      className={
                        r.fileMatch === true ? 'match-pass'
                          : r.fileMatch === false ? 'match-fail'
                          : 'match-skip'
                      }
                    >
                      {r.fileMatch === true ? '✓' : r.fileMatch === false ? '✗' : '—'}
                    </td>
                    <td
                      className={
                        r.chainMatch === true ? 'match-pass'
                          : r.chainMatch === false ? 'match-fail'
                          : 'match-skip'
                      }
                    >
                      {r.chainMatch === true ? '✓' : r.chainMatch === false ? '✗' : '—'}
                    </td>
                    <td style={{ color: '#e63946', fontSize: '0.7rem' }}>{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <script
              type="application/json"
              id="fiber-results-json"
              dangerouslySetInnerHTML={{ __html: JSON.stringify(fiberResults, null, 2) }}
            />
          </>
        )}
      </div>

      {/* ═══ Navigation integration tests ════════════════════════════════ */}
      <div className="test-runner" id="test-runner-nav" style={{ marginTop: 12 }}>
        <div className="test-runner-header" style={{ background: '#2d3a4f' }}>
          <h2>Test 2 — Navigation Integration (Alt+Click)</h2>
          <button className="run-button" onClick={runNavTests} disabled={navRunning}>
            {navRunning ? 'Running…' : 'Run Navigation Tests'}
          </button>
          {navElapsed !== null && (
            <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{navElapsed} ms</span>
          )}
        </div>

        {navRunning && (
          <div className="test-runner-summary" style={{ fontStyle: 'italic' }}>
            Dispatching synthetic Alt+Right-Click on each test element and waiting for
            source-map resolution… ({window.__sc_nav_events?.length ?? 0} events so far)
          </div>
        )}

        {navResults.length > 0 && (
          <>
            <div
              className="test-runner-summary"
              id="nav-test-summary"
              data-total={nTotal}
              data-pass={nPass}
              data-fail={nFail}
              data-error={nError}
            >
              <strong>Navigation results:</strong>{' '}
              {nPass}/{nTotal} pass | {nFail} fail | {nError} error/timeout
            </div>
            <table className="test-results-table" id="nav-results-table">
              <thead>
                <tr>
                  <th>Test ID</th>
                  <th>Expect File</th>
                  <th>Captured Source</th>
                  <th>File OK</th>
                  <th>Line</th>
                  <th>Col</th>
                  <th>Component</th>
                  <th>cursor:// URL</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {navResults.map((r) => (
                  <tr key={r.testId} data-sc-nav-result-id={r.testId}>
                    <td>{r.testId}</td>
                    <td>{r.expectFile}</td>
                    <td title={r.capturedSource ?? undefined}>
                      {r.capturedSource
                        ? r.capturedSource.length > 50
                          ? '…' + r.capturedSource.slice(-50)
                          : r.capturedSource
                        : '—'}
                    </td>
                    <td className={r.fileMatch ? 'match-pass' : 'match-fail'}>
                      {r.fileMatch ? '✓' : '✗'}
                    </td>
                    <td>{r.capturedLine ?? '—'}</td>
                    <td>{r.capturedColumn ?? '—'}</td>
                    <td>{r.capturedComponent ?? '—'}</td>
                    <td title={r.capturedUrl ?? undefined} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.capturedUrl ? (
                        <a
                          href={r.capturedUrl}
                          onClick={(e) => {
                            e.preventDefault();
                            window.open(r.capturedUrl!, '_self');
                          }}
                          style={{
                            color: '#3b82f6',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontSize: 'inherit',
                          }}
                        >
                          {r.capturedUrl.length > 40
                            ? '…' + r.capturedUrl.slice(-40)
                            : r.capturedUrl}
                        </a>
                      ) : '—'}
                    </td>
                    <td style={{ color: '#e63946', fontSize: '0.7rem' }}>{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <script
              type="application/json"
              id="nav-results-json"
              dangerouslySetInnerHTML={{ __html: JSON.stringify(navResults, null, 2) }}
            />
          </>
        )}
      </div>
    </>
  );
}
