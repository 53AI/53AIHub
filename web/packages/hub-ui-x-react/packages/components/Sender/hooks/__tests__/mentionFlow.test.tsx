/**
 * 真实输入流下的 Esc / Backspace 行为测试
 *
 * 模拟用户在编辑器里输入 @ → 弹出文档选择 → 按 Esc 的完整路径,
 * 验证 chip 会被溶解成普通文本而不是继续以 mention-input 形式留在 DOM 里。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { getPureText } from '../useEditor';
import { useMention } from '../useMention';

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

const setupEditor = (): { editor: HTMLDivElement; editorRef: React.RefObject<HTMLDivElement> } => {
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.className = 'x-sender__editor';
  document.body.appendChild(editor);
  const editorRef: React.RefObject<HTMLDivElement> = { current: editor };
  return { editor, editorRef };
};

/**
 * 模拟用户输入 @ 的完整链路:
 *   1) 浏览器把 @ 插入文本节点并把光标移到这个 @ 后面
 *   2) Sender.handleEditorInput → useMention.handleInputCheck:
 *      切掉 @ 字符,把光标回退一格,再 createMentionInputElement 插回,
 *      moveCursorToEnd 到 chip 内部
 */
const typeAtIntoEditor = (editor: HTMLDivElement) => {
  // 浏览器插入 @
  const text = document.createTextNode('@');
  editor.appendChild(text);

  // Selection 落在 @ 之后
  const sel = document.getSelection()!;
  const r = document.createRange();
  r.setStart(text, 1); r.setEnd(text, 1);
  sel.removeAllRanges(); sel.addRange(r);
};

/**
 * 模拟 Sender.tsx handleKeyDown 把 native KeyboardEvent 转发到 hook:
 *   handleKeyDown 拿到 React 合成事件后,会直接调 mentionHook.handleKeyDown(event)
 * 我们让测试里直接调用 hook 的 handleKeyDown 来重现"在编辑器里按键"的效果,
 * 用一个最小 React.KeyboardEvent 形状的对象即可。
 */
const keyDownOnHook = (
  hook: { handleKeyDown: (e: React.KeyboardEvent) => boolean },
  key: string
) => {
  const e = {
    key,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() {
      (e as { defaultPrevented: boolean }).defaultPrevented = true;
    },
    stopPropagation() {},
  } as unknown as React.KeyboardEvent;
  return hook.handleKeyDown(e);
};

const caret = () => {
  const sel = document.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  return { container: range.startContainer, offset: range.startOffset };
};

