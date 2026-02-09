import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',

  // Fiber tests are fast (<1 s), but navigation tests poll up to 15 s per
  // element for source-map resolution.  Two minutes handles the worst case.
  timeout: 2 * 60_000,

  // Don't retry — flaky test results should be investigated, not masked.
  retries: 0,

  // Fail fast: stop the suite on the first test failure so CI feedback is
  // quick.  Individual soft-assertion failures within a test are still all
  // reported before the test itself is marked failed.
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:5199',

    // Capture evidence on failure for easier debugging.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npx vite --port 5199',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
