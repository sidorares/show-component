import { SourceMapConsumer } from '@jridgewell/source-map';
import * as convertSourceMap from 'convert-source-map';

export interface StackFrameInfo {
  url: string;
  line: number;
  column: number;
  functionName?: string;
}

export interface OriginalSourceInfo {
  source: string;
  line: number;
  column: number;
  name?: string;
}

export interface ResolvedSourceInfo extends OriginalSourceInfo {
  sourceContent?: string;
}

interface CachedSourceMapData {
  sourceContent: string;
  sourceMapContent: string;
}

interface CachedResult {
  originalSource: ResolvedSourceInfo;
}

const MAX_RESULT_CACHE_SIZE = 500;
const MAX_SOURCE_MAP_CACHE_SIZE = 100;

/** Sets a value on a Map, evicting the oldest entry if the map exceeds `maxSize`. */
function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, maxSize: number): void {
  map.delete(key); // re-insert to refresh position (Map preserves insertion order)
  map.set(key, value);
  if (map.size > maxSize) {
    // The first key is the oldest entry
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
}

const sourceMapCache = new Map<string, CachedSourceMapData>();
const resultCache = new Map<string, CachedResult>();

// ─── Source root configuration ──────────────────────────────────────────────
// Allows converting URL-relative paths (e.g. /src/scenarios/DeepChain.tsx)
// into absolute filesystem paths that the editor can open.
//
// Set via:
//   1. configureSourceRoot('/absolute/path/to/project')    — programmatic
//   2. window.__SHOW_COMPONENT_SOURCE_ROOT__ = '/abs/path'  — global
//   3. <ShowComponent sourceRoot="/abs/path" />              — prop (calls #1)
//
// When unset, resolved paths are URL-relative (e.g. /src/scenarios/Foo.tsx).

let _sourceRoot: string | undefined;

export function configureSourceRoot(root: string | undefined): void {
  _sourceRoot = root ? root.replace(/\/+$/, '') : undefined;
}

function getSourceRoot(): string | undefined {
  return (
    _sourceRoot ??
    (typeof window !== 'undefined'
      ? ((window as unknown as Record<string, unknown>).__SHOW_COMPONENT_SOURCE_ROOT__ as
          | string
          | undefined)
      : undefined)
  );
}

/**
 * Resolves a potentially-relative source path from a source map against
 * the URL of the file that contained the source map.
 *
 * Example:
 *   rawSource  = "DeepChain.tsx"
 *   sourceUrl  = "http://localhost:5200/src/scenarios/DeepChain.tsx"
 *   sourceRoot from source map = "" (empty)
 *   → resolved = "/src/scenarios/DeepChain.tsx"
 *
 * If a filesystem sourceRoot is configured:
 *   → "/Users/me/project/src/scenarios/DeepChain.tsx"
 */
/** @internal — exported for testing */
export function resolveSourcePath(
  rawSource: string,
  sourceMapSourceRoot: string | undefined,
  sourceFileUrl: string
): string {
  // Strip file:// protocol — Turbopack emits sources like
  // "file:///Users/me/project/src/Foo.tsx" which are already absolute
  // filesystem paths once the scheme is removed.
  if (rawSource.startsWith('file://')) {
    const stripped = rawSource.replace(/^file:\/\//, '');
    // After removing "file://" we have "/Users/me/project/…" (absolute)
    if (stripped.startsWith('/')) {
      return stripped;
    }
  }

  // Already an absolute filesystem path — nothing to do
  if (rawSource.startsWith('/') && !rawSource.startsWith('//')) {
    const fsRoot = getSourceRoot();
    // If it already looks absolute AND has enough depth, trust it
    if (rawSource.includes('/src/') || rawSource.includes('/node_modules/')) {
      return rawSource;
    }
    return fsRoot ? fsRoot + rawSource : rawSource;
  }

  // Strip webpack:/// or similar protocol prefixes
  let cleaned = rawSource.replace(/^webpack:\/\/\//, '').replace(/^\.\/?/, '');

  // If the source map provided a sourceRoot, use it
  if (sourceMapSourceRoot && sourceMapSourceRoot !== '/' && sourceMapSourceRoot !== '') {
    const root = sourceMapSourceRoot.replace(/\/+$/, '');
    cleaned = `${root}/${cleaned}`;
  }

  // If still relative, resolve against the source file URL
  if (!cleaned.startsWith('/') && !cleaned.startsWith('http')) {
    try {
      const base = new URL(sourceFileUrl);
      const dir = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
      cleaned = dir + cleaned;
      // Normalize /../ and /./ sequences
      cleaned = new URL(cleaned, base.origin).pathname;
    } catch {
      // If URL parsing fails, fall through with what we have
    }
  }

  // If a filesystem source root is configured, convert URL path → absolute path
  const fsRoot = getSourceRoot();
  if (fsRoot && cleaned.startsWith('/')) {
    return fsRoot + cleaned;
  }

  return cleaned;
}

/**
 * Extracts URL, line, and column from a stack trace frame.
 *
 * Supported formats:
 *   - Chrome/V8:  `at fn (url:line:col)` or `at url:line:col`
 *   - Firefox/Safari: `fn@url:line:col`
 */
export function extractStackFrameInfo(stackLine: string): StackFrameInfo | null {
  const patterns = [
    /at\s+([^(]+)\s*\((.+):(\d+):(\d+)\)/, // at fn (url:line:col)
    /at\s+(.+):(\d+):(\d+)/, // at url:line:col
    /([^@]+)@(.+):(\d+):(\d+)/, // fn@url:line:col
  ];

  for (const pattern of patterns) {
    const match = stackLine.match(pattern);
    if (match) {
      if (match.length === 5) {
        return {
          functionName: match[1].trim(),
          url: match[2],
          line: Number.parseInt(match[3], 10),
          column: Number.parseInt(match[4], 10),
        };
      }
      if (match.length === 4) {
        return {
          url: match[1],
          line: Number.parseInt(match[2], 10),
          column: Number.parseInt(match[3], 10),
        };
      }
    }
  }

  return null;
}

/**
 * Matches React Server Component debug URLs.
 *
 * React / Next.js emits stack frames with special schemes that embed a
 * `file:///` filesystem path.  Known variants:
 *   - `rsc://React/Server/file:///…`   (React Flight / older Turbopack)
 *   - `about://React/Server/file:///…` (newer Turbopack builds)
 *
 * This pattern captures everything after the `file://` portion.
 */
const REACT_SERVER_URL_RE = /^(?:rsc|about):\/\/React\/Server\/file:\/\/(.+?)(\?.*)?$/;

/** Returns `true` when the URL uses a known React Server Component debug scheme. */
function isReactServerUrl(url: string): boolean {
  return url.startsWith('rsc://React/Server/') || url.startsWith('about://React/Server/');
}

/**
 * Returns `true` when the URL is a Next.js-specific RSC URL.
 *
 * Next.js RSC URLs contain `/.next/` in the path (the build output directory),
 * which distinguishes them from RSC URLs potentially produced by other frameworks.
 */
function isNextjsRscUrl(url: string): boolean {
  return isReactServerUrl(url) && url.includes('/.next/');
}

/**
 * Extracts the absolute filesystem path from an RSC debug URL.
 * URL-decodes the path to handle percent-encoded characters (e.g. %5B → [).
 *
 * Example:
 *   about://React/Server/file:///Users/me/proj/.next/server/chunks/ssr/%5Broot%5D__abc._.js?20
 *   → /Users/me/proj/.next/server/chunks/ssr/[root]__abc._.js
 */
function extractFilePathFromRscUrl(rscUrl: string): string | null {
  const match = rscUrl.match(REACT_SERVER_URL_RE);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// ─── Next.js Dev Server integration ─────────────────────────────────────────
// Next.js dev server exposes built-in endpoints for source-map resolution:
//   POST /__nextjs_original-stack-frames  — full server-side stack frame resolution
//   GET  /__nextjs_source-map?filename=…  — raw source map for a given file
//
// These leverage the bundler's in-memory compilation state (Webpack / Turbopack)
// and are more reliable than fetching compiled JS to extract source maps client-side.

/** Next.js StackFrame shape expected by `__nextjs_original-stack-frames`. */
interface NextStackFrame {
  file: string | null;
  methodName: string;
  arguments: string[];
  line1: number | null;
  column1: number | null;
}

interface NextOriginalStackFrameResponse {
  originalStackFrame: (NextStackFrame & { ignored: boolean }) | null;
  originalCodeFrame: string | null;
}

type NextOriginalStackFramesResponse = Array<
  | { status: 'fulfilled'; value: NextOriginalStackFrameResponse }
  | { status: 'rejected'; reason: string }
>;

/**
 * Tracks whether the Next.js dev server's stack-frame endpoint is available.
 * `undefined` = not yet probed, `true` = available, `false` = not available.
 */
let _nextDevServerAvailable: boolean | undefined;

/**
 * Resolves a React Server Component stack frame via the Next.js dev server's
 * built-in `POST /__nextjs_original-stack-frames` endpoint.
 *
 * This performs source map resolution server-side with full access to the
 * bundler's compilation state, which is more reliable than client-side
 * resolution for server-rendered files whose compiled JS isn't directly
 * fetchable via HTTP.
 */
async function resolveViaNextDevServer(
  frameInfo: StackFrameInfo,
  debug?: boolean
): Promise<ResolvedSourceInfo | null> {
  if (_nextDevServerAvailable === false) {
    if (debug) console.log('Next.js dev server endpoint previously unavailable, skipping');
    return null;
  }

  const filePath = extractFilePathFromRscUrl(frameInfo.url);
  if (!filePath) return null;

  try {
    const response = await fetch(`${window.location.origin}/__nextjs_original-stack-frames`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frames: [
          {
            file: filePath,
            methodName: frameInfo.functionName || '<unknown>',
            arguments: [],
            line1: frameInfo.line,
            column1: frameInfo.column,
          },
        ],
        isServer: true,
        isEdgeServer: false,
        isAppDirectory: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 404) {
        _nextDevServerAvailable = false;
        if (debug) console.log('Next.js __nextjs_original-stack-frames not found (404), disabling');
      }
      return null;
    }

    _nextDevServerAvailable = true;

    const results: NextOriginalStackFramesResponse = await response.json();
    if (!results.length) return null;

    const first = results[0];
    if (first.status !== 'fulfilled' || !first.value.originalStackFrame) {
      if (debug)
        console.log(
          'Next.js stack frame resolution rejected:',
          first.status === 'rejected' ? first.reason : 'no original frame'
        );
      return null;
    }

    const { originalStackFrame } = first.value;
    let sourcePath = originalStackFrame.file || frameInfo.url;

    // Next.js returns project-relative paths (e.g. "src/app/page.tsx").
    // Convert to absolute using the configured source root so the editor
    // can open the file directly.
    if (
      sourcePath &&
      !sourcePath.startsWith('/') &&
      !sourcePath.startsWith('file://') &&
      !sourcePath.includes('://')
    ) {
      const fsRoot = getSourceRoot();
      if (debug) {
        console.log('Source path is relative, resolving with sourceRoot:', {
          sourcePath,
          fsRoot,
        });
      }
      if (fsRoot) {
        sourcePath = `${fsRoot}/${sourcePath}`;
      }
    }

    if (debug) console.log('Final resolved source path:', sourcePath);

    return {
      source: sourcePath,
      line: originalStackFrame.line1 ?? frameInfo.line,
      column: originalStackFrame.column1 ?? frameInfo.column,
      name: originalStackFrame.methodName || undefined,
    };
  } catch (error) {
    if (debug) console.warn('Next.js dev server resolution failed:', error);
    return null;
  }
}

/**
 * Fetches a raw source map from the Next.js dev server's
 * `GET /__nextjs_source-map?filename=…` endpoint.
 *
 * Returns the source map JSON string, or `null` if unavailable.
 */
async function fetchSourceMapFromNextDevServer(
  filePath: string,
  debug?: boolean
): Promise<string | null> {
  try {
    const url = `${window.location.origin}/__nextjs_source-map?filename=${encodeURIComponent(filePath)}`;
    if (debug) console.log('Fetching source map from Next.js dev server:', url);

    const response = await fetch(url);
    if (!response.ok) {
      if (debug) console.log('__nextjs_source-map returned:', response.status);
      return null;
    }

    return await response.text();
  } catch (error) {
    if (debug) console.warn('Failed to fetch source map from Next.js dev server:', error);
    return null;
  }
}

/**
 * Returns `true` when the URL uses a scheme that we cannot fetch
 * (e.g. `chrome-extension://`, `blob:`, `data:`, `rsc://`, `about://`, etc.).
 *
 * Allows: `http(s)://` and relative URLs (no scheme).
 *
 * Note: React Server Component URLs (`rsc://`, `about://React/Server/…`) are
 * handled by the Next.js dev server fast path in {@link resolveLocation} and
 * are intentionally *not* fetchable through this path.
 */
function hasNonFetchableScheme(url: string): boolean {
  // Relative URLs and http(s) are fine
  if (url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://')) return false;
  // Anything else with a "scheme://" prefix is non-fetchable
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url);
}

/**
 * Fetches a source file over HTTP.
 *
 * Accepts absolute `http(s)://` URLs and root-relative paths (resolved against
 * `window.location.origin`).  Non-HTTP schemes (including RSC debug URLs) are
 * rejected — RSC resolution is handled by the Next.js fast path in
 * {@link resolveLocation}.
 */
export async function fetchSourceFile(
  url: string
): Promise<{ content: string; effectiveUrl: string }> {
  if (hasNonFetchableScheme(url)) {
    throw new Error(`Non-fetchable URL scheme: ${url}`);
  }

  const fetchUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;

  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch source file: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  return { content, effectiveUrl: fetchUrl };
}

/**
 * Returns `"inline"` for data-URL source maps, the external URL string
 * for `//# sourceMappingURL=…` comments, or `null` when absent.
 *
 * convert-source-map handles inline (data-URL) maps; for external maps
 * we scan the last 10 lines manually because the library doesn't expose
 * the raw URL.
 */
function extractSourceMapUrl(sourceContent: string): string | null {
  // 1. Check for inline (data-URL) source maps first
  const converter = convertSourceMap.fromSource(sourceContent);
  if (converter) {
    const sourceMapObj = converter.toObject();
    if (sourceMapObj && Object.keys(sourceMapObj).length > 0) {
      return 'inline';
    }
  }

  // 2. Fall through to external //# sourceMappingURL=… scan.
  //    This is the common case for Turbopack / webpack / esbuild
  //    production builds that emit a separate .map file.
  const lines = sourceContent.split('\n');
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
    const match = lines[i].trim().match(/^\/\/[@#]\s*sourceMappingURL=(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/** Resolves source map content — inline (data URL) or external (fetched). */
export async function resolveSourceMap(
  sourceContent: string,
  sourceUrl: string
): Promise<string | null> {
  const sourceMapUrl = extractSourceMapUrl(sourceContent);
  if (!sourceMapUrl) {
    return null;
  }

  if (sourceMapUrl === 'inline') {
    const converter = convertSourceMap.fromSource(sourceContent);
    return converter ? converter.toJSON() : null;
  }

  // Data URL fallback for edge cases not handled by convert-source-map
  if (sourceMapUrl.startsWith('data:')) {
    const base64 = sourceMapUrl.match(/^data:application\/json;(?:charset=utf-8;)?base64,(.+)$/);
    if (base64) {
      return atob(base64[1]);
    }
    const plainJson = sourceMapUrl.match(/^data:application\/json;charset=utf-8,(.+)$/);
    if (plainJson) {
      return decodeURIComponent(plainJson[1]);
    }
    return null;
  }

  // External source map — resolve to absolute URL
  let absoluteSourceMapUrl: string;
  if (sourceMapUrl.startsWith('http')) {
    absoluteSourceMapUrl = sourceMapUrl;
  } else if (sourceMapUrl.startsWith('/')) {
    const baseUrl = new URL(sourceUrl);
    absoluteSourceMapUrl = `${baseUrl.protocol}//${baseUrl.host}${sourceMapUrl}`;
  } else {
    const baseUrl = new URL(sourceUrl);
    const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
    absoluteSourceMapUrl = `${baseUrl.protocol}//${baseUrl.host}${basePath}${sourceMapUrl}`;
  }

  try {
    const response = await fetch(absoluteSourceMapUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch source map: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    console.warn(`Failed to fetch source map from ${absoluteSourceMapUrl}:`, error);
    return null;
  }
}

/**
 * Maps a generated position to the original source via source map.
 * Returns the raw source path as-is — the caller resolves it (see `resolveSourcePath`).
 */
export async function mapToOriginalSource(
  frameInfo: StackFrameInfo,
  sourceMapContent: string
): Promise<{ info: OriginalSourceInfo; sourceRoot?: string } | null> {
  try {
    const sourceMap = JSON.parse(sourceMapContent);

    const consumer = new SourceMapConsumer(sourceMap);

    const originalPosition = consumer.originalPositionFor({
      line: frameInfo.line,
      column: frameInfo.column,
    });

    if (
      originalPosition.source &&
      originalPosition.line !== null &&
      originalPosition.column !== null
    ) {
      return {
        info: {
          source: originalPosition.source,
          line: originalPosition.line,
          column: originalPosition.column,
          name: originalPosition.name || undefined,
        },
        sourceRoot: sourceMap.sourceRoot,
      };
    }

    return null;
  } catch (error) {
    console.error('Error parsing source map:', error);
    return null;
  }
}

/** Retrieves the original source content embedded in the source map, if available. */
export async function getOriginalSourceContent(
  originalInfo: OriginalSourceInfo,
  sourceMapContent: string
): Promise<string | null> {
  try {
    const sourceMap = JSON.parse(sourceMapContent);
    const consumer = new SourceMapConsumer(sourceMap);

    const sourceContent = consumer.sourceContentFor(originalInfo.source);

    return sourceContent;
  } catch (error) {
    console.error('Error getting source content:', error);
    return null;
  }
}

/**
 * Resolves a stack trace line to original source location using source maps.
 * Two-level cache: L1 caches the final resolved result, L2 caches the parsed
 * source map so multiple positions in the same file are fast.
 *
 * When `debug` is `true`, detailed logs are printed to the console showing
 * each step of the resolution pipeline.
 */
export async function resolveLocation(
  stackLine: string,
  debug?: boolean
): Promise<ResolvedSourceInfo | null> {
  try {
    if (debug) console.group('[show-component] resolveLocation');
    if (debug) console.log('Stack line:', stackLine);

    const frameInfo = extractStackFrameInfo(stackLine);
    if (!frameInfo) {
      if (debug) {
        console.warn('Could not extract frame info from stack line');
        console.groupEnd();
      }
      return null;
    }

    if (debug) console.log('Extracted frame:', frameInfo);

    const { url, line, column } = frameInfo;
    const cacheKey = `${url}:${line}:${column}`;

    // L1: exact result cache
    const cachedResult = resultCache.get(cacheKey);
    if (cachedResult) {
      if (debug) {
        console.log('L1 cache hit:', cachedResult.originalSource);
        console.groupEnd();
      }
      return cachedResult.originalSource;
    }
    if (debug) console.log('L1 cache miss');

    // ── Next.js RSC fast path ──────────────────────────────────────────────
    // For React Server Component URLs in Next.js, delegate resolution to the
    // built-in dev server endpoints which resolve source maps server-side
    // with full access to the bundler's compilation state.  This removes the
    // need for a custom /api/dev/source-file/ handler.
    if (isNextjsRscUrl(url)) {
      if (debug) console.log('Next.js RSC URL detected, trying built-in dev server endpoints');

      // Strategy 1: POST /__nextjs_original-stack-frames (full server-side resolution)
      const nextResult = await resolveViaNextDevServer(frameInfo, debug);
      if (nextResult) {
        boundedSet(resultCache, cacheKey, { originalSource: nextResult }, MAX_RESULT_CACHE_SIZE);
        if (debug) {
          console.log('Resolved via Next.js __nextjs_original-stack-frames:', nextResult);
          console.groupEnd();
        }
        return nextResult;
      }

      // Strategy 2: GET /__nextjs_source-map (fetch source map, resolve client-side)
      const filePath = extractFilePathFromRscUrl(url);
      if (filePath) {
        const sourceMapContent = await fetchSourceMapFromNextDevServer(filePath, debug);
        if (sourceMapContent) {
          if (debug) console.log('Got source map via __nextjs_source-map, resolving client-side');

          const mapResult = await mapToOriginalSource(frameInfo, sourceMapContent);
          if (mapResult) {
            const resolvedSource = resolveSourcePath(
              mapResult.info.source,
              mapResult.sourceRoot,
              url
            );
            const originalSourceContent = await getOriginalSourceContent(
              mapResult.info,
              sourceMapContent
            );
            const result: ResolvedSourceInfo = {
              ...mapResult.info,
              source: resolvedSource,
              sourceContent: originalSourceContent || undefined,
            };
            boundedSet(resultCache, cacheKey, { originalSource: result }, MAX_RESULT_CACHE_SIZE);
            if (debug) {
              console.log('Resolved via Next.js __nextjs_source-map:', result);
              console.groupEnd();
            }
            return result;
          }
        }
      }

      if (debug) {
        console.warn('All Next.js resolution methods failed for RSC URL:', url);
        console.groupEnd();
      }
      return null;
    }

    // ── Standard path (Vite, webpack, non-RSC HTTP URLs) ─────────────────

    // L2: source map cache (keyed by URL)
    let sourceMapData = sourceMapCache.get(url);
    let effectiveUrl = url;

    if (!sourceMapData) {
      if (debug) console.log('L2 cache miss — fetching source file:', url);

      const sourceResult = await fetchSourceFile(url);
      effectiveUrl = sourceResult.effectiveUrl;

      if (debug) console.log('Fetched source, effective URL:', effectiveUrl);

      const sourceMapContent = await resolveSourceMap(
        sourceResult.content,
        sourceResult.effectiveUrl
      );
      if (!sourceMapContent) {
        if (debug) {
          console.warn('No source map found for:', effectiveUrl);
          console.groupEnd();
        }
        return null;
      }

      if (debug) console.log('Source map resolved (length:', sourceMapContent.length, ')');

      sourceMapData = {
        sourceContent: sourceResult.content,
        sourceMapContent,
      };
      boundedSet(sourceMapCache, url, sourceMapData, MAX_SOURCE_MAP_CACHE_SIZE);
      if (url !== effectiveUrl) {
        boundedSet(sourceMapCache, effectiveUrl, sourceMapData, MAX_SOURCE_MAP_CACHE_SIZE);
      }
    } else {
      if (debug) console.log('L2 cache hit for:', url);
    }

    const mapResult = await mapToOriginalSource(frameInfo, sourceMapData.sourceMapContent);
    if (!mapResult) {
      if (debug) {
        console.warn('Source map lookup returned no result for position', { line, column });
        console.groupEnd();
      }
      return null;
    }

    if (debug) console.log('Mapped to original:', mapResult.info);

    const rawSource = mapResult.info.source;
    const resolvedSource = resolveSourcePath(rawSource, mapResult.sourceRoot, effectiveUrl);

    if (debug) {
      console.log('Source path resolution:', {
        rawSource,
        sourceRoot: mapResult.sourceRoot,
        effectiveUrl,
        resolvedSource,
      });
    }

    const originalInfo: OriginalSourceInfo = {
      ...mapResult.info,
      source: resolvedSource,
    };

    // Use the raw (pre-resolved) path for content lookup — that's what the source map indexes by
    const originalSourceContent = await getOriginalSourceContent(
      { ...originalInfo, source: rawSource },
      sourceMapData.sourceMapContent
    );

    const result: ResolvedSourceInfo = {
      ...originalInfo,
      sourceContent: originalSourceContent || undefined,
    };

    boundedSet(resultCache, cacheKey, { originalSource: result }, MAX_RESULT_CACHE_SIZE);

    if (debug) {
      console.log('Resolved result:', {
        source: result.source,
        line: result.line,
        column: result.column,
        name: result.name,
        hasSourceContent: !!result.sourceContent,
      });
      console.groupEnd();
    }

    return result;
  } catch (error) {
    if (debug) {
      console.error('Resolution failed:', error);
      console.groupEnd();
    }
    console.error('Error resolving stack frame to original source:', error);
    return null;
  }
}

/** Clears all caches (including the Next.js dev server availability flag). */
export function clearCaches(): void {
  resultCache.clear();
  sourceMapCache.clear();
  _nextDevServerAvailable = undefined;
}
