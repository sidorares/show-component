import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCaches, extractStackFrameInfo, fetchSourceFile } from './source-location-resolver';

// ─── extractStackFrameInfo ───────────────────────────────────────────────────

describe('extractStackFrameInfo', () => {
  it('parses about://React/Server/file:/// stack frames correctly', () => {
    const frame =
      'at LandingPage (about://React/Server/file:///Users/testuser/Projects/sample-app/web/.next/server/chunks/ssr/%5Broot-of-the-server%5D__63dfaf64._.js?20:141:295)';
    const info = extractStackFrameInfo(frame);

    expect(info).toBeDefined();
    expect(info?.functionName).toBe('LandingPage');
    expect(info?.url).toBe(
      'about://React/Server/file:///Users/testuser/Projects/sample-app/web/.next/server/chunks/ssr/%5Broot-of-the-server%5D__63dfaf64._.js?20'
    );
    expect(info?.line).toBe(141);
    expect(info?.column).toBe(295);
  });

  it('parses regular http stack frames as before', () => {
    const frame =
      'at fakeJSXCallSite (http://localhost:3000/_next/static/chunks/2374f_next_dist_compiled_20dc070b._.js:4353:16)';
    const info = extractStackFrameInfo(frame);

    expect(info).toBeDefined();
    expect(info?.functionName).toBe('fakeJSXCallSite');
    expect(info?.url).toBe(
      'http://localhost:3000/_next/static/chunks/2374f_next_dist_compiled_20dc070b._.js'
    );
    expect(info?.line).toBe(4353);
    expect(info?.column).toBe(16);
  });

  it('parses rsc:// stack frames', () => {
    const frame =
      'at ServerPage (rsc://React/Server/file:///Users/testuser/Projects/sample-app/web/.next/server/chunks/ssr/file.js:10:20)';
    const info = extractStackFrameInfo(frame);

    expect(info).toBeDefined();
    expect(info?.functionName).toBe('ServerPage');
    expect(info?.url).toBe(
      'rsc://React/Server/file:///Users/testuser/Projects/sample-app/web/.next/server/chunks/ssr/file.js'
    );
    expect(info?.line).toBe(10);
    expect(info?.column).toBe(20);
  });
});

// ─── fetchSourceFile ─────────────────────────────────────────────────────────

describe('fetchSourceFile', () => {
  const originalFetch = globalThis.fetch;
  let hadWindow: boolean;

  beforeEach(() => {
    clearCaches();
    hadWindow = typeof globalThis.window !== 'undefined';
    // Provide a minimal window.location.origin for non-browser environment
    if (!hadWindow) {
      (globalThis as unknown as Record<string, unknown>).window = {
        location: { origin: 'http://localhost:3000' },
      };
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (!hadWindow) {
      (globalThis as unknown as Record<string, unknown>).window = undefined as unknown as Window &
        typeof globalThis;
    }
  });

  it('converts about://React/Server/file:/// URLs to fetchable HTTP URLs (same as rsc://)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('// source code'),
    });
    globalThis.fetch = mockFetch;

    const url =
      'about://React/Server/file:///Users/testuser/Projects/sample-app/web/.next/server/chunks/ssr/%5Broot-of-the-server%5D__63dfaf64._.js?20';

    const result = await fetchSourceFile(url);

    expect(result.content).toBe('// source code');
    // Should have converted the about:// URL → http://localhost:3000/api/dev/source-file/...
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchedUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchedUrl).toMatch(/^http:\/\/localhost:3000\/api\/dev\/source-file\//);
    expect(fetchedUrl).toContain('server/chunks/ssr/');
    // Must NOT contain the original about:// prefix
    expect(fetchedUrl).not.toContain('about://');
  });

  it('handles about://React/Server/ URLs without .next path gracefully', async () => {
    const url = 'about://React/Server/file:///some/random/path/without/next/file.js';

    await expect(fetchSourceFile(url)).rejects.toThrow(/does not contain .next folder/);
  });

  it('still handles rsc://React/Server/ URLs as before', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('// rsc source'),
    });
    globalThis.fetch = mockFetch;

    const url =
      'rsc://React/Server/file:///Users/testuser/Projects/sample-app/web/.next/server/chunks/ssr/page.js';

    const result = await fetchSourceFile(url);
    expect(result.content).toBe('// rsc source');
    const fetchedUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchedUrl).toMatch(/^http:\/\/localhost:3000\/api\/dev\/source-file\//);
  });

  it('does not produce malformed URLs like "http://localhost:3000about://..."', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('// source'),
    });
    globalThis.fetch = mockFetch;

    const url =
      'about://React/Server/file:///Users/testuser/Projects/sample-app/web/.next/server/chunks/ssr/%5Broot-of-the-server%5D__63dfaf64._.js?20';

    await fetchSourceFile(url);

    const fetchedUrl = mockFetch.mock.calls[0][0] as string;
    // The bug: URL was being constructed as http://localhost:3000about://…
    expect(fetchedUrl).not.toMatch(/^http:\/\/localhost:\d+about:/);
    // Should be a well-formed HTTP URL
    expect(() => new URL(fetchedUrl)).not.toThrow();
  });

  it('rejects unknown non-http schemes that are not RSC-like', async () => {
    const url = 'chrome-extension://abcdef/background.js';

    await expect(fetchSourceFile(url)).rejects.toThrow(/non-fetchable URL scheme/i);
  });
});
