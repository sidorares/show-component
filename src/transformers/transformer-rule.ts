import type {
  ChainTransformContext,
  ChainTransformer,
  TransformedEntry,
} from '../core/chain-transformer';
import type { ClickToNodeInfo, Fiber } from '../core/types';
import { findChildFiber, findJsxPropValueLocation } from './formatted-message';

// ─── Rule definition ─────────────────────────────────────────────────────────

export interface TransformerRule {
  id: string;
  name: string;
  /** Component name to match (e.g. "FormattedMessage", "Trans"). */
  componentName: string;
  /** Prop whose runtime value becomes the display label. */
  labelProp: string;
  /**
   * Prop whose *source-code location* is resolved for editor navigation.
   * Usually the same as {@link labelProp}.
   */
  navigateToProp: string;
  /**
   * - `childFiber` — search child fibers of native DOM elements for
   *   `componentName` (the FormattedMessage / i18n pattern).
   * - `direct` — match entries in the owner chain whose component name
   *   equals `componentName`, then relabel + override navigation.
   */
  matchStrategy: 'childFiber' | 'direct';
  /** Max depth for child-fiber DFS (default 3). Only used with `childFiber`. */
  maxSearchDepth?: number;
  /** Wrap the label string in quotes (default true). */
  labelQuoted?: boolean;
  /** Truncate labels longer than this (default 60). */
  labelMaxLength?: number;
}

// ─── Built-in presets ────────────────────────────────────────────────────────

export const TRANSFORMER_PRESETS: Record<string, TransformerRule> = {
  'react-intl': {
    id: 'react-intl',
    name: 'react-intl (FormattedMessage)',
    componentName: 'FormattedMessage',
    labelProp: 'defaultMessage',
    navigateToProp: 'defaultMessage',
    matchStrategy: 'childFiber',
  },
  'react-i18next': {
    id: 'react-i18next',
    name: 'react-i18next (Trans)',
    componentName: 'Trans',
    labelProp: 'defaults',
    navigateToProp: 'defaults',
    matchStrategy: 'childFiber',
  },
};

// ─── Generic rule-based engine ───────────────────────────────────────────────

function buildLabel(value: unknown, rule: TransformerRule): string {
  const maxLen = rule.labelMaxLength ?? 60;
  const quoted = rule.labelQuoted ?? true;

  if (typeof value !== 'string' || value.length === 0) {
    return rule.componentName;
  }

  const display = value.length > maxLen ? `${value.slice(0, maxLen - 3)}...` : value;
  return quoted ? `"${display}"` : display;
}

function buildResolveLocation(
  stackFrame: string | undefined,
  rule: TransformerRule,
  ctx: ChainTransformContext
): (() => Promise<{ source: string; line: number; column: number } | null>) | undefined {
  if (!stackFrame) return undefined;

  return async () => {
    const resolved = await ctx.resolveLocation(stackFrame);
    if (!resolved) return null;

    if (resolved.sourceContent) {
      const propLoc = findJsxPropValueLocation(
        resolved.sourceContent,
        resolved.line,
        resolved.column,
        rule.componentName,
        rule.navigateToProp
      );
      if (propLoc) {
        return { source: resolved.source, line: propLoc.line, column: propLoc.column };
      }
    }

    return { source: resolved.source, line: resolved.line, column: resolved.column };
  };
}

/**
 * Try to match a chain entry against a single rule using the `childFiber`
 * strategy.  Returns a {@link TransformedEntry} on match, or `null`.
 */
function matchChildFiber(
  entry: ClickToNodeInfo,
  rule: TransformerRule,
  ctx: ChainTransformContext
): TransformedEntry | null {
  if (typeof entry.fiber.type !== 'string') return null;

  const matched = findChildFiber(
    entry.fiber,
    (f: Fiber) => ctx.getComponentName(f) === rule.componentName,
    rule.maxSearchDepth ?? 3
  );
  if (!matched) return null;

  const props = matched.memoizedProps as Record<string, unknown> | undefined;
  const labelValue = props?.[rule.labelProp];
  // Prefer the child fiber's own stack frame; fall back to the parent DOM
  // element's frame (the one that's actually in the owner chain).
  const stackFrame = ctx.getStackFrame(matched) ?? entry.stackFrame;

  const info: ClickToNodeInfo = {
    componentName: rule.componentName,
    stackFrame,
    fiber: matched,
    props,
  };

  return {
    label: buildLabel(labelValue, rule),
    sourceEntry: info,
    props,
    resolveLocation: buildResolveLocation(stackFrame, rule, ctx),
  };
}

/**
 * Try to match a chain entry against a single rule using the `direct`
 * strategy.  Returns a {@link TransformedEntry} on match, or `null`.
 */
function matchDirect(
  entry: ClickToNodeInfo,
  rule: TransformerRule,
  ctx: ChainTransformContext
): TransformedEntry | null {
  if (entry.componentName !== rule.componentName) return null;

  const props = entry.props;
  const labelValue = props?.[rule.labelProp];

  return {
    label: buildLabel(labelValue, rule),
    sourceEntry: entry,
    props,
    resolveLocation: buildResolveLocation(entry.stackFrame, rule, ctx),
  };
}

/**
 * Creates a {@link ChainTransformer} driven by an array of declarative
 * {@link TransformerRule}s.  Each chain entry is tested against every rule
 * (first match wins).  Unmatched entries pass through unchanged.
 */
export function createRuleBasedTransformer(rules: TransformerRule[]): ChainTransformer {
  if (rules.length === 0) {
    return (chain) =>
      chain.map((entry) => ({
        label: entry.componentName,
        sourceEntry: entry,
        props: entry.props,
      }));
  }

  return (chain: ClickToNodeInfo[], ctx: ChainTransformContext): TransformedEntry[] => {
    const result: TransformedEntry[] = [];

    for (const entry of chain) {
      let transformed: TransformedEntry | null = null;

      for (const rule of rules) {
        transformed =
          rule.matchStrategy === 'childFiber'
            ? matchChildFiber(entry, rule, ctx)
            : matchDirect(entry, rule, ctx);
        if (transformed) break;
      }

      result.push(
        transformed ?? {
          label: entry.componentName,
          sourceEntry: entry,
          props: entry.props,
        }
      );
    }

    return result;
  };
}
