/**
 * End-to-end test harness for show-component.
 *
 * Drives the in-browser TestRunner (which does fiber introspection and
 * synthetic Alt+Right-Click navigation) and asserts that every scenario
 * produces the expected results.
 *
 * Design notes:
 * - We click the in-browser "Run" buttons rather than duplicating test logic
 *   here; the TestRunner is the single source of detection code.
 * - Results are extracted from the JSON <script> tags the TestRunner renders.
 * - Each scenario is checked via `expect.soft()` so ALL failures are reported
 *   in a single run rather than stopping at the first one.
 * - Wrapper divs in App.tsx carry `data-sc-test-id` but no `data-sc-expect-*`
 *   attrs; those produce results with expectOwner "(not set)" and are filtered
 *   out before assertion.
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Types matching TestRunner output ────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Navigate to the test app and wait until all scenarios (including the
 * lazy-loaded DynamicImport) have mounted.
 */
async function waitForTestApp(page: Page) {
  await page.goto('/');

  // Wait for always-present scenarios to be in the DOM.
  await page.waitForSelector('[data-sc-test-id="basic-named-fn"]', {
    state: 'attached',
    timeout: 30_000,
  });

  // The DynamicImport scenario starts with a "Click to load" button.
  // Trigger the lazy load so its test element appears.
  const loadButton = page.locator('#scenario-dynamic button:has-text("Click to load")');
  if (await loadButton.isVisible({ timeout: 5_000 })) {
    await loadButton.click();
    await page.waitForSelector('[data-sc-test-id="dynamic-lazy"]', {
      state: 'attached',
      timeout: 15_000,
    });
  }
}

/**
 * Click the Run button for a test suite, wait for the JSON results element,
 * and return the parsed results.
 */
async function runSuiteAndExtract<T>(
  page: Page,
  buttonName: RegExp,
  jsonSelector: string,
  timeout: number,
): Promise<T[]> {
  await page.getByRole('button', { name: buttonName }).click();
  const jsonEl = page.locator(jsonSelector);
  await jsonEl.waitFor({ state: 'attached', timeout });
  const raw = await jsonEl.evaluate((el) => el.textContent!);
  return JSON.parse(raw) as T[];
}

/**
 * Returns true if a fiber result represents a "real" test case (has
 * ground-truth expectations) vs. a wrapper div that only carries
 * data-sc-test-id.
 */
function isFiberTestable(r: FiberTestResult): boolean {
  return r.expectOwner !== '(not set)' && r.expectFile !== '(not set)';
}

/**
 * Returns true if a nav result represents a real test case.
 * Nav results always come from elements with data-sc-test-id; we filter
 * out those without a meaningful expected file.
 */
function isNavTestable(r: NavTestResult): boolean {
  return r.expectFile !== '(not set)';
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('show-component test harness', () => {
  // ══════════════════════════════════════════════════════════════════════════
  // Fiber Introspection
  // ══════════════════════════════════════════════════════════════════════════

  test('fiber introspection — owner, file, and chain detection', async ({ page }) => {
    await waitForTestApp(page);

    const results = await runSuiteAndExtract<FiberTestResult>(
      page,
      /Run Fiber Tests/,
      '#fiber-results-json',
      60_000,
    );

    // Only assert on elements that carry ground-truth data-sc-expect-* attrs.
    const testable = results.filter(isFiberTestable);

    expect(testable.length, 'No testable fiber results found — are scenarios rendered?').toBeGreaterThan(0);

    for (const r of testable) {
      await test.step(r.testId, () => {
        // Owner name detection.
        //
        // The in-browser TestRunner uses exact equality, but Vite's React
        // plugin (Babel HMR) can append numeric suffixes (e.g. "MemoizedCard2")
        // and the fiber-utils reports wrapper notation (e.g. "ForwardRef(X)").
        // We use substring matching to tolerate these build-tool artifacts
        // while still catching genuine regressions.
        const ownerOk =
          r.detectedOwner !== null && r.detectedOwner.includes(r.expectOwner);
        expect.soft(ownerOk, [
          `Owner mismatch for "${r.testId}"`,
          `  expected to contain : ${r.expectOwner}`,
          `  detected            : ${r.detectedOwner ?? '(null)'}`,
        ].join('\n')).toBe(true);

        // Source file resolution (null means no source URL on fiber — separate error)
        if (r.fileMatch !== null) {
          expect.soft(r.fileMatch, [
            `File mismatch for "${r.testId}"`,
            `  expected to contain : ${r.expectFile}`,
            `  detected            : ${r.detectedFile ?? '(null)'}`,
          ].join('\n')).toBe(true);
        }

        // Component chain (only tested for deep-nesting scenario)
        if (r.chainMatch !== null) {
          expect.soft(r.chainMatch, [
            `Chain mismatch for "${r.testId}"`,
            `  expected to start with : ${r.expectChain}`,
            `  detected               : ${r.detectedChain ?? '(null)'}`,
          ].join('\n')).toBe(true);
        }

        // No unexpected errors
        expect.soft(r.error, [
          `Unexpected error for "${r.testId}"`,
          `  ${r.error}`,
        ].join('\n')).toBeNull();
      });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Navigation Integration (Alt+Right-Click → source resolution)
  // ══════════════════════════════════════════════════════════════════════════

  test('navigation integration — Alt+Right-Click source resolution', async ({ page }) => {
    // Nav tests dispatch synthetic events and poll for source-map resolution
    // which can be slow on first run (cold caches). 5 minutes is generous.
    test.setTimeout(5 * 60_000);

    await waitForTestApp(page);

    const results = await runSuiteAndExtract<NavTestResult>(
      page,
      /Run Navigation Tests/,
      '#nav-results-json',
      4 * 60_000,
    );

    const testable = results.filter(isNavTestable);

    expect(testable.length, 'No testable navigation results found — are scenarios rendered?').toBeGreaterThan(0);

    for (const r of testable) {
      await test.step(r.testId, () => {
        // Source file resolution
        expect.soft(r.fileMatch, [
          `File mismatch for "${r.testId}"`,
          `  expected to contain : ${r.expectFile}`,
          `  captured source     : ${r.capturedSource ?? '(null)'}`,
          r.capturedComponent ? `  captured component  : ${r.capturedComponent}` : null,
          r.capturedUrl ? `  cursor:// URL       : ${r.capturedUrl}` : null,
        ].filter(Boolean).join('\n')).toBe(true);

        // No unexpected errors / timeouts
        expect.soft(r.error, [
          `Unexpected error for "${r.testId}"`,
          `  ${r.error}`,
        ].join('\n')).toBeNull();
      });
    }
  });
});
