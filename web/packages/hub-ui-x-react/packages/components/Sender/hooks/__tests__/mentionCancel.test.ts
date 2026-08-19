/**
 * @ / 输入态取消行为的回归测试
 *
 * 覆盖两个已修复的 bug:
 * 1. 输入 @ 后按 Esc,应该取消"@文档"状态,chip 还原成一个普通的 "@" 字符
 * 2. 输入 @ 后未选择文档、删掉 @,光标应该停在 @ 原来的位置,而不是跑到它前面
 */

import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { dissolveChip, moveCursorToEnd, moveCursorTo } from '../useEditor';
import { useMention } from '../useMention';
import { useSkill } from '../useSkill';

// hub-ui-x-react 没有装 @testing-library/react（它只依赖 react/react-dom），
// 这里用 react-dom 手搓一个够用的 renderHook，避免为测试引入新依赖。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** 构造一个挂到 document 上的可编辑容器 */
const createEditor = (): HTMLDivElement => {
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  document.body.appendChild(editor);
  return editor;
};

/** 构造一个 mention-input / skill-input chip */
const createChip = (className: string, text: string): HTMLElement => {
  const span = document.createElement('span');
  span.className = `mention-line-block ${className} empty`;
  span.appendChild(document.createTextNode(text));
  return span;
};

/** 当前光标所在的容器与偏移 */
const caret = () => {
  const sel = document.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  return { container: range.startContainer, offset: range.startOffset };
};

/** 伪造一个 React 键盘事件 */
const keyEvent = (key: string) => {
  const event = {
    key,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() {
      (event as { defaultPrevented: boolean }).defaultPrevented = true;
    },
    stopPropagation() {},
  };
  return event as unknown as React.KeyboardEvent;
};

describe('dissolveChip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keepText: chip 变成普通文本节点，光标落在文字末尾', () => {
    const editor = createEditor();
    editor.appendChild(document.createTextNode('hi '));
    const chip = createChip('mention-input', '@');
    editor.appendChild(chip);
    moveCursorToEnd(chip);

    dissolveChip(chip, { keepText: true, restoreCaret: true });

    // chip 不再存在，@ 变成普通字符
    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(editor.textContent).toBe('hi @');

    // normalize 后合并成单个文本节点，光标停在 @ 之后
    const c = caret();
    expect(c?.container.nodeType).toBe(Node.TEXT_NODE);
    expect(c?.container.textContent).toBe('hi @');
    expect(c?.offset).toBe(4);
  });

  it('内容为空时不插入空文本节点，光标回到 chip 原来的位置', () => {
    const editor = createEditor();
    editor.appendChild(document.createTextNode('hi '));
    const chip = createChip('mention-input', '');
    editor.appendChild(chip);
    editor.appendChild(document.createTextNode('!'));
    moveCursorToEnd(chip);

    dissolveChip(chip, { keepText: true, restoreCaret: true });

    expect(editor.textContent).toBe('hi !');
    const c = caret();
    // 光标在 "hi " 和 "!" 之间 —— 即 chip 原来的位置，而不是编辑器开头
    expect(c?.container.textContent).toBe('hi !');
    expect(c?.offset).toBe(3);
  });

  it('keepText=false: 整块删除，光标回到 chip 原来的位置', () => {
    const editor = createEditor();
    editor.appendChild(document.createTextNode('hi '));
    const chip = createChip('mention-input', '@');
    editor.appendChild(chip);
    moveCursorToEnd(chip);

    dissolveChip(chip, { keepText: false, restoreCaret: true });

    expect(editor.textContent).toBe('hi ');
    const c = caret();
    expect(c?.container.textContent).toBe('hi ');
    expect(c?.offset).toBe(3);
  });

  it('空编辑器里删除 chip 不抛错，光标落在编辑器起点', () => {
    const editor = createEditor();
    const chip = createChip('mention-input', '@');
    editor.appendChild(chip);
    moveCursorToEnd(chip);

    dissolveChip(chip, { keepText: false, restoreCaret: true });

    expect(editor.childNodes.length).toBe(0);
    expect(caret()?.container).toBe(editor);
    expect(caret()?.offset).toBe(0);
  });

  it('restoreCaret=false 时不抢光标（点击其它位置退出的场景）', () => {
    const editor = createEditor();
    const other = document.createTextNode('elsewhere');
    editor.appendChild(other);
    const chip = createChip('mention-input', '@');
    editor.appendChild(chip);
    // 模拟用户点到了别处
    moveCursorTo(other, 2);

    dissolveChip(chip, { keepText: true, restoreCaret: false });

    const c = caret();
    expect(c?.container.textContent).toBe('elsewhere@');
    expect(c?.offset).toBe(2);
  });
});

