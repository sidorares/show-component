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
function resolveSourcePath(
  rawSource: string,
  sourceMapSourceRoot: string | undefined,
  sourceFileUrl: string
): string {
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
 * Converts an RSC (React Server Component) debug URL to a fetchable HTTP URL.
 *
 * Supports both `rsc://` and `about://` scheme variants:
 *   rsc://React/Server/file:///…/.next/server/chunks/ssr/file.js?v=1
 *   about://React/Server/file:///…/.next/server/chunks/ssr/file.js?v=1
 *   → {origin}/api/dev/source-file/server/chunks/ssr/file.js
 */
function convertRscUrlToHttp(rscUrl: string): string {
  const match = rscUrl.match(REACT_SERVER_URL_RE);
  if (!match) {
    throw new Error(`Invalid RSC URL format: ${rscUrl}`);
  }

  const filePath = match[1];
  const nextIndex = filePath.indexOf('/.next/');
  if (nextIndex === -1) {
    throw new Error(`RSC URL does not contain .next folder: ${rscUrl}`);
  }

  const relativePath = filePath.substring(nextIndex + 7); // skip '/.next/'
  return `${window.location.origin}/api/dev/source-file/${relativePath}`;
}

/**
 * Returns `true` when the URL uses a scheme that we cannot fetch
 * (e.g. `chrome-extension://`, `blob:`, `data:`, `about:` that is
 * *not* a React Server URL, etc.).
 *
 * Allows: `http(s)://`, relative URLs (no scheme), and React Server URLs.
 */
function hasNonFetchableScheme(url: string): boolean {
  if (isReactServerUrl(url)) return false;
  // Relative URLs and http(s) are fine
  if (url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://')) return false;
  // Anything else with a "scheme://" prefix is non-fetchable
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url);
}

/** Fetches a source file, handling RSC and regular HTTP/relative URLs. */
export async function fetchSourceFile(
  url: string
): Promise<{ content: string; effectiveUrl: string }> {
  // Reject URLs with schemes we cannot fetch (chrome-extension://, blob:, etc.)
  if (hasNonFetchableScheme(url)) {
    throw new Error(`Non-fetchable URL scheme: ${url}`);
  }

  let fetchUrl: string;

  if (isReactServerUrl(url)) {
    fetchUrl = convertRscUrlToHttp(url);
  } else {
    fetchUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
  }

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
 * convert-source-map handles inline maps; for external maps we scan the
 * last 10 lines manually because the library doesn't expose the raw URL.
 */
function extractSourceMapUrl(sourceContent: string): string | null {
  const converter = convertSourceMap.fromSource(sourceContent);
  if (!converter) {
    return null;
  }

  const sourceMapObj = converter.toObject();
  if (sourceMapObj && Object.keys(sourceMapObj).length > 0) {
    return 'inline';
  }

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
 */
export async function resolveLocation(stackLine: string): Promise<ResolvedSourceInfo | null> {
  try {
    const frameInfo = extractStackFrameInfo(stackLine);
    if (!frameInfo) {
      return null;
    }

    const { url, line, column } = frameInfo;
    const cacheKey = `${url}:${line}:${column}`;

    // L1: exact result cache
    const cachedResult = resultCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult.originalSource;
    }

    // L2: source map cache (keyed by URL)
    let sourceMapData = sourceMapCache.get(url);
    let effectiveUrl = url;

    // RSC URLs (rsc:// or about://) may be cached under their converted HTTP URL
    if (!sourceMapData && isReactServerUrl(url)) {
      effectiveUrl = convertRscUrlToHttp(url);
      sourceMapData = sourceMapCache.get(effectiveUrl);
    }

    if (!sourceMapData) {
      const sourceResult = await fetchSourceFile(url);
      effectiveUrl = sourceResult.effectiveUrl;

      const sourceMapContent = await resolveSourceMap(
        sourceResult.content,
        sourceResult.effectiveUrl
      );
      if (!sourceMapContent) {
        return null;
      }

      sourceMapData = {
        sourceContent: sourceResult.content,
        sourceMapContent,
      };
      boundedSet(sourceMapCache, url, sourceMapData, MAX_SOURCE_MAP_CACHE_SIZE);
      if (url !== effectiveUrl) {
        boundedSet(sourceMapCache, effectiveUrl, sourceMapData, MAX_SOURCE_MAP_CACHE_SIZE);
      }
    }

    const mapResult = await mapToOriginalSource(frameInfo, sourceMapData.sourceMapContent);
    if (!mapResult) {
      return null;
    }

    const rawSource = mapResult.info.source;
    const resolvedSource = resolveSourcePath(rawSource, mapResult.sourceRoot, effectiveUrl);

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

    return result;
  } catch (error) {
    console.error('Error resolving stack frame to original source:', error);
    return null;
  }
}

/** Clears all caches. */
export function clearCaches(): void {
  resultCache.clear();
  sourceMapCache.clear();
}


// 
// 
// http://localhost:3000/_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_774bbf31._.js
// http://localhost:3000/_next/static/chunks/2374f_next_dist_compiled_20dc070b._.js
// http://localhost:3000/_next/static/chunks/2374f_next_dist_compiled_20dc070b._.js

// http://localhost:3000about://React/Server/file:///Users/laplace/Projects/joboffer.fit/web/.next/server/chunks/ssr/%5Broot-of-the-server%5D__63dfaf64._.js?20
