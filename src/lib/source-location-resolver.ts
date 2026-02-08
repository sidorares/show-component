import { SourceMapConsumer } from '@jridgewell/source-map';
// Frontend source location resolver
// Adapted from the backend source-mapper for browser environment
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

// Cache interfaces for frontend
interface CachedSourceMapData {
  sourceContent: string;
  sourceMapContent: string;
  sourceMapConsumer?: unknown; // Parsed source map for reuse
}

interface CachedResult {
  originalSource: ResolvedSourceInfo;
  timestamp: number;
}

// Frontend cache system (using Maps like backend)
const sourceMapCache = new Map<string, CachedSourceMapData>();
const resultCache = new Map<string, CachedResult>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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
  return _sourceRoot
    ?? (typeof window !== 'undefined'
      ? (window as Record<string, unknown>).__SHOW_COMPONENT_SOURCE_ROOT__ as string | undefined
      : undefined);
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
  sourceFileUrl: string,
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
    cleaned = root + '/' + cleaned;
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
 * Extracts URL, line, and column information from a stack trace line
 * Example input: "at exports.jsxDEV (http://localhost:3000/_next/static/chunks/node_modules_next_ec71d40b._.js:206:102)"
 */
export function extractStackFrameInfo(stackLine: string): StackFrameInfo | null {
  // Match various stack trace formats
  const patterns = [
    // Chrome/V8 format: "at functionName (url:line:column)"
    /at\s+([^(]+)\s*\((.+):(\d+):(\d+)\)/,
    // Chrome/V8 format without function name: "at url:line:column"
    /at\s+(.+):(\d+):(\d+)/,
    // Firefox format: "functionName@url:line:column"
    /([^@]+)@(.+):(\d+):(\d+)/,
    // Safari format: "functionName@url:line:column"
    /([^@]+)@(.+):(\d+):(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = stackLine.match(pattern);
    if (match) {
      if (match.length === 5) {
        // Format with function name
        return {
          functionName: match[1].trim(),
          url: match[2],
          line: Number.parseInt(match[3], 10),
          column: Number.parseInt(match[4], 10),
        };
      }
      if (match.length === 4) {
        // Format without function name
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
 * Converts RSC (React Server Component) URL to HTTP URL for fetching
 * RSC URL format: rsc://React/Server/file:///path/to/file.js?param
 * HTTP URL format: /api/dev/source-file/server/chunks/ssr/[filename].js
 */
function convertRscUrlToHttp(rscUrl: string): string {
  // Extract the file path from RSC URL
  // Format: rsc://React/Server/file:///absolute/path/to/file.js?param
  const match = rscUrl.match(/^rsc:\/\/React\/Server\/file:\/\/(.+?)(\?.*)?$/);

  if (!match) {
    throw new Error(`Invalid RSC URL format: ${rscUrl}`);
  }

  const filePath = match[1]; // /absolute/path/to/file.js

  // Extract the part after .next/ from the file path
  // Example: /Users/laplace/Projects/joboffer.fit/web/.next/server/chunks/ssr/file.js
  // Should become: server/chunks/ssr/file.js
  const nextIndex = filePath.indexOf('/.next/');
  if (nextIndex === -1) {
    throw new Error(`RSC URL does not contain .next folder: ${rscUrl}`);
  }

  const relativePath = filePath.substring(nextIndex + 7); // +7 to skip '/.next/'

  // Convert to development endpoint URL using path-based routing
  return `${window.location.origin}/api/dev/source-file/${relativePath}`;
}

/**
 * Fetches a source file from a URL (browser-compatible)
 * Now supports RSC (React Server Component) URLs
 * Returns both the content and the effective URL used for fetching
 */
export async function fetchSourceFile(
  url: string
): Promise<{ content: string; effectiveUrl: string }> {
  try {
    let fetchUrl: string;

    // Handle RSC URLs (React Server Component URLs)
    if (url.startsWith('rsc://React/Server/')) {
      fetchUrl = convertRscUrlToHttp(url);
      console.log(`🔄 Converting RSC URL to HTTP: ${url} -> ${fetchUrl}`);
    } else {
      // Handle regular HTTP URLs and relative URLs
      fetchUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    }

    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch source file: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();
    return { content, effectiveUrl: fetchUrl };
  } catch (error) {
    throw new Error(
      `Error fetching source file from ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Extracts source map URL from source file content using convert-source-map
 */
function extractSourceMapUrl(sourceContent: string): string | null {
  const converter = convertSourceMap.fromSource(sourceContent);

  if (!converter) {
    return null;
  }

  // Get the source map as an object to check if it's inline or external
  const sourceMapObj = converter.toObject();

  // If we have a source map object, it means it was inline (data URL)
  // For external source maps, we need to look for the comment manually
  // since convert-source-map doesn't extract the URL for external maps
  if (sourceMapObj && Object.keys(sourceMapObj).length > 0) {
    // This is an inline source map, we'll handle it differently in resolveSourceMap
    return 'inline';
  }

  // Fallback for external source maps - look for the comment
  const lines = sourceContent.split('\n');

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
    const line = lines[i].trim();

    // Check for sourceMappingURL comment
    const match = line.match(/^\/\/[@#]\s*sourceMappingURL=(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Resolves source map content (inline or external) - browser version
 */
export async function resolveSourceMap(
  sourceContent: string,
  sourceUrl: string
): Promise<string | null> {
  const sourceMapUrl = extractSourceMapUrl(sourceContent);

  if (!sourceMapUrl) {
    return null;
  }

  // Check if it's an inline source map
  if (sourceMapUrl === 'inline') {
    const converter = convertSourceMap.fromSource(sourceContent);
    if (converter) {
      return converter.toJSON();
    }
    return null;
  }

  // Check if it's a data URL (fallback for cases not handled by convert-source-map)
  if (sourceMapUrl.startsWith('data:')) {
    const match = sourceMapUrl.match(/^data:application\/json;(?:charset=utf-8;)?base64,(.+)$/);
    if (match) {
      // Use browser's atob instead of Buffer.from
      return atob(match[1]);
    }

    // Handle non-base64 inline source maps
    const jsonMatch = sourceMapUrl.match(/^data:application\/json;charset=utf-8,(.+)$/);
    if (jsonMatch) {
      return decodeURIComponent(jsonMatch[1]);
    }

    return null;
  }

  // External source map - construct absolute URL
  let absoluteSourceMapUrl: string;

  if (sourceMapUrl.startsWith('http')) {
    absoluteSourceMapUrl = sourceMapUrl;
  } else if (sourceMapUrl.startsWith('/')) {
    // Absolute path
    const baseUrl = new URL(sourceUrl);
    absoluteSourceMapUrl = `${baseUrl.protocol}//${baseUrl.host}${sourceMapUrl}`;
  } else {
    // Relative path
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
 * Maps generated position to original source using source map (browser version).
 * Returns the raw source path as-is from the source map — the caller is
 * responsible for resolving it (see resolveSourcePath).
 */
export async function mapToOriginalSource(
  frameInfo: StackFrameInfo,
  sourceMapContent: string
): Promise<{ info: OriginalSourceInfo; sourceRoot?: string } | null> {
  try {
    const sourceMap = JSON.parse(sourceMapContent);

    console.log('[sc:sourcemap] metadata:', {
      sourceRoot: sourceMap.sourceRoot,
      sources: sourceMap.sources?.slice(0, 5),
      sourcesLength: sourceMap.sources?.length,
      file: sourceMap.file,
    });

    const consumer = new SourceMapConsumer(sourceMap);

    const originalPosition = consumer.originalPositionFor({
      line: frameInfo.line,
      column: frameInfo.column,
    });

    console.log('[sc:sourcemap] originalPositionFor', {
      input: { line: frameInfo.line, column: frameInfo.column },
      output: originalPosition,
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

/**
 * Gets original source content from source map (browser version)
 */
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
 * Cached version of resolveLocation with two-level caching (frontend version)
 */
export async function resolveLocation(stackLine: string): Promise<ResolvedSourceInfo | null> {
  try {
    // Step 1: Extract frame info from stack line
    const frameInfo = extractStackFrameInfo(stackLine);
    if (!frameInfo) {
      console.warn('Could not extract frame info from stack line:', stackLine);
      return null;
    }

    const { url, line, column } = frameInfo;
    const cacheKey = `${url}:${line}:${column}`;

    // Level 1 Cache: Check if we have the exact result cached
    const cachedResult = resultCache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
      console.log('🎯 Frontend cache hit (Level 1 - exact result):', cacheKey);
      return cachedResult.originalSource;
    }

    // Level 2 Cache: Check if we have the source map data cached for this URL
    // First check with original URL, then try with converted URL for RSC URLs
    let sourceMapData = sourceMapCache.get(url);
    let effectiveUrl = url;

    if (!sourceMapData && url.startsWith('rsc://React/Server/')) {
      // For RSC URLs, also check cache with the converted HTTP URL
      effectiveUrl = convertRscUrlToHttp(url);
      sourceMapData = sourceMapCache.get(effectiveUrl);
    }

    if (!sourceMapData) {
      console.log('🔄 Frontend cache miss - fetching source and source map for:', url);

      // Step 2: Fetch the source file
      const sourceResult = await fetchSourceFile(url);
      effectiveUrl = sourceResult.effectiveUrl;

      // Step 3: Resolve source map using the effective URL for proper URL resolution
      const sourceMapContent = await resolveSourceMap(
        sourceResult.content,
        sourceResult.effectiveUrl
      );
      if (!sourceMapContent) {
        console.warn('No source map found for:', url);
        return null;
      }

      // Cache the source map data using both original and effective URLs for better cache hits
      sourceMapData = {
        sourceContent: sourceResult.content,
        sourceMapContent,
      };
      sourceMapCache.set(url, sourceMapData); // Cache with original URL
      if (url !== effectiveUrl) {
        sourceMapCache.set(effectiveUrl, sourceMapData); // Also cache with effective URL
      }
      console.log(
        '💾 Cached source map data for:',
        url,
        effectiveUrl !== url ? `and ${effectiveUrl}` : ''
      );
    } else {
      console.log('🎯 Frontend cache hit (Level 2 - source map data):', url);
    }

    // Step 4: Map to original source using cached source map
    const mapResult = await mapToOriginalSource(frameInfo, sourceMapData.sourceMapContent);
    if (!mapResult) {
      console.warn('Could not map to original source for:', frameInfo);
      return null;
    }

    // Step 4b: Resolve the raw source path from the source map
    const rawSource = mapResult.info.source;
    const resolvedSource = resolveSourcePath(rawSource, mapResult.sourceRoot, effectiveUrl);

    console.log('[sc:resolve] path resolution:', {
      raw: rawSource,
      sourceMapRoot: mapResult.sourceRoot,
      sourceFileUrl: effectiveUrl,
      configuredRoot: getSourceRoot(),
      resolved: resolvedSource,
    });

    const originalInfo: OriginalSourceInfo = {
      ...mapResult.info,
      source: resolvedSource,
    };

    // Step 5: Get original source content (optional, usually fast)
    // Use the RAW source path for content lookup (that's what the source map indexes by)
    const originalSourceContent = await getOriginalSourceContent(
      { ...originalInfo, source: rawSource },
      sourceMapData.sourceMapContent
    );

    const result: ResolvedSourceInfo = {
      ...originalInfo,
      sourceContent: originalSourceContent || undefined,
    };

    // Cache the final result
    resultCache.set(cacheKey, {
      originalSource: result,
      timestamp: Date.now(),
    });
    console.log('💾 Frontend cached result for:', cacheKey);

    return result;
  } catch (error) {
    console.error('Error resolving stack frame to original source:', error);
    return null;
  }
}

/**
 * Frontend cache cleanup function
 */
function cleanupCache() {
  const now = Date.now();

  // Clean up expired results
  for (const [key, value] of resultCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      resultCache.delete(key);
    }
  }

  console.log(
    `🧹 Frontend cache cleanup completed. Result cache size: ${resultCache.size}, Source map cache size: ${sourceMapCache.size}`
  );
}

// Run cleanup every 10 minutes
setInterval(cleanupCache, 10 * 60 * 1000);