describe('useMention 取消 @ 输入态', () => {
  let editor: HTMLDivElement;
  let editorRef: React.RefObject<HTMLDivElement>;

  beforeEach(() => {
    document.body.innerHTML = '';
    editor = createEditor();
    editorRef = { current: editor };
  });

  it('Esc: @ 还原成普通字符，下拉关闭', () => {
    const { result } = renderHook(() =>
      useMention({ editorRef, enabled: true, onInsertInput: (input) => editor.appendChild(input) })
    );

    act(() => result.current.activateMentionInput());
    expect(editor.querySelector('.mention-input')).not.toBeNull();
    expect(result.current.canShowSelect).toBe(true);

    const event = keyEvent('Escape');
    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown(event);
    });

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    // chip 没了，但 @ 作为普通字符留下
    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(editor.textContent).toBe('@');
    expect(result.current.canShowSelect).toBe(false);
  });

  it('Backspace 删掉唯一的 @: 整块删除且光标不跑到前面', () => {
    const { result } = renderHook(() =>
      useMention({ editorRef, enabled: true, onInsertInput: (input) => editor.appendChild(input) })
    );

    editor.appendChild(document.createTextNode('hi '));
    act(() => result.current.activateMentionInput());

    const event = keyEvent('Backspace');
    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown(event);
    });

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(editor.textContent).toBe('hi ');

    const c = caret();
    expect(c?.container.textContent).toBe('hi ');
    // 光标在末尾（@ 原来的位置），不是 0
    expect(c?.offset).toBe(3);
  });

  it('chip 里还有关键词时，Backspace 交回浏览器处理', () => {
    const { result } = renderHook(() =>
      useMention({ editorRef, enabled: true, onInsertInput: (input) => editor.appendChild(input) })
    );

    act(() => result.current.activateMentionInput());
    const chip = editor.querySelector('.mention-input') as HTMLElement;
    chip.textContent = '@abc';
    moveCursorToEnd(chip);

    const event = keyEvent('Backspace');
    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown(event);
    });

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.querySelector('.mention-input')).not.toBeNull();
  });

  it('checkAndConvertInput: 删空的 chip 被清掉且光标不塌缩到开头', () => {
    const { result } = renderHook(() =>
      useMention({ editorRef, enabled: true, onInsertInput: (input) => editor.appendChild(input) })
    );

    editor.appendChild(document.createTextNode('hi '));
    act(() => result.current.activateMentionInput());
    // 模拟浏览器把 chip 内的 @ 删掉后留下的空 span
    const chip = editor.querySelector('.mention-input') as HTMLElement;
    chip.textContent = '';

    act(() => result.current.checkAndConvertInput());

    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(editor.textContent).toBe('hi ');
    expect(caret()?.offset).toBe(3);
  });

  it('没有 mention-input 时 handleKeyDown 不拦截按键', () => {
    const { result } = renderHook(() => useMention({ editorRef, enabled: true }));
    expect(result.current.handleKeyDown(keyEvent('Escape'))).toBe(false);
    expect(result.current.handleKeyDown(keyEvent('Backspace'))).toBe(false);
  });
});

describe('useSkill 取消 / 输入态', () => {
  let editor: HTMLDivElement;
  let editorRef: React.RefObject<HTMLDivElement>;

  beforeEach(() => {
    document.body.innerHTML = '';
    editor = createEditor();
    editorRef = { current: editor };
  });

  it('Esc: / 还原成普通字符，下拉关闭', () => {
    const { result } = renderHook(() =>
      useSkill({ editorRef, enabled: true, onInsertInput: (input) => editor.appendChild(input) })
    );

    act(() => result.current.activateSkillInput());
    expect(editor.querySelector('.skill-input')).not.toBeNull();

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown(keyEvent('Escape'));
    });

    expect(handled).toBe(true);
    expect(editor.querySelector('.skill-input')).toBeNull();
    expect(editor.textContent).toBe('/');
    expect(result.current.canShowSelect).toBe(false);
  });

  it('Backspace 删掉唯一的 /: 整块删除且光标不跑到前面', () => {
    const { result } = renderHook(() =>
      useSkill({ editorRef, enabled: true, onInsertInput: (input) => editor.appendChild(input) })
    );

    editor.appendChild(document.createTextNode('hi '));
    act(() => result.current.activateSkillInput());

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown(keyEvent('Backspace'));
    });

    expect(handled).toBe(true);
    expect(editor.querySelector('.skill-input')).toBeNull();
    expect(editor.textContent).toBe('hi ');
    expect(caret()?.offset).toBe(3);
  });
});
