import JsonView from '@uiw/react-json-view';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from './components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover';
import { resolveLocation } from './lib/source-location-resolver';

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
  sourceUrl: string | undefined;
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
  sourceUrl: string | undefined;
  props: Record<string, unknown> | undefined;
};

type ClickToComponentRequest = {
  chain: ClickToNodeInfo[];
  navigateToChild?: boolean;
  selectedIndex?: number;
};

// Frontend cache for resolved locations
interface CachedResolvedLocation {
  source: string;
  line: number;
  column: number;
  timestamp: number;
}

// In-memory cache for resolved locations
const resolvedLocationCache = new Map<string, CachedResolvedLocation>();

// Helper function to create cache key from source URL
function createCacheKey(sourceUrl: string): string | null {
  // Extract URL and position from stack trace
  const patterns = [
    /at\s+[^(]+\s*\((.+):(\d+):(\d+)\)/,
    /at\s+(.+):(\d+):(\d+)/,
    /[^@]+@(.+):(\d+):(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = sourceUrl.match(pattern);
    if (match && match.length >= 4) {
      const url = match[1];
      const line = match[2];
      const column = match[3];
      return `${url}:${line}:${column}`;
    }
  }

  return null;
}

// Helper function to open file directly in editor using code:// protocol
function openInEditor(source: string, line: number, column: number): void {
  let cleanPath = source.replace(/^file:\/\//, '');
  cleanPath = decodeURIComponent(cleanPath);
  const url = `cursor://file${cleanPath}:${line}:${column}`;
  window.open(url, '_self');
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

function getSourceUrl(fiber: Fiber): string | undefined {
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
async function resolveSources(request: ClickToComponentRequest) {
  try {
    console.log('🔄 Client-side source resolution for request:', request);

    const resolvedChain: ResolvedClickToNodeInfo[] = await Promise.all(
      request.chain.map(async (node) => {
        if (!node.sourceUrl) {
          return {
            ...node,
            error: 'No source URL available',
          };
        }

        try {
          const originalSource = await resolveLocation(node.sourceUrl);
          return {
            componentName: node.componentName,
            sourceUrl: node.sourceUrl,
            originalSource: originalSource || undefined,
            error: originalSource ? undefined : 'Could not resolve to original source',
          };
        } catch (error) {
          return {
            componentName: node.componentName,
            sourceUrl: node.sourceUrl,
            error: `Error resolving source: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      })
    );

    console.log('✅ Client-side resolved chain:', resolvedChain);

    // Cache resolved locations for future use (same as server version)
    for (const node of resolvedChain) {
      if (node.originalSource && node.sourceUrl) {
        const cacheKey = createCacheKey(node.sourceUrl);
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
        openInEditor(source, line, column);
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

export function ShowComponent() {
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

  const handleComponentClick = async (index: number) => {
    const selectedComponent = fibersChain[index];
    if (!selectedComponent.sourceUrl) {
      console.warn('No source URL available for component:', selectedComponent.componentName);
      setIsPopoverOpen(false);
      return;
    }

    // Check frontend cache first (Hot scenario)
    const cacheKey = createCacheKey(selectedComponent.sourceUrl);
    if (cacheKey) {
      const cachedLocation = resolvedLocationCache.get(cacheKey);

      if (cachedLocation) {
        console.log('🎯 Frontend cache hit - opening directly:', cacheKey); // Try to open directly using protocol
        openInEditor(cachedLocation.source, cachedLocation.line, cachedLocation.column);
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

    await resolveSources(request);
    setIsPopoverOpen(false);
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
    },
    [draggingPopup]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingPopup(null);
  }, []);

  const closePopup = (popupId: string) => {
    setPropsPopups((prev) => prev.filter((p) => p.id !== popupId));
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
            sourceUrl: getSourceUrl(fiber),
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
            sourceUrl: getSourceUrl(fiber),
            props,
          });
          fiber = fiber._debugOwner;
        }

        // Navigate directly to the first (top) component in the chain
        if (chain.length > 0) {
          const topComponent = chain[0];
          if (topComponent.sourceUrl) {
            // Check frontend cache first
            const cacheKey = createCacheKey(topComponent.sourceUrl);
            if (cacheKey) {
              const cachedLocation = resolvedLocationCache.get(cacheKey);

              if (cachedLocation) {
                console.log('🎯 Frontend cache hit - opening directly:', cacheKey);
                openInEditor(cachedLocation.source, cachedLocation.line, cachedLocation.column);
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

            resolveSources(request);
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

  // Handle dragging events for multiple popups
  useEffect(() => {
    if (draggingPopup) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'grabbing';
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
  }, [draggingPopup, handleMouseMove, handleMouseUp]);

  return (
    <>
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
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-4">
            <h4 className="font-medium text-sm mb-3">React Component Chain</h4>
            <div className="space-y-1">
              {fibersChain.map((component, index) => (
                <div
                  key={`${component.componentName}-${index}`}
                  className="flex items-center gap-2"
                >
                  <Button
                    variant="ghost"
                    className="flex-1 justify-start text-left h-auto p-2 font-mono text-xs"
                    onClick={() => handleComponentClick(index)}
                  >
                    <span className="font-medium">{component.componentName}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 flex-shrink-0"
                    onClick={() => handlePropsClick(component)}
                  >
                    🌳
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Multiple Draggable Props Popups */}
      {propsPopups.map((popup, index) => (
        <div
          key={popup.id}
          className="fixed bg-white border border-gray-300 rounded-lg shadow-lg overflow-hidden flex flex-col"
          style={{
            left: `${popup.position.x}px`,
            top: `${popup.position.y}px`,
            width: `${popup.size.width}px`,
            height: `${popup.size.height}px`,
            zIndex: 9999 + index, // Higher z-index for later popups
          }}
          onMouseDown={handleMouseDown(popup.id)}
        >
          <div className="drag-handle bg-gray-100 px-3 py-2 border-b cursor-move flex justify-between items-center select-none flex-shrink-0">
            <span className="font-medium text-sm">Props: {popup.component.componentName}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => closePopup(popup.id)}
            >
              ✕
            </Button>
          </div>
          <div
            className="flex-1 overflow-auto p-3"
            style={{
              overscrollBehavior: 'contain', // Prevent body scroll when reaching end
            }}
            onWheel={(e) => {
              // Prevent body scroll when scrolling in props popup
              const element = e.currentTarget;
              const { scrollTop, scrollHeight, clientHeight } = element;

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
                  fontFamily: 'monospace',
                }}
                collapsed={1}
                displayDataTypes={false}
                displayObjectSize={false}
              />
            ) : (
              <div className="text-gray-500 text-sm">No props available</div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
