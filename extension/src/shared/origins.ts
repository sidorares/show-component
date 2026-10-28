/**
 * Site-access helpers. The extension always has access to local dev hosts
 * (`host_permissions` + static content scripts in manifest.json — keep the two
 * lists in sync with LOCAL_DEV_MATCHES). Any other site is an optional host
 * permission the user grants at runtime; the service worker registers content
 * scripts for whatever is currently granted.
 */

export const LOCAL_DEV_MATCHES = [
  'http://localhost/*',
  'https://localhost/*',
  'http://*.localhost/*',
  'https://*.localhost/*',
  'http://127.0.0.1/*',
  'https://127.0.0.1/*',
];

/** Returns the `scheme://host` origin of an http(s) URL, or null for anything else. */
export function normalizeOrigin(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Host permission pattern for an origin. Ports are dropped on purpose: Chrome
 * shows host permissions per host, and dev servers tend to hop between ports.
 */
export function originToMatchPattern(origin: string): string | null {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;
  const url = new URL(normalized);
  return `${url.protocol}//${url.hostname}/*`;
}

/** Host patterns granted on top of the always-on local dev hosts. */
export function extraGrantedPatterns(granted: string[] | undefined): string[] {
  return (granted ?? []).filter(
    (p) => !LOCAL_DEV_MATCHES.includes(p) && (p === '<all_urls>' || /^(\*|https?):\/\//.test(p))
  );
}

/**
 * Converts a host match pattern into declarativeContent URL filters, so the
 * toolbar icon can reflect whether the current page is covered. Paths are
 * ignored — every pattern this extension grants ends in `/*`.
 */
export function matchPatternToUrlFilters(pattern: string): chrome.events.UrlFilter[] {
  if (pattern === '<all_urls>') return [{ schemes: ['http', 'https'] }];
  const m = /^(\*|https?):\/\/([^/]+)\//.exec(pattern);
  if (!m) return [];
  const schemes = m[1] === '*' ? ['http', 'https'] : [m[1]];
  const host = m[2];
  if (host === '*') return [{ schemes }];
  if (host.startsWith('*.')) {
    const base = host.slice(2);
    return [
      { schemes, hostEquals: base },
      { schemes, hostSuffix: `.${base}` },
    ];
  }
  return [{ schemes, hostEquals: host }];
}
