import type {
  ChainTransformContext,
  ChainTransformer,
  TransformedEntry,
} from '../core/chain-transformer';
import type { ClickToNodeInfo, Fiber } from '../core/types';
import { findChildFiber, findJsxPropValueLocation } from './formatted-message';

const LOG_PREFIX = '[show-component]';

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

// ─── Name matching helpers ────────────────────────────────────────────────────

const WRAPPER_RE = /^(?:Memo|ForwardRef)\((.+)\)$/;

/**
 * Strips React wrapper prefixes (`Memo(...)`, `ForwardRef(...)`) to recover
 * the base component name as it appears in JSX source code.
 */
function unwrapComponentName(name: string): string {
  let n = name;
  for (;;) {
    const m = WRAPPER_RE.exec(n);
    if (!m) return n;
    n = m[1];
  }
}

/**
 * Returns `true` when `actualName` refers to the same component as
 * `targetName`, ignoring `Memo(…)` / `ForwardRef(…)` wrappers on either side.
 */
function componentNameMatches(actualName: string, targetName: string): boolean {
  if (actualName === targetName) return true;
  return unwrapComponentName(actualName) === unwrapComponentName(targetName);
}

// ─── Generic rule-based engine ───────────────────────────────────────────────

/**
 * Extract a displayable string from a prop value.
 * Handles plain strings and compiled ICU message ASTs
 * (e.g. `[{ type: 0, value: "Hello" }, { type: 1, value: "name" }]`
 * produced by `babel-plugin-formatjs` / `@formatjs/ts-transformer`).
 */
function extractStringValue(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;

  if (!Array.isArray(value) || value.length === 0) return null;

  // Compiled ICU AST: array of parts where type 0 = literal, others = variables
  const parts: string[] = [];
  for (const part of value) {
    if (part && typeof part === 'object' && 'value' in part && typeof part.value === 'string') {
      // type 0 = literal text, type 1 = argument (variable)
      parts.push(part.type === 0 ? part.value : `{${part.value}}`);
    }
  }
  return parts.length > 0 ? parts.join('') : null;
}

function buildLabel(value: unknown, rule: TransformerRule): string {
  const maxLen = rule.labelMaxLength ?? 60;
  const quoted = rule.labelQuoted ?? true;

  const text = extractStringValue(value);
  if (!text) return rule.componentName;

  const display = text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
  return quoted ? `"${display}"` : display;
}