describe('真实输入流: @ + Esc', () => {
  let editor: HTMLDivElement;
  let editorRef: React.RefObject<HTMLDivElement>;

  beforeEach(() => {
    document.body.innerHTML = '';
    const r = setupEditor();
    editor = r.editor;
    editorRef = r.editorRef;
  });

  const useMentionHook = () =>
    renderHook(() =>
      useMention({
        editorRef,
        enabled: true,
        triggerCode: '@',
        onInsertInput: (input, cursor) => {
          if (cursor?.element && editor.contains(cursor.element)) {
            cursor.element.after(input);
          } else {
            editor.appendChild(input);
          }
        },
      })
    );

  it('完整链路:输入 @ → 弹窗 → Esc → chip 溶解为普通字符', () => {
    const { result } = useMentionHook();

    // 1) 用户输入 @
    act(() => {
      typeAtIntoEditor(editor);
      result.current.handleInputCheck();
    });

    const chip = editor.querySelector('.mention-input');
    expect(chip).not.toBeNull();
    // 还原用户给的 DOM 快照
    expect(chip?.outerHTML).toContain('class="mention-line-block mention-input empty"');
    expect(chip?.getAttribute('placeholder')).toBe('指定文档');
    expect(chip?.textContent).toBe('@');

    // 2) 按 Esc(走 hook 自身判定)
    let handled = false;
    act(() => {
      handled = keyDownOnHook(result.current, 'Escape');
    });

    // 关键断言:chip 不再存在,@ 作为普通字符留在编辑器
    expect(handled).toBe(true);
    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(editor.querySelector('.mention-line-block')).toBeNull();
    // 编辑器里不应该再有任何 span —— 整个 chip DOM 已被替换为普通 text node
    expect(editor.children.length).toBe(0);
    // @ 还在,只是不再是 chip
    expect(getPureText(editor)).toBe('@');
  });

  it('完整链路:输入 @ + 关键词 abc → Esc → 整段 @abc 变普通字符', () => {
    const { result } = useMentionHook();

    act(() => {
      typeAtIntoEditor(editor);
      result.current.handleInputCheck();
    });

    const chip = editor.querySelector('.mention-input') as HTMLElement;
    act(() => {
      chip.textContent = '@abc';
      const sel = document.getSelection()!;
      const r = document.createRange();
      r.setStart(chip.firstChild!, 4); r.setEnd(chip.firstChild!, 4);
      sel.removeAllRanges(); sel.addRange(r);
      result.current.handleInputCheck();
    });

    expect(result.current.canShowSelect).toBe(true);

    act(() => {
      keyDownOnHook(result.current, 'Escape');
    });

    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(getPureText(editor)).toBe('@abc');
  });

  it('完整链路:输入 @ + 关键词 → Backspace 删到只剩 @ → 再按一次 Backspace', () => {
    const { result } = useMentionHook();

    act(() => {
      typeAtIntoEditor(editor);
      result.current.handleInputCheck();
    });

    const chip = editor.querySelector('.mention-input') as HTMLElement;

    // 用户敲了 abc 然后连按 3 次 Backspace,让浏览器自然删除文本
    // (这里直接设置到只剩 @ 状态,模拟浏览器已经删完 3 个字符后的 DOM 快照)
    act(() => {
      chip.textContent = '@';
      const sel = document.getSelection()!;
      const r = document.createRange();
      r.setStart(chip.firstChild!, 1); r.setEnd(chip.firstChild!, 1);
      sel.removeAllRanges(); sel.addRange(r);
    });

    // 这时按 Backspace 应该整块删除并恢复光标
    let handled = false;
    act(() => {
      handled = keyDownOnHook(result.current, 'Backspace');
    });

    expect(handled).toBe(true);
    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(getPureText(editor)).toBe('');
  });

  it('完整链路:输入 @ 后,编辑器里其它位置有文字,Backspace 删 @ 不应让光标跳到 @ 前面', () => {
    const { result } = useMentionHook();

    editor.appendChild(document.createTextNode('hi '));

    act(() => {
      typeAtIntoEditor(editor);
      result.current.handleInputCheck();
    });

    const chip = editor.querySelector('.mention-input') as HTMLElement;
    act(() => {
      chip.textContent = '@';
      const sel = document.getSelection()!;
      const r = document.createRange();
      r.setStart(chip.firstChild!, 1); r.setEnd(chip.firstChild!, 1);
      sel.removeAllRanges(); sel.addRange(r);
    });

    act(() => {
      keyDownOnHook(result.current, 'Backspace');
    });

    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(getPureText(editor)).toBe('hi ');
  });

  it('下拉弹窗的 onCancel 必须把 chip 还原成普通字符(Sender 透传给 MentionDropdown)', () => {
    // 这是用户报的现象:弹窗里的搜索框先抢到焦点,Esc 走到 MentionDropdown.handleKeyDown
    // 而不是 useMention.handleKeyDown。修复靠 Sender.tsx 把
    //   onCancel={() => mentionHook.cancelMentionInput(true)}
    // 传给 MentionDropdown,MentionDropdown 在 Esc 时调用 onCancel。
    // 这里直接验证 hook 的 cancelMentionInput(true) 出口正确,
    // 因为 Sender 只是把 cancelMentionInput 透传出去。
    const { result } = useMentionHook();

    act(() => {
      typeAtIntoEditor(editor);
      result.current.handleInputCheck();
    });

    expect(editor.querySelector('.mention-input')).not.toBeNull();

    // 模拟 MentionDropdown 收到 Esc 后调用 onCancel
    act(() => {
      result.current.cancelMentionInput(true);
    });

    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(editor.querySelector('.mention-line-block')).toBeNull();
    expect(getPureText(editor)).toBe('@');
    // popup 也关闭了
    expect(result.current.canShowSelect).toBe(false);
  });

  it('点击 chip 后面:光标停在 chip 之后,quitMentionInput 不能把它挤到 chip 前面', () => {
    // 根因回归(用户报的"点击输入框,光标跳到最前面" / "删除 @,光标跑到 @ 前面"):
    //
    // 浏览器点击后把光标锚在**父节点坐标**上 —— (editor, chipIndex + 1),即 chip 之后。
    // 此时如果用 `chip.replaceWith(textNode)`,按 DOM 规范这是 "先 remove 再 insert":
    //   remove:  startOffset(2) > chipIndex(1) → 减 1 → 1
    //   insert:  startOffset(1) > 插入点(1) 不成立 → 不加回来 → 停在 1
    // 净效果 offset 少了 1,光标从"chip 之后"退到了"chip 之前"。编辑器只有 chip 时,
    // 这就是肉眼看到的"光标跳到最前面"。
    //
    // 正确写法是 `chip.before(textNode); chip.remove();` —— 插入时 offset 先 +1、
    // 删除时再 -1,live range 前后抵消,光标原地不动。
    const { result } = useMentionHook();

    act(() => {
      typeAtIntoEditor(editor);
      result.current.handleInputCheck();
    });

    const chip = editor.querySelector('.mention-input') as HTMLElement;
    const chipIndex = Array.prototype.indexOf.call(editor.childNodes, chip);

    // 浏览器把光标放到 chip 之后的父节点坐标上
    const sel = document.getSelection()!;
    const r = document.createRange();
    r.setStart(editor, chipIndex + 1); r.setEnd(editor, chipIndex + 1);
    sel.removeAllRanges(); sel.addRange(r);

    act(() => {
      result.current.quitMentionInput();
    });

    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(getPureText(editor)).toBe('@');

    // 光标必须还在 "@" 之后,而不是被挤到它前面
    const after = caret();
    expect(after?.container).toBe(editor);
    expect(after?.offset).toBe(chipIndex + 1);
  });

  it('点击 chip 后面的文字:quitMentionInput 不能 normalize 掉光标所在的文本节点', () => {
    // 回归:dissolveChip 在 restoreCaret=false 路径里如果还调 parent.normalize(),
    // chip 溶解出的 "@" 会把前后文本节点串成一个,光标锚定的 " world" 节点被移除,
    // Selection 失锚 → 浏览器把光标塌缩到编辑器开头。
    const { result } = useMentionHook();

    act(() => {
      typeAtIntoEditor(editor);
      result.current.handleInputCheck();
    });

    // 构造 "hi [chip] world":光标所在的文本节点排在文本串的**非首位**,
    // 这正是 normalize() 会把它吃掉的位置。
    const chip = editor.querySelector('.mention-input') as HTMLElement;
    editor.insertBefore(document.createTextNode('hi '), chip);
    const afterText = document.createTextNode(' world');
    chip.after(afterText);

    const sel = document.getSelection()!;
    const r = document.createRange();
    r.setStart(afterText, 3); r.setEnd(afterText, 3);
    sel.removeAllRanges(); sel.addRange(r);

    act(() => {
      result.current.quitMentionInput();
    });

    expect(editor.querySelector('.mention-input')).toBeNull();
    expect(getPureText(editor)).toBe('hi @ world');

    // 光标锚点必须还活着,且位置没变
    expect(editor.contains(afterText)).toBe(true);
    const after = caret();
    expect(after?.container).toBe(afterText);
    expect(after?.offset).toBe(3);
  });
});