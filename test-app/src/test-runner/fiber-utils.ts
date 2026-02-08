/**
 * Fiber introspection utilities — extracted from ShowComponent.tsx
 *
 * These duplicate just enough of the library's internal logic to let the
 * TestRunner independently detect component names and ownership chains
 * from DOM nodes, so we can compare against ground-truth data attributes.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type Fiber = {
  type: string | ((...args: unknown[]) => unknown) | Record<string, unknown>;
  _debugOwner: Fiber | null;
  _debugStack: Error;
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number };
  memoizedProps?: Record<string, unknown>;
};

export interface ChainEntry {
  componentName: string;
  sourceUrl: string | undefined;
  isDomElement: boolean;
}

// ─── Fiber from DOM node ────────────────────────────────────────────────────

export function findFiberFromNode(node: Node): Fiber | null {
  const props = Object.getOwnPropertyNames(node);
  const key = props.find((p) => p.startsWith('__reactFiber'));
  if (!key) return null;
  return (node as unknown as Record<string, Fiber>)[key];
}

// ─── Component name extraction (mirrors library logic) ──────────────────────

export function getComponentName(fiber: Fiber): string {
  try {
    if (typeof fiber.type === 'function') {
      const fn = fiber.type as { name?: string; displayName?: string };
      const name = fn.name || fn.displayName;
      if (typeof name === 'string' && name.length > 0) return name;

      try {
        const s = fiber.type.toString();
        const m = s.match(/^function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
        if (m?.[1]) return m[1];
      } catch { /* ignore */ }

      return 'Anonymous Function Component';
    }

    if (typeof fiber.type === 'string') return fiber.type;

    if (fiber.type && typeof fiber.type === 'object') {
      const obj = fiber.type as Record<string, unknown>;

      // forwardRef
      if (obj.$$typeof && obj.render) {
        const render = obj.render as { name?: string; displayName?: string };
        const n = render.name || render.displayName;
        return n ? `ForwardRef(${n})` : 'ForwardRef(Anonymous)';
      }

      // memo
      if (obj.$$typeof && obj.type) {
        const wrappedName = getComponentNameFromType(obj.type);
        return wrappedName ? `Memo(${wrappedName})` : 'Memo(Anonymous)';
      }

      if (typeof obj.displayName === 'string') return obj.displayName;
      if (typeof obj.name === 'string') return obj.name;
      return 'Component (Object Type)';
    }

    if (!fiber.type) return 'Component (No Type)';
    return 'Component Name Unknown';
  } catch {
    return 'Component Name Unknown';
  }
}

function getComponentNameFromType(type: unknown): string {
  if (typeof type === 'string') return type;
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || 'Anonymous';
  }
  if (type && typeof type === 'object') {
    const obj = type as { displayName?: string; name?: string };
    if (typeof obj.displayName === 'string') return obj.displayName;
    if (typeof obj.name === 'string') return obj.name;
  }
  return 'Unknown';
}

// ─── Source URL extraction (mirrors library logic) ──────────────────────────

const STACK_FRAME_INDEX = 1;

export function getSourceUrl(fiber: Fiber): string | undefined {
  const stack = fiber._debugStack?.stack;
  if (!stack) return undefined;

  const lines = stack.split('\n');
  const meaningful: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.includes('react-dom') && !line.includes('scheduler')) {
      meaningful.push(line);
    }
  }
  return meaningful[STACK_FRAME_INDEX] || meaningful[0] || lines[1]?.trim();
}

// ─── Walk the ownership chain ───────────────────────────────────────────────

export function walkOwnerChain(startFiber: Fiber): ChainEntry[] {
  const chain: ChainEntry[] = [];
  let fiber: Fiber | null = startFiber;

  while (fiber) {
    chain.push({
      componentName: getComponentName(fiber),
      sourceUrl: getSourceUrl(fiber),
      isDomElement: typeof fiber.type === 'string',
    });
    fiber = fiber._debugOwner;
  }
  return chain;
}

/**
 * Returns only the component entries (non-DOM) from the ownership chain,
 * starting from the immediate owner of the given DOM fiber.
 */
export function getComponentChain(domFiber: Fiber): ChainEntry[] {
  return walkOwnerChain(domFiber).filter((e) => !e.isDomElement);
}

/**
 * Returns the name of the immediate owner component for a DOM fiber.
 */
export function getOwnerName(domFiber: Fiber): string | null {
  const owner = domFiber._debugOwner;
  return owner ? getComponentName(owner) : null;
}
