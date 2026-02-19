import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCaches,
  configureSourceRoot,
  extractStackFrameInfo,
  fetchSourceFile,
  resolveLocation,
  resolveSourcePath,
} from './source-location-resolver';

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

  it('fetches regular HTTP URLs directly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('// js source'),
    });
    globalThis.fetch = mockFetch;

    const result = await fetchSourceFile('http://localhost:3000/_next/static/chunks/app.js');
    expect(result.content).toBe('// js source');
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:3000/_next/static/chunks/app.js');
  });

  it('resolves root-relative URLs against window.location.origin', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('// relative source'),
    });
    globalThis.fetch = mockFetch;

    const result = await fetchSourceFile('/_next/static/chunks/app.js');
    expect(result.content).toBe('// relative source');
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:3000/_next/static/chunks/app.js');
  });

  it('rejects RSC URLs (handled by Next.js fast path, not fetchSourceFile)', async () => {
    await expect(
      fetchSourceFile('about://React/Server/file:///Users/me/proj/.next/server/chunks/ssr/page.js')
    ).rejects.toThrow(/non-fetchable URL scheme/i);

    await expect(
      fetchSourceFile('rsc://React/Server/file:///Users/me/proj/.next/server/chunks/ssr/page.js')
    ).rejects.toThrow(/non-fetchable URL scheme/i);
  });

  it('rejects other non-http schemes', async () => {
    await expect(fetchSourceFile('chrome-extension://abcdef/background.js')).rejects.toThrow(
      /non-fetchable URL scheme/i
    );
  });
});

// ─── resolveSourcePath ──────────────────────────────────────────────────────

describe('resolveSourcePath', () => {
  afterEach(() => {
    configureSourceRoot(undefined);
  });

  it('strips file:/// protocol and returns the absolute path directly', () => {
    const result = resolveSourcePath(
      'file:///Users/me/project/src/components/Foo.tsx',
      undefined,
      'http://localhost:3000/_next/static/chunks/app_src_abc123._.js'
    );
    expect(result).toBe('/Users/me/project/src/components/Foo.tsx');
  });

  it('does not double-prefix file:/// sources with sourceRoot', () => {
    configureSourceRoot('/Users/me/project');
    const result = resolveSourcePath(
      'file:///Users/me/project/src/components/Foo.tsx',
      undefined,
      'http://localhost:3000/_next/static/chunks/app_src_abc123._.js'
    );
    // Should return the path as-is from the file:// URL, not prepend sourceRoot
    expect(result).toBe('/Users/me/project/src/components/Foo.tsx');
  });

  it('resolves relative sources against the source file URL', () => {
    const result = resolveSourcePath(
      'Foo.tsx',
      undefined,
      'http://localhost:5200/src/scenarios/Foo.tsx'
    );
    expect(result).toBe('/src/scenarios/Foo.tsx');
  });

  it('handles absolute paths starting with / that contain /src/', () => {
    const result = resolveSourcePath(
      '/Users/me/project/src/components/Foo.tsx',
      undefined,
      'http://localhost:3000/app.js'
    );
    expect(result).toBe('/Users/me/project/src/components/Foo.tsx');
  });

  it('strips webpack:/// prefix', () => {
    const result = resolveSourcePath(
      'webpack:///src/components/Foo.tsx',
      undefined,
      'http://localhost:3000/app.js'
    );
    expect(result).toBe('/src/components/Foo.tsx');
  });
});

// ─── resolveLocation — Next.js RSC fast path ───────────────────────────────

