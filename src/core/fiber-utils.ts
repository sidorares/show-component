import type { ClickToNodeInfo, Fiber } from './types';

export function getComponentName(fiber: Fiber): string {
  try {
    if (typeof fiber.type === 'function') {
      const func = fiber.type as { name?: string; displayName?: string };
      const name = func.name || func.displayName;
      if (typeof name === 'string' && name.length > 0) {
        return name;
      }

      // Fallback: parse the function's toString() for a name
      try {
        const funcStr = fiber.type.toString();
        const match = funcStr.match(/^function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
        if (match?.[1]) {
          return match[1];
        }
      } catch {
        // toString() can throw on exotic callables
      }

      return 'Anonymous Function Component';
    }

    if (typeof fiber.type === 'string') {
      return fiber.type;
    }

    if (fiber.type && typeof fiber.type === 'object') {
      const obj = fiber.type as Record<string, unknown>;

      if (obj.$$typeof && obj.render) {
        const render = obj.render as { name?: string; displayName?: string };
        const renderName = render.name || render.displayName;
        return renderName && typeof renderName === 'string'
          ? `ForwardRef(${renderName})`
          : 'ForwardRef(Anonymous)';
      }

      if (obj.$$typeof && obj.type) {
        const wrappedName = getComponentNameFromType(obj.type);
        return wrappedName && typeof wrappedName === 'string' && wrappedName.length > 0
          ? `Memo(${wrappedName})`
          : 'Memo(Anonymous)';
      }

      if (obj.displayName && typeof obj.displayName === 'string') {
        return obj.displayName;
      }
      if (obj.name && typeof obj.name === 'string') {
        return obj.name;
      }

      return 'Component (Object Type)';
    }

    if (!fiber.type) {
      return 'Component (No Type)';
    }

    return 'Component Name Unknown';
  } catch {
    return 'Component Name Unknown';
  }
}

function getComponentNameFromType(type: unknown): string {
  try {
    if (typeof type === 'string') {
      return type;
    }

    if (typeof type === 'function') {
      const func = type as { displayName?: string; name?: string };
      return func.displayName || func.name || 'Anonymous';
    }

    if (type && typeof type === 'object') {
      const obj = type as { displayName?: string; name?: string };
      if (obj.displayName && typeof obj.displayName === 'string') {
        return obj.displayName;
      }

      if (obj.name && typeof obj.name === 'string') {
        return obj.name;
      }
    }

    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// Which meaningful stack frame to use (0-based, after filtering React internals).
// 0 = first non-internal frame (usually jsxDEV), 1 = the actual user component.
const STACK_FRAME_INDEX = 1;

/**
 * Returns `true` for stack-frame lines that can never resolve to user code
 * and should be excluded when looking for the "real" component frame.
 */
export function isUnresolvableFrame(line: string): boolean {
  // React internals shipped with the framework runtime
  if (line.includes('react-dom') || line.includes('scheduler') || line.includes('react-server-dom'))
    return true;

  // React debug-stack sentinels & helpers
  if (
    line.includes('fakeJSXCallSite') ||
    line.includes('react-stack-top-frame') ||
    line.includes('react_stack_bottom_frame') ||
    line.includes('initializeElement') ||
    line.includes('initializeFakeStack') ||
    line.includes('createFakeJSXCallStack')
  )
    return true;

  // Native built-ins (e.g. Promise.all) that have no source-mappable URL
  if (line.includes('<anonymous>')) return true;

  return false;
}

/** Extracts the relevant stack-trace frame from a fiber's `_debugStack`. */
export function getStackFrame(fiber: Fiber): string | undefined {
  const stack = fiber._debugStack?.stack;
  if (!stack) return undefined;

  const lines = stack.split('\n');
  const meaningfulLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !isUnresolvableFrame(line)) {
      meaningfulLines.push(line);
    }
  }

  return meaningfulLines[STACK_FRAME_INDEX] || meaningfulLines[0] || undefined;
}

/** Reads the React fiber attached to a DOM node via the internal `__reactFiber$…` property. */
export function findFiberElementFromNode(node: Node): Fiber | null {
  const properties = Object.getOwnPropertyNames(node);
  const fiberProperty = properties.find((p) => p.startsWith('__reactFiber'));
  if (!fiberProperty) return null;
  return node[fiberProperty as keyof typeof node] as unknown as Fiber;
}

/** Walks the fiber tree from a DOM node upward through `_debugOwner`. */
export function buildFiberChain(target: HTMLElement): ClickToNodeInfo[] {
  const chain: ClickToNodeInfo[] = [];
  let fiber = findFiberElementFromNode(target);

  while (fiber) {
    let props: Record<string, unknown> | undefined;
    try {
      if (fiber.memoizedProps) {
        props = fiber.memoizedProps as Record<string, unknown>;
      }
    } catch {
      props = undefined;
    }

    chain.push({
      componentName: getComponentName(fiber),
      stackFrame: getStackFrame(fiber),
      fiber,
      props,
    });
    fiber = fiber._debugOwner;
  }
  return chain;
}
