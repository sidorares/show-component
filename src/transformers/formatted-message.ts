import { parse } from '@babel/parser';
import type { ChainTransformer } from '../core/chain-transformer';
import type { Fiber } from '../core/types';
import { TRANSFORMER_PRESETS, createRuleBasedTransformer } from './transformer-rule';

// Minimal AST node shape — avoids a hard dependency on @babel/types.
interface AstNode {
  type: string;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
  [key: string]: unknown;
}

/** Keys that are metadata, not child nodes — skip during traversal. */
const SKIP_KEYS = new Set([
  'type',
  'loc',
  'start',
  'end',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'extra',
  'range',
]);

/** Extracts the element name from a JSX name node (`JSXIdentifier` or `JSXMemberExpression`). */
function getJsxName(node: AstNode): string {
  if (node.type === 'JSXIdentifier') return node.name as string;
  if (node.type === 'JSXMemberExpression') {
    return `${getJsxName(node.object as AstNode)}.${(node.property as AstNode).name}`;
  }
  return '';
}

/**
 * Locates a JSX prop's value expression in source code using a full
 * TypeScript+JSX AST parse via `@babel/parser`.
 *
 * Returns the 1-based line and 0-based column of the value node
 * (e.g. the opening `"` of a string literal, or `{` of an expression container).
 *
 * When multiple elements with the same name exist in a file, the one closest
 * to `nearLine`/`nearColumn` is chosen.
 */
export function findJsxPropValueLocation(
  source: string,
  nearLine: number,
  nearColumn: number,
  elementName: string,
  propName: string
): { line: number; column: number } | null {
  let ast: AstNode;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators'],
      errorRecovery: true,
    }) as unknown as AstNode;
  } catch {
    return null;
  }

  let bestMatch: { line: number; column: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as AstNode;

    if (n.type === 'JSXOpeningElement' && n.loc) {
      const name = getJsxName(n.name as AstNode);
      if (name === elementName) {
        const lineDist = Math.abs(n.loc.start.line - nearLine);
        const colDist = Math.abs(n.loc.start.column - nearColumn);
        const distance = lineDist * 10_000 + colDist;

        if (distance < bestDistance) {
          const attrs = n.attributes as AstNode[] | undefined;
          if (attrs) {
            for (const attr of attrs) {
              if (
                attr.type === 'JSXAttribute' &&
                (attr.name as AstNode)?.type === 'JSXIdentifier' &&
                (attr.name as AstNode).name === propName &&
                attr.value
              ) {
                const valNode = attr.value as AstNode;
                if (valNode.loc) {
                  bestMatch = {
                    line: valNode.loc.start.line,
                    column: valNode.loc.start.column,
                  };
                  bestDistance = distance;
                }
              }
            }
          }
        }
      }
    }

    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      const child = n[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && (item as AstNode).type) {
            visit(item);
          }
        }
      } else if (child && typeof child === 'object' && (child as AstNode).type) {
        visit(child);
      }
    }
  }

  visit(ast);
  return bestMatch;
}

/**
 * Shallow DFS through a fiber's child tree (up to `maxDepth` levels)
 * looking for a fiber that satisfies `predicate`.
 */
export function findChildFiber(
  fiber: Fiber,
  predicate: (f: Fiber) => boolean,
  maxDepth = 3
): Fiber | null {
  const search = (f: Fiber | null | undefined, depth: number): Fiber | null => {
    if (!f || depth > maxDepth) return null;
    if (predicate(f)) return f;

    const childResult = search(f.child, depth + 1);
    if (childResult) return childResult;

    return search(f.sibling, depth);
  };

  return search(fiber.child, 0);
}

/**
 * Creates a {@link ChainTransformer} that detects `react-intl`'s
 * `<FormattedMessage>` pattern and collapses it into a readable entry.
 *
 * This is a convenience wrapper around {@link createRuleBasedTransformer}
 * using the built-in `react-intl` preset.
 *
 * @example
 * ```tsx
 * <ShowComponent
 *   chainTransformer={createFormattedMessageTransformer()}
 * />
 * ```
 */
export function createFormattedMessageTransformer(): ChainTransformer {
  return createRuleBasedTransformer([TRANSFORMER_PRESETS['react-intl']]);
}
