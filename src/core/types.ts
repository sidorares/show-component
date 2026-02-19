export type Fiber = {
  type: string | ((...args: unknown[]) => unknown) | Record<string, unknown>;
  _debugOwner: Fiber | null;
  _debugStack: Error;
  memoizedProps?: Record<string, unknown>;
};

export type ClickToNodeInfo = {
  componentName: string;
  /** Raw stack-trace frame line, e.g. "at LevelD (http://…:18:26)" */
  stackFrame: string | undefined;
  /** The React fiber node — useful for debugging stack resolution issues. */
  fiber: Fiber;
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
