import JsonView from '@uiw/react-json-view';
import { Braces, ExternalLink } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover';
import { resolveLocation, configureSourceRoot } from './lib/source-location-resolver';

// Import types from the API route
interface ResolvedSourceInfo {
  source: string;
  line: number;
  column: number;
  name?: string;
  sourceContent?: string;
}

interface ResolvedClickToNodeInfo {
  componentName: string;
  /** Raw stack-trace frame line, e.g. "at LevelD (http://…:18:26)" */
  stackFrame: string | undefined;
  originalSource?: ResolvedSourceInfo;
  error?: string;
}

type Fiber = {
  // Can be string, function, or complex React component object
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

type ClickToComponentRequest = {
  chain: ClickToNodeInfo[];
  navigateToChild?: boolean;
  selectedIndex?: number;
};

// ─── Public types ───────────────────────────────────────────────────────────

export interface NavigationEvent {
  /** Resolved (original) source file path */
  source: string;
  /** Line number in the original source */
  line: number;
  /** Column number in the original source */
  column: number;
  /** The cursor:// URL that would have been opened */
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
}

// Frontend cache for resolved locations
interface CachedResolvedLocation {
  source: string;
  line: number;
  column: number;
  timestamp: number;
}

// In-memory cache for resolved locations
const resolvedLocationCache = new Map<string, CachedResolvedLocation>();

// Helper function to create cache key from a stack-trace frame line
function createCacheKey(stackFrame: string): string | null {
  // Extract URL and position from stack trace
  const patterns = [
    /at\s+[^(]+\s*\((.+):(\d+):(\d+)\)/,
    /at\s+(.+):(\d+):(\d+)/,
    /[^@]+@(.+):(\d+):(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = stackFrame.match(pattern);
    if (match && match.length >= 4) {
      const url = match[1];
      const line = match[2];
      const column = match[3];
      return `${url}:${line}:${column}`;
    }
  }

  return null;
}

// Helper function to open file directly in editor using cursor:// protocol.
// Format: cursor://file/{absolute-path}:{line}:{column}
// (Same as vscode://file/{path}:{L}:{C} — Cursor inherits VS Code's URL handler.)
// When an `onNavigate` callback is provided the editor is NOT opened;
// the callback receives the resolved location instead.
function openInEditor(
  source: string,
  line: number,
  column: number,
  onNavigate?: ShowComponentProps['onNavigate'],
  componentName?: string,
): void {
  let cleanPath = source.replace(/^file:\/\//, '');
  cleanPath = decodeURIComponent(cleanPath);
  const url = `cursor://file${cleanPath}:${line}:${column}`;

  if (onNavigate) {
    onNavigate({ source: cleanPath, line, column, url, componentName });
  } else {
    // Use location.href for custom protocol URLs — window.open() may fail
    // to trigger the OS protocol handler in some browsers.  This is the
    // same approach VS Code's own workbench uses (see BrowserWindow).
    window.location.href = url;
  }
}

function getComponentName(fiber: Fiber): string {
  try {
    // Handle function components
    if (typeof fiber.type === 'function') {
      const func = fiber.type as { name?: string; displayName?: string };
      const name = func.name || func.displayName;
      if (typeof name === 'string' && name.length > 0) {
        return name;
      }

      // Try to extract name from function string representation
      try {
        const funcStr = fiber.type.toString();
        const match = funcStr.match(/^function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
        if (match?.[1]) {
          return match[1];
        }
      } catch {
        // Ignore toString errors
      }

      return 'Anonymous Function Component';
    }

    // Handle string components (DOM elements)
    if (typeof fiber.type === 'string') {
      return fiber.type;
    }

    // Handle object-type components (forwardRef, memo, etc.)
    if (fiber.type && typeof fiber.type === 'object') {
      const obj = fiber.type as Record<string, unknown>;

      // Handle React.forwardRef
      if (obj.$$typeof && obj.render) {
        const render = obj.render as { name?: string; displayName?: string };
        const renderName = render.name || render.displayName;
        if (typeof renderName === 'string' && renderName.length > 0) {
          return `ForwardRef(${renderName})`;
        }
        return 'ForwardRef(Anonymous)';
      }

      // Handle React.memo
      if (obj.$$typeof && obj.type) {
        const wrappedName = getComponentNameFromType(obj.type);
        if (typeof wrappedName === 'string' && wrappedName.length > 0) {
          return `Memo(${wrappedName})`;
        }
        return 'Memo(Anonymous)';
      }

      // Handle other object types
      if (obj.displayName && typeof obj.displayName === 'string') {
        return obj.displayName;
      }

      if (obj.name && typeof obj.name === 'string') {
        return obj.name;
      }

      return 'Component (Object Type)';
    }

    // Handle null/undefined
    if (!fiber.type) {
      return 'Component (No Type)';
    }

    // Fallback for any other type
    return 'Component Name Unknown';
  } catch (error) {
    console.warn('Error extracting component name:', error);
    return 'Component Name Unknown';
  }
}

// Helper function to extract name from various component types
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

// Configuration: which stack frame to use (0-based, after skipping "Error" line)
// 0 = first frame (usually React internals like jsxDEV)
// 1 = second frame (usually the actual user component)
const STACK_FRAME_INDEX = 1;

/** Extracts the relevant stack-trace frame line from a fiber's debug stack. */
function getStackFrame(fiber: Fiber): string | undefined {
  const stack = fiber._debugStack?.stack;
  if (!stack) return undefined;

  const lines = stack.split('\n');

  // Skip the first line (usually "Error") and filter out React internals
  const meaningfulLines = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.includes('react-dom') && !line.includes('scheduler')) {
      meaningfulLines.push(line);
    }
  }

  // Return the configured stack frame index, or fallback to first available
  return meaningfulLines[STACK_FRAME_INDEX] || meaningfulLines[0] || lines[1]?.trim();
}

function findFiberElementFromNode(node: Node): Fiber | null {
  // return a property that starts with "__reactFiber"
  const properties = Object.getOwnPropertyNames(node);
  const fiberProperty = properties.find((property) => property.startsWith('__reactFiber'));
  return node[fiberProperty as keyof typeof node] as unknown as Fiber;
}

// Client-side version using frontend source location resolver
async function resolveSources(
  request: ClickToComponentRequest,
  onNavigate?: ShowComponentProps['onNavigate'],
) {
  try {
    console.log('🔄 Client-side source resolution for request:', request);

    const resolvedChain: ResolvedClickToNodeInfo[] = await Promise.all(
      request.chain.map(async (node) => {
        if (!node.stackFrame) {
          return {
            ...node,
            error: 'No stack frame available',
          };
        }

        try {
          const originalSource = await resolveLocation(node.stackFrame);
          return {
            componentName: node.componentName,
            stackFrame: node.stackFrame,
            originalSource: originalSource || undefined,
            error: originalSource ? undefined : 'Could not resolve to original source',
          };
        } catch (error) {
          return {
            componentName: node.componentName,
            stackFrame: node.stackFrame,
            error: `Error resolving source: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      })
    );

    console.log('✅ Client-side resolved chain:', resolvedChain);

    // Cache resolved locations for future use (same as server version)
    for (const node of resolvedChain) {
      if (node.originalSource && node.stackFrame) {
        const cacheKey = createCacheKey(node.stackFrame);
        if (cacheKey) {
          resolvedLocationCache.set(cacheKey, {
            source: node.originalSource.source,
            line: node.originalSource.line,
            column: node.originalSource.column,
            timestamp: Date.now(),
          });
        }
      }
    }

    // Handle navigation if requested (same logic as server version)
    if (request.navigateToChild && request.selectedIndex !== undefined) {
      const selectedComponent = resolvedChain[request.selectedIndex];
      if (selectedComponent?.originalSource) {
        const { source, line, column } = selectedComponent.originalSource;
        console.log('🎯 Client-side navigation to:', { source, line, column });
        openInEditor(source, line, column, onNavigate, selectedComponent.componentName);
        return true; // Indicate successful navigation
      }
      console.error(
        '❌ Selected component could not be resolved to original source:',
        selectedComponent
      );
      return false;
    }

    return true; // Indicate successful resolution
  } catch (error) {
    console.error('❌ Error in client-side source resolution:', error);
    return false;
  }
}

export function ShowComponent({ onNavigate, sourceRoot }: ShowComponentProps = {}) {
  // Keep a stable ref so event handlers registered once (in useEffect [])
  // always see the latest callback without re-registering listeners.
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  // Sync sourceRoot prop → resolver config
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
    const selectedComponent = fibersChain[index];
    if (!selectedComponent.stackFrame) {
      console.warn('No stack frame available for component:', selectedComponent.componentName);
      setIsPopoverOpen(false);
      return;
    }

    // Check frontend cache first (Hot scenario)
    const cacheKey = createCacheKey(selectedComponent.stackFrame);
    if (cacheKey) {
      const cachedLocation = resolvedLocationCache.get(cacheKey);

      if (cachedLocation) {
        console.log('🎯 Frontend cache hit - opening directly:', cacheKey); // Try to open directly using protocol
        openInEditor(cachedLocation.source, cachedLocation.line, cachedLocation.column, onNavigateRef.current, selectedComponent.componentName);
        setIsPopoverOpen(false);
      }
    }

    // Cold scenario - make server request
    console.log('🔄 Frontend cache miss - making server request');
    const request: ClickToComponentRequest = {
      chain: fibersChain,
      navigateToChild: true,
      selectedIndex: index,
    };

    await resolveSources(request, onNavigateRef.current);
    setIsPopoverOpen(false);
  };

  // Navigate to a component's source directly (used from props popup)
  const handleNavigateFromPopup = async (component: ClickToNodeInfo) => {
    if (!component.stackFrame) return;

    // Check cache first
    const cacheKey = createCacheKey(component.stackFrame);
    if (cacheKey) {
      const cached = resolvedLocationCache.get(cacheKey);
      if (cached) {
        openInEditor(cached.source, cached.line, cached.column, onNavigateRef.current, component.componentName);
        return;
      }
    }

    // Cold path — resolve via source maps
    const request: ClickToComponentRequest = {
      chain: [component],
      navigateToChild: true,
      selectedIndex: 0,
    };
    await resolveSources(request, onNavigateRef.current);
  };

  const handlePropsClick = (component: ClickToNodeInfo) => {
    // Generate unique ID for this popup
    const popupId = `props-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Smart positioning with viewport boundary checks
    const popupWidth = 400;
    const popupHeight = 300;
    const cascadeOffset = 40;

    // Calculate base position with cascade
    let baseX = 200 + propsPopups.length * cascadeOffset;
    let baseY = 200 + propsPopups.length * cascadeOffset;

    // Viewport boundary checks
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // If popup would go off-screen horizontally, wrap to next "column"
    if (baseX + popupWidth > viewportWidth - 20) {
      const column = Math.floor(propsPopups.length / 5); // New column every 5 popups
      const row = propsPopups.length % 5;
      baseX = 50 + column * 200; // Reduced spacing for columns
      baseY = 100 + row * cascadeOffset;
    }

    // If still off-screen vertically, reset to top
    if (baseY + popupHeight > viewportHeight - 20) {
      baseY = 100;
    }

    // Always create a new popup - allow multiple dialogs for the same component
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
          if (proposed >= MIN_W) { newW = proposed; newX = resizingPopup.startPosX + dx; }
          else { newW = MIN_W; newX = resizingPopup.startPosX + (resizingPopup.startW - MIN_W); }
        }
        if (dir.includes('n')) {
          const proposed = resizingPopup.startH - dy;
          if (proposed >= MIN_H) { newH = proposed; newY = resizingPopup.startPosY + dy; }
          else { newH = MIN_H; newY = resizingPopup.startPosY + (resizingPopup.startH - MIN_H); }
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

  const startResize = (popupId: string, direction: string, popup: PropsPopup) => (e: React.MouseEvent) => {
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
    const handleContextMenu = (event: MouseEvent) => {
      // Check for Option+Shift+Right Click (Alt+Shift+Right Click)
      if (event.altKey && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();

        const target = event.target as HTMLElement;
        const chain: ClickToNodeInfo[] = [];
        let fiber = findFiberElementFromNode(target);

        while (fiber) {
          // Extract props from the fiber
          let props: Record<string, unknown> | undefined;
          try {
            if (fiber.memoizedProps) {
              props = fiber.memoizedProps as Record<string, unknown>;
            }
          } catch (error) {
            console.warn('Failed to extract props for component:', getComponentName(fiber), error);
            props = undefined;
          }

          chain.push({
            componentName: getComponentName(fiber),
            stackFrame: getStackFrame(fiber),
            props,
          });
          fiber = fiber._debugOwner;
        }

        if (chain.length > 0) {
          setFibersChain(chain);
          setPopoverPosition({ x: event.clientX, y: event.clientY });
          setIsPopoverOpen(true);
        }

        return;
      }

      // Option+Right Click: Navigate directly to top element
      if (event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();

        const target = event.target as HTMLElement;
        const chain: ClickToNodeInfo[] = [];
        let fiber = findFiberElementFromNode(target);

        while (fiber) {
          // Extract props from the fiber
          let props: Record<string, unknown> | undefined;
          try {
            if (fiber.memoizedProps) {
              props = fiber.memoizedProps as Record<string, unknown>;
            }
          } catch (error) {
            console.warn('Failed to extract props for component:', getComponentName(fiber), error);
            props = undefined;
          }

          chain.push({
            componentName: getComponentName(fiber),
            stackFrame: getStackFrame(fiber),
            props,
          });
          fiber = fiber._debugOwner;
        }

        // Navigate directly to the first (top) component in the chain
        if (chain.length > 0) {
          const topComponent = chain[0];
          if (topComponent.stackFrame) {
            // Check frontend cache first
            const cacheKey = createCacheKey(topComponent.stackFrame);
            if (cacheKey) {
              const cachedLocation = resolvedLocationCache.get(cacheKey);

              if (cachedLocation) {
                console.log('🎯 Frontend cache hit - opening directly:', cacheKey);
                openInEditor(cachedLocation.source, cachedLocation.line, cachedLocation.column, onNavigateRef.current, topComponent.componentName);
                return;
              }
            }

            // Cold scenario - make server request
            console.log('🔄 Frontend cache miss - making server request for top component');
            const request: ClickToComponentRequest = {
              chain,
              navigateToChild: true,
              selectedIndex: 0, // Always navigate to the first (top) component
            };

            resolveSources(request, onNavigateRef.current);
          }
        }

        return;
      }
    };

    document.addEventListener('contextmenu', handleContextMenu, true); // Use capture phase

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, []);

  // Handle dragging / resizing events for multiple popups
  useEffect(() => {
    const active = draggingPopup || resizingPopup;
    if (active) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      const resizeCursors: Record<string, string> = {
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
        ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
      };
      document.body.style.cursor = resizingPopup
        ? (resizeCursors[resizingPopup.direction] || 'nwse-resize')
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
      {/* Scoped styles — self-contained, no Tailwind CSS vars needed */}
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
          className="w-80 p-0"
          align="start"
          style={{
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,.15), 0 4px 10px -4px rgba(0,0,0,.08)',
            color: '#1f2937',
          }}
        >
          <div style={{ padding: '8px 6px' }}>
            {fibersChain.map((component, index) => {
              const hasProps = component.props &&
                Object.keys(component.props).some((k) => k !== 'children');

              return (
                <div
                  key={`${component.componentName}-${index}`}
                  className="sc-chain-row"
                >
                  <button
                    className="sc-chain-item"
                    onClick={() => handleComponentClick(index)}
                  >
                    {component.componentName}
                  </button>
                  {hasProps && (
                    <button
                      className="sc-icon-btn"
                      onClick={() => handlePropsClick(component)}
                      title="Inspect props"
                    >
                      <Braces size={14} strokeWidth={2} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Multiple Draggable Props Popups */}
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
            flexDirection: 'column' as const,
            color: '#1f2937',
          }}
          onMouseDown={handleMouseDown(popup.id)}
        >
          {/* Title bar */}
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
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {popup.component.componentName}
            </span>
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <button
                className="sc-icon-btn"
                onClick={() => handleNavigateFromPopup(popup.component)}
                title="Go to source"
              >
                <ExternalLink size={13} strokeWidth={2} />
              </button>
              <button
                className="sc-icon-btn"
                onClick={() => closePopup(popup.id)}
                title="Close"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>

          {/* Props content */}
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
                style={{ fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
                collapsed={1}
                displayDataTypes={false}
                displayObjectSize={false}
                shortenTextAfterLength={Math.max(20, Math.floor((popup.size.width - 60) / 7.2))}
              />
            ) : (
              <div style={{ color: '#9ca3af', fontSize: 13 }}>No props available</div>
            )}
          </div>

          {/* Edge & corner resize handles */}
          {(['n','s','e','w','ne','nw','se','sw'] as const).map((dir) => (
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

// ─── Scoped CSS for the popover & popup chrome ──────────────────────────────
// Injected via <style> so the component is fully self-contained and doesn't
// depend on Tailwind CSS variables being defined in the consumer's app.

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
/* Edge & corner resize handles — invisible hit zones */
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
