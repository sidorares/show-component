import JsonView from '@uiw/react-json-view';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover';
import { configureSourceRoot, resolveLocation } from './lib/source-location-resolver';

/* ── Inline SVG icons (replaces lucide-react to avoid 43 MB dependency) ── */

function BracesIcon({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

function ExternalLinkIcon({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

type Fiber = {
  type: string | ((...args: unknown[]) => unknown) | Record<string, unknown>;
  _debugOwner: Fiber | null;
  _debugStack: Error;
  memoizedProps?: Record<string, unknown>;
};

type ClickToNodeInfo = {
  componentName: string;
  /** Raw stack-trace frame line, e.g. "at LevelD (http://…:18:26)" */
  stackFrame: string | undefined;
  props: Record<string, unknown> | undefined;
};

export interface ComponentHandle {
  /** Display name of the component. */
  componentName: string;
  /** Props of the component (from React fiber internals). */
  props: Record<string, unknown> | undefined;
  /** Position in the chain (0 = closest to the clicked DOM element). */
  index: number;
  /**
   * Lazily resolve the original source location via source maps.
   * The result is cached — subsequent calls return instantly.
   * Only performs work (network fetch + source-map parse) when called.
   */
  resolveSource: () => Promise<{ source: string; line: number; column: number } | null>;
}

export interface NavigationEvent {
  /** Resolved (original) source file path */
  source: string;
  /** Line number in the original source */
  line: number;
  /** Column number in the original source */
  column: number;
  /** The editor protocol URL that would have been opened (e.g. cursor://file/…) */
  url: string;
  /** The component name that was navigated to, when available */
  componentName?: string;
}

export interface ShowComponentProps {
  /**
   * Called when the user triggers a navigation (Alt+Click or selecting a
   * component from the chain popover).  When provided the default
   * `window.open("cursor://…")` call is skipped; the consumer decides
   * what to do with the resolved location.
   */
  onNavigate?: (event: NavigationEvent) => void;

  /**
   * Absolute filesystem path to the project root.  Used to convert
   * URL-relative paths (like `/src/components/Foo.tsx`) into absolute
   * paths the editor can open (like `/Users/me/project/src/components/Foo.tsx`).
   *
   * Can also be set globally via `window.__SHOW_COMPONENT_SOURCE_ROOT__`.
   */
  sourceRoot?: string;

  /**
   * URL scheme used for editor navigation (the part before `://`).
   *
   * Common values: `"cursor"`, `"vscode"`, `"vscode-insiders"`, `"windsurf"`.
   *
   * @default "cursor"
   *
   * @example
   * // Open files in VS Code instead of Cursor
   * <ShowComponent editorScheme="vscode" />
   */
  editorScheme?: string;

  /**
   * Customise which component is navigated to on Alt + Right-Click.
   *
   * Receives the full component chain (closest-to-DOM-first) as an array
   * of {@link ComponentHandle} objects.  Each handle exposes the component
   * name and props immediately, plus a lazy `resolveSource()` that only
   * performs source-map resolution when called.
   *
   * Return a chain index to navigate to, or `null` / `undefined` to use
   * the default behaviour (index 0 — the closest component).
   *
   * May return synchronously (when only names/props are needed) or
   * asynchronously (when source resolution is required).
   */
  getClickTarget?: (
    chain: ComponentHandle[]
  ) => number | null | undefined | Promise<number | null | undefined>;
}

/**
 * Opens a file in the editor via a custom protocol (e.g. cursor://file/{path}:{L}:{C}).
 * When `onNavigate` is provided, the callback receives the resolved location
 * instead of triggering the protocol handler.
 */
function openInEditor(
  source: string,
  line: number,
  column: number,
  onNavigate?: ShowComponentProps['onNavigate'],
  componentName?: string,
  editorScheme = 'cursor'
): void {
  let cleanPath = source.replace(/^file:\/\//, '');
  cleanPath = decodeURIComponent(cleanPath);
  const url = `${editorScheme}://file${cleanPath}:${line}:${column}`;

  if (onNavigate) {
    onNavigate({ source: cleanPath, line, column, url, componentName });
  } else {
    // location.href (not window.open) is needed for custom protocol URLs —
    // some browsers won't trigger the OS handler otherwise.
    window.location.href = url;
  }
}

function getComponentName(fiber: Fiber): string {
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

/** Extracts the relevant stack-trace frame from a fiber's `_debugStack`. */
function getStackFrame(fiber: Fiber): string | undefined {
  const stack = fiber._debugStack?.stack;
  if (!stack) return undefined;

  const lines = stack.split('\n');
  const meaningfulLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.includes('react-dom') && !line.includes('scheduler')) {
      meaningfulLines.push(line);
    }
  }

  return meaningfulLines[STACK_FRAME_INDEX] || meaningfulLines[0] || lines[1]?.trim();
}

/** Reads the React fiber attached to a DOM node via the internal `__reactFiber$…` property. */
function findFiberElementFromNode(node: Node): Fiber | null {
  const properties = Object.getOwnPropertyNames(node);
  const fiberProperty = properties.find((p) => p.startsWith('__reactFiber'));
  if (!fiberProperty) return null;
  return node[fiberProperty as keyof typeof node] as unknown as Fiber;
}

/**
 * Resolves the source location for a single component and opens the editor.
 * Delegates to the resolver's own two-level cache.
 */
async function resolveAndNavigate(
  component: ClickToNodeInfo,
  onNavigate?: ShowComponentProps['onNavigate'],
  editorScheme?: string
): Promise<boolean> {
  if (!component.stackFrame) return false;

  try {
    const resolved = await resolveLocation(component.stackFrame);
    if (resolved) {
      openInEditor(
        resolved.source,
        resolved.line,
        resolved.column,
        onNavigate,
        component.componentName,
        editorScheme
      );
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function ShowComponent({
  onNavigate,
  sourceRoot,
  editorScheme,
  getClickTarget,
}: ShowComponentProps = {}) {
  // Keep stable refs so event handlers registered once (in useEffect [])
  // always see the latest callbacks without re-registering listeners.
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const editorSchemeRef = useRef(editorScheme);
  editorSchemeRef.current = editorScheme;

  const getClickTargetRef = useRef(getClickTarget);
  getClickTargetRef.current = getClickTarget;

  useEffect(() => {
    configureSourceRoot(sourceRoot);
  }, [sourceRoot]);

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [fibersChain, setFibersChain] = useState<ClickToNodeInfo[]>([]);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  interface PropsPopup {
    id: string;
    component: ClickToNodeInfo;
    position: { x: number; y: number };
    size: { width: number; height: number };
  }

  const [propsPopups, setPropsPopups] = useState<PropsPopup[]>([]);
  const [draggingPopup, setDraggingPopup] = useState<{
    id: string;
    offset: { x: number; y: number };
  } | null>(null);
  const [resizingPopup, setResizingPopup] = useState<{
    id: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startPosX: number;
    startPosY: number;
    direction: string;
  } | null>(null);

  const handleComponentClick = async (index: number) => {
    setIsPopoverOpen(false);
    await resolveAndNavigate(fibersChain[index], onNavigateRef.current, editorSchemeRef.current);
  };

  const handleNavigateFromPopup = async (component: ClickToNodeInfo) => {
    await resolveAndNavigate(component, onNavigateRef.current, editorSchemeRef.current);
  };

  const handlePropsClick = (component: ClickToNodeInfo) => {
    const popupId = `props-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const popupWidth = 400;
    const popupHeight = 300;
    const cascadeOffset = 40;

    let baseX = 200 + propsPopups.length * cascadeOffset;
    let baseY = 200 + propsPopups.length * cascadeOffset;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Wrap to next column when cascading would go off-screen
    if (baseX + popupWidth > viewportWidth - 20) {
      const column = Math.floor(propsPopups.length / 5);
      const row = propsPopups.length % 5;
      baseX = 50 + column * 200;
      baseY = 100 + row * cascadeOffset;
    }
    if (baseY + popupHeight > viewportHeight - 20) {
      baseY = 100;
    }

    const newPopup: PropsPopup = {
      id: popupId,
      component,
      position: { x: baseX, y: baseY },
      size: { width: popupWidth, height: popupHeight },
    };

    setPropsPopups((prev) => [...prev, newPopup]);
    setIsPopoverOpen(false); // Close the main popover
  };

  // Handle dragging of props popups
  const handleMouseDown = (popupId: string) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('drag-handle')) {
      const popup = propsPopups.find((p) => p.id === popupId);
      if (popup) {
        setDraggingPopup({
          id: popupId,
          offset: {
            x: e.clientX - popup.position.x,
            y: e.clientY - popup.position.y,
          },
        });
        e.preventDefault();
      }
    }
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (draggingPopup) {
        setPropsPopups((prev) =>
          prev.map((popup) =>
            popup.id === draggingPopup.id
              ? {
                  ...popup,
                  position: {
                    x: e.clientX - draggingPopup.offset.x,
                    y: e.clientY - draggingPopup.offset.y,
                  },
                }
              : popup
          )
        );
      }
      if (resizingPopup) {
        const MIN_W = 200;
        const MIN_H = 120;
        const dx = e.clientX - resizingPopup.startX;
        const dy = e.clientY - resizingPopup.startY;
        const dir = resizingPopup.direction;
        let newW = resizingPopup.startW;
        let newH = resizingPopup.startH;
        let newX = resizingPopup.startPosX;
        let newY = resizingPopup.startPosY;

        if (dir.includes('e')) newW = Math.max(MIN_W, resizingPopup.startW + dx);
        if (dir.includes('s')) newH = Math.max(MIN_H, resizingPopup.startH + dy);
        if (dir.includes('w')) {
          const proposed = resizingPopup.startW - dx;
          if (proposed >= MIN_W) {
            newW = proposed;
            newX = resizingPopup.startPosX + dx;
          } else {
            newW = MIN_W;
            newX = resizingPopup.startPosX + (resizingPopup.startW - MIN_W);
          }
        }
        if (dir.includes('n')) {
          const proposed = resizingPopup.startH - dy;
          if (proposed >= MIN_H) {
            newH = proposed;
            newY = resizingPopup.startPosY + dy;
          } else {
            newH = MIN_H;
            newY = resizingPopup.startPosY + (resizingPopup.startH - MIN_H);
          }
        }

        setPropsPopups((prev) =>
          prev.map((popup) =>
            popup.id === resizingPopup.id
              ? { ...popup, position: { x: newX, y: newY }, size: { width: newW, height: newH } }
              : popup
          )
        );
      }
    },
    [draggingPopup, resizingPopup]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingPopup(null);
    setResizingPopup(null);
  }, []);

  const closePopup = (popupId: string) => {
    setPropsPopups((prev) => prev.filter((p) => p.id !== popupId));
  };

  const startResize =
    (popupId: string, direction: string, popup: PropsPopup) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizingPopup({
        id: popupId,
        direction,
        startX: e.clientX,
        startY: e.clientY,
        startW: popup.size.width,
        startH: popup.size.height,
        startPosX: popup.position.x,
        startPosY: popup.position.y,
      });
    };

  useEffect(() => {
    /** Walks the fiber tree from a DOM node upward through `_debugOwner`. */
    function buildFiberChain(target: HTMLElement): ClickToNodeInfo[] {
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
          props,
        });
        fiber = fiber._debugOwner;
      }
      return chain;
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (!event.altKey) return;

      event.preventDefault();
      event.stopPropagation();

      const chain = buildFiberChain(event.target as HTMLElement);
      if (chain.length === 0) return;

      // Alt+Shift+RightClick: show the component chain popover
      if (event.shiftKey) {
        setFibersChain(chain);
        setPopoverPosition({ x: event.clientX, y: event.clientY });
        setIsPopoverOpen(true);
        return;
      }

      // Alt+RightClick: navigate to click target
      const clickTargetCb = getClickTargetRef.current;

      if (clickTargetCb) {
        // Build lightweight handles — resolveSource() closures are cheap to
        // create and only trigger real work (fetch + source-map parse) when
        // the consumer actually calls them.
        const handles: ComponentHandle[] = chain.map((c, i) => ({
          componentName: c.componentName,
          props: c.props,
          index: i,
          resolveSource: () =>
            c.stackFrame
              ? resolveLocation(c.stackFrame).then((r) =>
                  r ? { source: r.source, line: r.line, column: r.column } : null
                )
              : Promise.resolve(null),
        }));

        // Support both sync and async return values.
        Promise.resolve(clickTargetCb(handles)).then((targetIndex) => {
          const idx = targetIndex ?? 0;
          if (idx >= 0 && idx < chain.length) {
            resolveAndNavigate(chain[idx], onNavigateRef.current, editorSchemeRef.current);
          }
        });
      } else {
        resolveAndNavigate(chain[0], onNavigateRef.current, editorSchemeRef.current);
      }
    };

    // Capture phase so we intercept before the default context menu
    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, []);

  useEffect(() => {
    const active = draggingPopup || resizingPopup;
    if (active) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      const resizeCursors: Record<string, string> = {
        n: 'ns-resize',
        s: 'ns-resize',
        e: 'ew-resize',
        w: 'ew-resize',
        ne: 'nesw-resize',
        sw: 'nesw-resize',
        nw: 'nwse-resize',
        se: 'nwse-resize',
      };
      document.body.style.cursor = resizingPopup
        ? resizeCursors[resizingPopup.direction] || 'nwse-resize'
        : 'grabbing';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [draggingPopup, resizingPopup, handleMouseMove, handleMouseUp]);

  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static CSS string, no user input */}
      <style dangerouslySetInnerHTML={{ __html: SC_STYLES }} />

      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <div
            style={{
              position: 'fixed',
              left: popoverPosition.x,
              top: popoverPosition.y,
              width: 1,
              height: 1,
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          style={{
            width: '20rem',
            padding: 0,
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,.15), 0 4px 10px -4px rgba(0,0,0,.08)',
            color: '#1f2937',
          }}
        >
          <div style={{ padding: '8px 6px' }}>
            {fibersChain.map((component, index) => {
              const hasProps =
                component.props && Object.keys(component.props).some((k) => k !== 'children');

              return (
                <div key={`${component.componentName}-${index}`} className="sc-chain-row">
                  <button
                    type="button"
                    className="sc-chain-item"
                    onClick={() => handleComponentClick(index)}
                  >
                    {component.componentName}
                  </button>
                  {hasProps && (
                    <button
                      type="button"
                      className="sc-icon-btn"
                      onClick={() => handlePropsClick(component)}
                      title="Inspect props"
                    >
                      <BracesIcon size={14} strokeWidth={2} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {propsPopups.map((popup, index) => (
        <div
          key={popup.id}
          style={{
            position: 'fixed',
            left: popup.position.x,
            top: popup.position.y,
            width: popup.size.width,
            height: popup.size.height,
            zIndex: 9999 + index,
            background: '#fff',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,.15), 0 4px 10px -4px rgba(0,0,0,.08)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            color: '#1f2937',
          }}
          onMouseDown={handleMouseDown(popup.id)}
        >
          <div
            className="drag-handle"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              background: '#f3f4f6',
              borderBottom: '1px solid #e5e7eb',
              cursor: 'move',
              userSelect: 'none',
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>{popup.component.componentName}</span>
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <button
                type="button"
                className="sc-icon-btn"
                onClick={() => handleNavigateFromPopup(popup.component)}
                title="Go to source"
              >
                <ExternalLinkIcon size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="sc-icon-btn"
                onClick={() => closePopup(popup.id)}
                title="Close"
              >
                <svg
                  aria-hidden="true"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 10,
              overscrollBehavior: 'contain',
            }}
            onWheel={(e) => {
              const el = e.currentTarget;
              const { scrollTop, scrollHeight, clientHeight } = el;
              if (
                (e.deltaY > 0 && scrollTop + clientHeight >= scrollHeight) ||
                (e.deltaY < 0 && scrollTop <= 0)
              ) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            {popup.component.props ? (
              <JsonView
                value={popup.component.props}
                style={{
                  fontSize: '12px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                }}
                collapsed={1}
                displayDataTypes={false}
                displayObjectSize={false}
                shortenTextAfterLength={Math.max(20, Math.floor((popup.size.width - 60) / 7.2))}
              />
            ) : (
              <div style={{ color: '#9ca3af', fontSize: 13 }}>No props available</div>
            )}
          </div>

          {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((dir) => (
            <div
              key={dir}
              className={`sc-resize-edge sc-resize-${dir}`}
              onMouseDown={startResize(popup.id, dir, popup)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

// Scoped CSS injected via <style> — keeps the component self-contained
// without requiring Tailwind CSS variables in the consumer's app.
const SC_STYLES = `
.sc-chain-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.sc-chain-item {
  flex: 1;
  display: block;
  padding: 5px 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 500;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.1s;
  line-height: 1.4;
}
.sc-chain-item:hover {
  background-color: #f3f4f6;
}
.sc-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 5px;
  color: #6b7280;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.1s, color 0.1s;
}
.sc-icon-btn:hover {
  background-color: #e5e7eb;
  color: #1f2937;
}
/* Resize handles — invisible hit zones */
.sc-resize-edge { position: absolute; z-index: 1; }
.sc-resize-n  { top: 0; left: 8px; right: 8px; height: 5px; cursor: ns-resize; }
.sc-resize-s  { bottom: 0; left: 8px; right: 8px; height: 5px; cursor: ns-resize; }
.sc-resize-e  { top: 8px; right: 0; bottom: 8px; width: 5px; cursor: ew-resize; }
.sc-resize-w  { top: 8px; left: 0; bottom: 8px; width: 5px; cursor: ew-resize; }
.sc-resize-ne { top: 0; right: 0; width: 10px; height: 10px; cursor: nesw-resize; }
.sc-resize-nw { top: 0; left: 0; width: 10px; height: 10px; cursor: nwse-resize; }
.sc-resize-se { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.sc-resize-sw { bottom: 0; left: 0; width: 10px; height: 10px; cursor: nesw-resize; }
.sc-resize-se::after {
  content: '';
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 8px;
  height: 8px;
  background:
    linear-gradient(135deg, transparent 50%, #94a3b8 50%, #94a3b8 55%, transparent 55%,
      transparent 65%, #94a3b8 65%, #94a3b8 70%, transparent 70%,
      transparent 80%, #94a3b8 80%, #94a3b8 85%, transparent 85%);
  opacity: 0.4;
  transition: opacity 0.15s;
  pointer-events: none;
}
.sc-resize-se:hover::after {
  opacity: 0.8;
}
`;
