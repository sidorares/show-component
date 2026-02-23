import type { ResolvedSourceInfo } from './source-location-resolver';
import type { ClickToNodeInfo, Fiber } from './types';

/**
 * A single entry in the transformed component chain, as displayed to the user.
 * Produced by a {@link ChainTransformer} from the raw fiber chain.
 */
export interface TransformedEntry {
  /** Display label shown in the chain popover (replaces raw component name). */
  label: string;

  /**
   * The original chain entry used as fallback for:
   * - Source resolution (when {@link resolveLocation} is not provided)
   * - Props display (when {@link props} is not provided)
   */
  sourceEntry: ClickToNodeInfo;

  /**
   * Override source location resolution.  Called lazily when the user clicks
   * this entry in the chain popover.  Return `null` to indicate resolution
   * failed; the UI will fall back to default fiber-based resolution via
   * {@link sourceEntry}.
   */
  resolveLocation?: () => Promise<{
    source: string;
    line: number;
    column: number;
  } | null>;

  /** Override props for the inspector popup.  Defaults to `sourceEntry.props`. */
  props?: Record<string, unknown>;
}

/**
 * Context injected by the library when invoking a chain transformer.
 * Provides access to source-map resolution and fiber introspection helpers
 * so that transformers don't need to import library internals directly.
 */
export interface ChainTransformContext {
  /**
   * Resolve a stack-frame string to the original source location via source maps.
   * The returned {@link ResolvedSourceInfo} may include `sourceContent` when the
   * source map embeds it — useful for AST-based prop location refinement.
   */
  resolveLocation: (stackFrame: string, debug?: boolean) => Promise<ResolvedSourceInfo | null>;

  /** Extract a human-readable component name from a React fiber. */
  getComponentName: (fiber: Fiber) => string;

  /** Extract the relevant stack-frame line from a fiber's `_debugStack`. */
  getStackFrame: (fiber: Fiber) => string | undefined;

  /** When true, transformer engine emits verbose console logs. */
  debug?: boolean;
}

/**
 * Transforms the raw component chain before display.
 *
 * Receives the full chain (DOM-nearest element first) and returns a new chain
 * of {@link TransformedEntry} objects.  A transformer can:
 *
 * - **Collapse** multiple entries into one (e.g. `span → FormattedMessage` → `"message text"`)
 * - **Relabel** entries (change display text)
 * - **Override navigation** (point to a specific prop value instead of the component call site)
 * - **Remove** entries from the chain
 *
 * The function must be **synchronous** — any async work (source fetching, AST
 * parsing) should be deferred into the returned {@link TransformedEntry.resolveLocation}
 * closures, which are called lazily when the user clicks.
 */
export type ChainTransformer = (
  chain: ClickToNodeInfo[],
  context: ChainTransformContext
) => TransformedEntry[];

/** Identity transform — maps each chain entry 1:1 with `label = componentName`. */
export function defaultTransform(chain: ClickToNodeInfo[]): TransformedEntry[] {
  return chain.map((entry) => ({
    label: entry.componentName,
    sourceEntry: entry,
    props: entry.props,
  }));
}

/**
 * Applies a chain transformer if one is provided, falling back to the identity
 * transform otherwise.
 */
export function applyTransformer(
  chain: ClickToNodeInfo[],
  transformer: ChainTransformer | undefined,
  context: ChainTransformContext
): TransformedEntry[] {
  if (!transformer) return defaultTransform(chain);
  return transformer(chain, context);
}