function buildResolveLocation(
  stackFrame: string | undefined,
  rule: TransformerRule,
  ctx: ChainTransformContext
): (() => Promise<{ source: string; line: number; column: number } | null>) | undefined {
  if (!stackFrame) {
    if (ctx.debug) {
      console.warn(LOG_PREFIX, `no stackFrame for rule "${rule.name}" — resolveLocation disabled`);
    }
    return undefined;
  }

  return async () => {
    const resolved = await ctx.resolveLocation(stackFrame);
    if (!resolved) {
      if (ctx.debug) {
        console.warn(LOG_PREFIX, `source resolution returned null for rule "${rule.name}"`, {
          stackFrame,
        });
      }
      return null;
    }

    if (resolved.sourceContent) {
      const jsxName = unwrapComponentName(rule.componentName);
      if (ctx.debug) {
        console.log(
          LOG_PREFIX,
          `AST searching for <${jsxName}> prop "${rule.navigateToProp}"`,
          `near ${resolved.source}:${resolved.line}:${resolved.column}`
        );
      }
      const propLoc = findJsxPropValueLocation(
        resolved.sourceContent,
        resolved.line,
        resolved.column,
        jsxName,
        rule.navigateToProp
      );
      if (propLoc) {
        if (ctx.debug) {
          console.log(
            LOG_PREFIX,
            `found prop value at ${resolved.source}:${propLoc.line}:${propLoc.column}`
          );
        }
        return { source: resolved.source, line: propLoc.line, column: propLoc.column };
      }
      if (ctx.debug) {
        console.warn(
          LOG_PREFIX,
          `prop "${rule.navigateToProp}" not found in AST, falling back to component location`
        );
      }
    } else if (ctx.debug) {
      console.warn(LOG_PREFIX, 'no sourceContent in resolved result — cannot do AST prop lookup');
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
    (f: Fiber) => componentNameMatches(ctx.getComponentName(f), rule.componentName),
    rule.maxSearchDepth ?? 3
  );

  if (!matched) {
    if (ctx.debug) {
      console.log(
        LOG_PREFIX,
        `childFiber: no "${rule.componentName}" found under <${entry.fiber.type}>`
      );
    }
    return null;
  }

  const matchedName = ctx.getComponentName(matched);
  const props = matched.memoizedProps as Record<string, unknown> | undefined;
  const labelValue = props?.[rule.labelProp];
  const childFrame = ctx.getStackFrame(matched);
  const stackFrame = childFrame ?? entry.stackFrame;

  if (ctx.debug) {
    console.log(LOG_PREFIX, `childFiber: matched "${matchedName}" under <${entry.fiber.type}>`, {
      fiber: matched,
      labelProp: rule.labelProp,
      labelValue: labelValue ?? '(missing)',
      stackFrame: childFrame ? 'from child fiber' : 'fallback to parent entry',
    });
  }

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
 * Walk the fiber's `_debugOwner` chain looking for a usable stack frame.
 * Stops after `maxDepth` hops to avoid traversing the entire tree.
 */
function findOwnerStackFrame(
  fiber: Fiber,
  ctx: ChainTransformContext,
  maxDepth = 3
): string | undefined {
  let owner = fiber._debugOwner;
  for (let i = 0; i < maxDepth && owner; i++) {
    const frame = ctx.getStackFrame(owner);
    if (frame) {
      if (ctx.debug) {
        console.log(
          LOG_PREFIX,
          `direct: borrowed stackFrame from owner "${ctx.getComponentName(owner)}" (depth ${i + 1})`
        );
      }
      return frame;
    }
    owner = owner._debugOwner;
  }
  return undefined;
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
  if (!componentNameMatches(entry.componentName, rule.componentName)) return null;

  const props = entry.props;
  const labelValue = props?.[rule.labelProp];
  const stackFrame = entry.stackFrame ?? findOwnerStackFrame(entry.fiber, ctx);

  if (ctx.debug) {
    console.log(LOG_PREFIX, `direct: matched "${entry.componentName}" via rule "${rule.name}"`, {
      fiber: entry.fiber,
      labelProp: rule.labelProp,
      labelValue: labelValue ?? '(missing)',
      stackFrame: entry.stackFrame ? 'own' : stackFrame ? 'from owner' : '(none)',
    });
  }

  return {
    label: buildLabel(labelValue, rule),
    sourceEntry: { ...entry, stackFrame },
    props,
    resolveLocation: buildResolveLocation(stackFrame, rule, ctx),
  };
}

/**
 * Try to match an entry against a rule using both strategies.
 * `childFiber` is attempted first (only fires on native elements),
 * then `direct` (only fires on matching component names).
 */
function matchEntry(
  entry: ClickToNodeInfo,
  rule: TransformerRule,
  ctx: ChainTransformContext
): TransformedEntry | null {
  return matchChildFiber(entry, rule, ctx) ?? matchDirect(entry, rule, ctx);
}

/**
 * Creates a {@link ChainTransformer} driven by an array of declarative
 * {@link TransformerRule}s.  Each chain entry is tested against every rule
 * using both `childFiber` and `direct` strategies (first match wins).
 *
 * Consecutive entries that transform to the same label are collapsed
 * (e.g. `FormattedMessage` + `Memo(FormattedMessage)` → single entry).
 * When collapsing, the entry with a `resolveLocation` callback is preferred.
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
    let prevWasDefaultNative = false;

    for (const entry of chain) {
      let transformed: TransformedEntry | null = null;

      for (const rule of rules) {
        transformed = matchEntry(entry, rule, ctx);
        if (transformed) break;
      }

      const output = transformed ?? {
        label: entry.componentName,
        sourceEntry: entry,
        props: entry.props,
      };

      const prev = result[result.length - 1];

      // Collapse consecutive entries with the same transformed label
      // (e.g. FormattedMessage + Memo(FormattedMessage) both become "Timeline").
      // Keep the one with a resolveLocation callback, or the later one.
      if (prev && transformed && prev.label === output.label) {
        if (ctx.debug) {
          console.log(LOG_PREFIX, `dedup: collapsing consecutive "${output.label}"`);
        }
        if (!prev.resolveLocation && output.resolveLocation) {
          result[result.length - 1] = output;
        }
        continue;
      }

      // A rule-matched entry directly following an unmatched native DOM element
      // means the native element is the rendered output of the matched component
      // (e.g. <FormattedMessage> renders a <span>). Absorb the native element
      // so the user sees the readable label instead.
      if (prev && transformed && prevWasDefaultNative) {
        if (ctx.debug) {
          console.log(
            LOG_PREFIX,
            `absorb: replacing native "${prev.label}" with "${output.label}"`
          );
        }
        result[result.length - 1] = output;
        prevWasDefaultNative = false;
        continue;
      }

      result.push(output);
      prevWasDefaultNative = !transformed && typeof entry.fiber.type === 'string';
    }

    return result;
  };
}