describe('resolveLocation — Next.js dev server integration', () => {
  const originalFetch = globalThis.fetch;
  let hadWindow: boolean;

  beforeEach(() => {
    clearCaches();
    hadWindow = typeof globalThis.window !== 'undefined';
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

  const nextjsRscStackLine =
    'at LandingPage (about://React/Server/file:///Users/testuser/Projects/sample-app/web/.next/server/chunks/ssr/%5Broot-of-the-server%5D__63dfaf64._.js?20:141:295)';

  it('resolves via __nextjs_original-stack-frames for Next.js RSC URLs', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            status: 'fulfilled',
            value: {
              originalStackFrame: {
                file: '/Users/testuser/Projects/sample-app/web/src/app/page.tsx',
                methodName: 'LandingPage',
                arguments: [],
                line1: 42,
                column1: 10,
                ignored: false,
              },
              originalCodeFrame: '  42 | export default function LandingPage() {',
            },
          },
        ]),
    });
    globalThis.fetch = mockFetch;

    const result = await resolveLocation(nextjsRscStackLine);

    expect(result).not.toBeNull();
    expect(result?.source).toBe('/Users/testuser/Projects/sample-app/web/src/app/page.tsx');
    expect(result?.line).toBe(42);
    expect(result?.column).toBe(10);
    expect(result?.name).toBe('LandingPage');

    // Should have posted to __nextjs_original-stack-frames
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/__nextjs_original-stack-frames');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.isServer).toBe(true);
    expect(body.frames).toHaveLength(1);
    expect(body.frames[0].file).toBe(
      '/Users/testuser/Projects/sample-app/web/.next/server/chunks/ssr/[root-of-the-server]__63dfaf64._.js'
    );
    expect(body.frames[0].line1).toBe(141);
    expect(body.frames[0].column1).toBe(295);
  });

  it('falls back to __nextjs_source-map when __nextjs_original-stack-frames fails', async () => {
    const mockFetch = vi
      .fn()
      // First call: __nextjs_original-stack-frames returns error
      .mockResolvedValueOnce({ ok: false, status: 500 })
      // Second call: __nextjs_source-map returns a valid source map
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              version: 3,
              file: 'output.js',
              sources: ['file:///Users/testuser/Projects/sample-app/web/src/app/page.tsx'],
              sourcesContent: [
                'export default function LandingPage() {\n  return <div>Hello</div>;\n}',
              ],
              names: ['LandingPage'],
              mappings:
                ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;oBAAmB',
            })
          ),
      });
    globalThis.fetch = mockFetch;

    await resolveLocation(nextjsRscStackLine);

    // Should have called both endpoints
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:3000/__nextjs_original-stack-frames');
    expect(mockFetch.mock.calls[1][0]).toContain('/__nextjs_source-map?filename=');
  });

  it('returns null when both Next.js endpoints fail', async () => {
    const mockFetch = vi
      .fn()
      // __nextjs_original-stack-frames: 404
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // __nextjs_source-map: 404
      .mockResolvedValueOnce({ ok: false, status: 404 });
    globalThis.fetch = mockFetch;

    const result = await resolveLocation(nextjsRscStackLine);

    expect(result).toBeNull();
  });

  it('caches Next.js dev server unavailability (404) and skips on subsequent calls', async () => {
    const mockFetch = vi
      .fn()
      // First attempt: 404 for stack-frames, 404 for source-map
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // Second attempt: should skip stack-frames endpoint entirely
      .mockResolvedValueOnce({ ok: false, status: 404 });
    globalThis.fetch = mockFetch;

    // First call — probes and gets 404, caches unavailability
    await resolveLocation(nextjsRscStackLine);

    // Second call — should skip __nextjs_original-stack-frames (cached 404)
    // and go directly to __nextjs_source-map
    await resolveLocation(
      'at Foo (about://React/Server/file:///Users/testuser/Projects/other/.next/server/chunks/ssr/foo.js:1:1)'
    );

    // First call: stack-frames(404) + source-map(404) = 2 fetches
    // Second call: only source-map(404) = 1 fetch (skipped stack-frames)
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // The third fetch should be __nextjs_source-map (not stack-frames)
    expect(mockFetch.mock.calls[2][0]).toContain('/__nextjs_source-map');
  });

  it('does not use Next.js fast path for non-Next.js RSC URLs', async () => {
    // RSC URL without /.next/ — not a Next.js project
    const nonNextjsRscLine =
      'at Comp (rsc://React/Server/file:///Users/testuser/Projects/other/build/server/page.js:5:10)';

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    // Non-Next.js RSC URLs skip the Next.js fast path and fall through to the
    // standard path where they're rejected as non-fetchable (rsc:// scheme)
    const result = await resolveLocation(nonNextjsRscLine);

    expect(result).toBeNull();
    // Should NOT have called any Next.js endpoint — the rsc:// URL is rejected
    // by hasNonFetchableScheme before any fetch occurs
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not use Next.js fast path for regular HTTP URLs', async () => {
    const httpStackLine = 'at Component (http://localhost:3000/_next/static/chunks/app.js:100:20)';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('// js code without source map'),
    });
    globalThis.fetch = mockFetch;

    await resolveLocation(httpStackLine);

    // Should fetch the JS file directly, not use Next.js endpoints
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:3000/_next/static/chunks/app.js');
  });

  it('caches the resolved result from Next.js dev server (L1 cache)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            status: 'fulfilled',
            value: {
              originalStackFrame: {
                file: '/Users/testuser/Projects/sample-app/web/src/app/page.tsx',
                methodName: 'LandingPage',
                arguments: [],
                line1: 42,
                column1: 10,
                ignored: false,
              },
              originalCodeFrame: null,
            },
          },
        ]),
    });
    globalThis.fetch = mockFetch;

    // First call — hits the endpoint
    const result1 = await resolveLocation(nextjsRscStackLine);
    expect(result1).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call — should use L1 cache, no additional fetch
    const result2 = await resolveLocation(nextjsRscStackLine);
    expect(result2).toEqual(result1);
    expect(mockFetch).toHaveBeenCalledTimes(1); // still 1
  });
});
