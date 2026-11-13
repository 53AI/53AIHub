/**
 * 编辑器自适应高度（syncEditorHeight）的回归测试。
 *
 * 覆盖：
 * 1. 空内容 → minHeight
 * 2. 内容变高 → 跟随 scrollHeight
 * 3. 超过 maxHeight → 封顶，交由 CSS overflow-y 滚动
 * 4. min/max 可配置
 * 5. 内容减少 → 高度回落（必须先把 height 置 auto 才拿得到真实 scrollHeight）
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { useEditor } from '../useEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// hub-ui-x-react 没有装 @testing-library/react（只依赖 react/react-dom），
// 与 mentionCancel.test.ts 一致，这里用 react-dom 手搓一个够用的 renderHook。
const renderHook = <T,>(hook: () => T): { result: { current: T }; unmount: () => void } => {
  const result = { current: undefined as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  const Probe = () => {
    result.current = hook();
    return null;
  };

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });

  return {
    result,
    unmount: () => act(() => root.unmount()),
  };
};

/** 构造一个 scrollHeight 可控的编辑器 ref */
const createEditorRef = (initialScrollHeight: number) => {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  document.body.appendChild(el);

  let scrollHeight = initialScrollHeight;
  Object.defineProperty(el, 'scrollHeight', {
    get: () => scrollHeight,
    configurable: true,
  });

  return {
    ref: { current: el } as React.RefObject<HTMLDivElement>,
    el,
    setScrollHeight: (next: number) => {
      scrollHeight = next;
    },
  };
};

describe('useEditor - 自适应高度', () => {
  it('空内容取 minHeight（默认 24px）', () => {
    const { ref, el } = createEditorRef(0);
    const { result, unmount } = renderHook(() => useEditor({ editorRef: ref }));

    act(() => result.current.syncEditorHeight());

    expect(el.style.height).toBe('24px');
    unmount();
  });

  it('内容变高时跟随 scrollHeight', () => {
    const { ref, el } = createEditorRef(120);
    const { result, unmount } = renderHook(() => useEditor({ editorRef: ref }));

    act(() => result.current.syncEditorHeight());

    expect(el.style.height).toBe('120px');
    unmount();
  });

  it('超过 maxHeight 时封顶为 200px', () => {
    const { ref, el } = createEditorRef(500);
    const { result, unmount } = renderHook(() => useEditor({ editorRef: ref }));

    act(() => result.current.syncEditorHeight());

    expect(el.style.height).toBe('200px');
    unmount();
  });

  it('minHeight / maxHeight 可配置', () => {
    const { ref, el } = createEditorRef(500);
    const { result, unmount } = renderHook(() =>
      useEditor({ editorRef: ref, minHeight: 40, maxHeight: 300 }),
    );

    act(() => result.current.syncEditorHeight());

    expect(el.style.height).toBe('300px');
    unmount();
  });

  it('内容减少时高度回落', () => {
    const { ref, el, setScrollHeight } = createEditorRef(120);
    const { result, unmount } = renderHook(() => useEditor({ editorRef: ref }));

    act(() => result.current.syncEditorHeight());
    expect(el.style.height).toBe('120px');

    setScrollHeight(30);
    act(() => result.current.syncEditorHeight());
    expect(el.style.height).toBe('30px');

    unmount();
  });

  it('clear() 后高度回到 minHeight', () => {
    const { ref, el, setScrollHeight } = createEditorRef(150);
    const { result, unmount } = renderHook(() => useEditor({ editorRef: ref }));

    act(() => result.current.syncEditorHeight());
    expect(el.style.height).toBe('150px');

    setScrollHeight(0);
    act(() => result.current.clear());
    expect(el.style.height).toBe('24px');

    unmount();
  });

  it('优先读 CSS 变量 --x-sender-editor-min-height（PC 端 140px）', () => {
    const { ref, el } = createEditorRef(0);
    el.style.setProperty('--x-sender-editor-min-height', '140px');
    const { result, unmount } = renderHook(() => useEditor({ editorRef: ref }));

    act(() => result.current.syncEditorHeight());

    expect(el.style.height).toBe('140px');
    unmount();
  });

  it('显式传入的 minHeight 优先级高于 CSS 变量', () => {
    const { ref, el } = createEditorRef(0);
    el.style.setProperty('--x-sender-editor-min-height', '140px');
    const { result, unmount } = renderHook(() =>
      useEditor({ editorRef: ref, minHeight: 60 }),
    );

    act(() => result.current.syncEditorHeight());

    expect(el.style.height).toBe('60px');
    unmount();
  });

  it('内容高于 CSS 变量 min-height 时跟随内容', () => {
    const { ref, el } = createEditorRef(300);
    el.style.setProperty('--x-sender-editor-min-height', '140px');
    const { result, unmount } = renderHook(() => useEditor({ editorRef: ref }));

    act(() => result.current.syncEditorHeight());

    expect(el.style.height).toBe('200px'); // 300 超出 max 200 封顶
    unmount();
  });
});
