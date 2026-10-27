import { describe, expect, it } from 'vitest';
import { getStackFrame } from './fiber-utils';
import { extractStackFrameInfo } from './source-location-resolver';
import type { Fiber } from './types';

function makeFiber(overrides: Partial<Fiber>): Fiber {
  return { type: 'div', _debugOwner: null, ...overrides };
}

describe('getStackFrame', () => {
  it('prefers _debugStack when present', () => {
    const error = new Error();
    error.stack = [
      'Error: react-stack-top-frame',
      '    at jsxDEV (http://localhost:5199/node_modules/.vite/deps/react_jsx-dev-runtime.js:10:20)',
      '    at App (http://localhost:5199/src/App.tsx:7:9)',
    ].join('\n');
    const fiber = makeFiber({
      _debugStack: error,
      _debugSource: { fileName: '/abs/Ignored.tsx', lineNumber: 1, columnNumber: 1 },
    });

    expect(getStackFrame(fiber)).toBe('at App (http://localhost:5199/src/App.tsx:7:9)');
  });

  it('falls back to a parseable synthetic frame from _debugSource (React 18)', () => {
    const fiber = makeFiber({
      _debugSource: {
        fileName: '/Users/me/my project/src/Foo.tsx',
        lineNumber: 42,
        columnNumber: 7,
      },
    });

    const frame = getStackFrame(fiber);
    expect(frame).toBe('at react-debug-source:///Users/me/my project/src/Foo.tsx:42:7');
    expect(frame && extractStackFrameInfo(frame)).toEqual({
      url: 'react-debug-source:///Users/me/my project/src/Foo.tsx',
      line: 42,
      column: 7,
    });
  });

  it('defaults a missing column to 1', () => {
    const fiber = makeFiber({ _debugSource: { fileName: '/abs/Foo.jsx', lineNumber: 3 } });
    expect(getStackFrame(fiber)).toBe('at react-debug-source:///abs/Foo.jsx:3:1');
  });

  it('returns undefined when neither is available', () => {
    expect(getStackFrame(makeFiber({ _debugSource: null }))).toBeUndefined();
  });
});
