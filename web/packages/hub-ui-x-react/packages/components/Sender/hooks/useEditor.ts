/**
 * 编辑器 Hook - 处理 contentEditable 编辑器逻辑
 */

import { useRef, useState, useCallback, useEffect } from 'react';

export interface CursorPosition {
  element: Node;
  cursorPos: number;
  range?: Range;
}

/**
 * 获取当前光标位置
 */
export const getCursor = (): CursorPosition | null => {
  const sel = document.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const element = range.startContainer;
  const offset = range.startOffset || 0;
  return { element, cursorPos: offset, range };
};

/**
 * 检查元素是否有指定类名
 */
export const hasClassName = (el: Node | null, cls: string): boolean => {
  return !!(el as Element)?.classList?.contains(cls);
};

/**
 * 查找父元素
 */
export const findParent = (
  el: Node | null | undefined,
  check: (n: Node) => boolean
): Node | null => {
  if (!el) return null;
  return check(el) ? el : findParent(el.parentNode, check);
};

/**
 * 创建空格文本节点
 */
export const createSpace = (n = 1): Text => {
  const text = new Array(n + 1).join(' ');
  return document.createTextNode(text);
};

/**
 * 检查是否为空格字符
 */
export const isSpaceChar = (text: string | null | undefined): boolean => {
  return !!text?.trim && text.trim().length === 0 && text.length === 1;
};

/**
 * 扫描编辑器内所有 `.mention-line-block` 节点,按需在前后补空格文本节点,
 * 防止 inline-block chip 在编辑器内被强制换到下一行。
 *
 * 对齐原版 apps/front-react/src/components/Chat/Sender.tsx line 554-578 的 offsetBlock。
 * 与初版的 offsetBlockFor 区别:升级为全局扫描,不仅修当前插入的 chip,
 * 也修编辑器中已有但因各种原因缺失前后空格的遗留 chip。
 *
 * - 前置空格:前一个兄弟节点是非空文本且不以空格结尾,或前一个兄弟节点也是 chip
 * - 后置空格:后一个兄弟节点是文本且不以空格开头,或后一个兄弟节点也是 chip
 *
 * 空编辑器情况(无 prev/next 兄弟)不会补空格,因为没有可分隔的对象。
 */
export const offsetBlock = (editor: HTMLElement | null) => {
  if (!editor) return;
  const blocks = editor.querySelectorAll('.mention-line-block');
  if (blocks.length === 0) return;

  blocks.forEach((b) => {
    const prev = b.previousSibling;
    const next = b.nextSibling;

    if (prev && prev !== editor) {
      const text = prev.textContent;
      const isText = prev.nodeType === Node.TEXT_NODE;
      const isEmpty = isText && text?.trim().length === 0;
      const isNotSpace = isText && !isEmpty && !isSpaceChar(text?.slice(-1));
      const isBlock = hasClassName(prev, 'mention-line-block');
      if (isNotSpace || isBlock) b.before(createSpace(1));
    }

    if (next && next !== editor) {
      const isNotSpace =
        next.nodeType === Node.TEXT_NODE && !isSpaceChar(next.textContent?.slice(0, 1));
      const isBlock = hasClassName(next, 'mention-line-block');
      if (isNotSpace || isBlock) b.after(createSpace(1));
    }
  });
};

/**
 * 将光标移动到元素末尾
 */
export const moveCursorToEnd = (el: Node | null) => {
  if (!el) return;
  const sel = document.getSelection();
  const range = document.createRange();

  if ((el as any).childNodes?.length > 0 || el.nodeType === Node.TEXT_NODE) {
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    range.setStart(el, 0);
    range.setEnd(el, 0);
  }

  sel?.removeAllRanges();
  sel?.addRange(range);
};

/**
 * 强制把焦点放回编辑器并把光标移到末尾。
 *
 * 为什么需要:mention / skill 的下拉弹窗里有自己的搜索框会自动 focus,
 * 用户按 Esc 后如果不主动 focus 回编辑器,焦点会留在已经卸载的搜索框上,
 * 后续键盘事件(包括再次输入 @)就丢了。
 */
export const focusEditorAtEnd = (editor: HTMLElement | null) => {
  if (!editor) return;
  editor.focus();
  moveCursorToEnd(editor);
};

/**
 * 将光标移动到指定位置
 */
export const moveCursorTo = (el: Node, offset: number) => {
  const sel = document.getSelection();
  const range = document.createRange();
  range.setStart(el, offset);
  range.setEnd(el, offset);
  sel?.removeAllRanges();
  sel?.addRange(range);
};

export interface DissolveChipOptions {
  /**
   * true  → 保留 chip 内的文字,把整块替换成普通文本节点(例如 Esc 后 `@` 变回一个普通字符)
   * false → 整块删除
   * 注意:keepText=true 但 chip 内已经没有文字时,等价于 false(不会插入空文本节点)。
   */
  keepText?: boolean;
  /**
   * 是否把光标放回 chip 原来的位置。
   * - 键盘触发(Esc / Backspace)必须为 true,否则光标会跑掉
   * - 点击其它位置触发时必须为 false,否则会抢走用户的点击落点
   */
  restoreCaret?: boolean;
  /**
   * 是否在溶解后合并相邻文本节点。
   * - 默认 true —— Esc/Backspace 路径需要,Sender 的 cleanResidualStyles 在下一次 input 时
   *   会再 normalize() 一次,光标会再次被打乱,这里提前合并好,确保光标稳定。
   * - 但在"用户点击编辑器其它位置"场景(restoreCaret=false)必须为 false:浏览器已经在
   *   mousedown 时把光标放到了用户点击的位置,如果我们立刻 normalize() 把新插入的 "@"
   *   文本节点与相邻文本节点合并,光标所在的文本节点可能消失/合并,Selection 失锚,
   *   浏览器把光标塌缩到编辑器开头 —— 这就是"点击输入框,光标跳到最前面"的根因。
   *
   * 留到 Sender 的 cleanResidualStyles 在用户下一次输入时再合并,正好够用。
   */
  normalize?: boolean;
}

/**
 * 定位 `node` 所在的"连续文本节点串"的首节点,以及 node 起点在该串中的偏移。
 *
 * 用途:`normalize()` 会把连续的文本节点合并到串里的**第一个**节点上,其余节点被移除。
 * 所以要先把光标坐标换算成 (首节点, 串内偏移),normalize 之后再定位,光标才不会丢。
 */
const textRunAnchor = (node: Text): { first: Text; offset: number } => {
  let first = node;
  let offset = 0;
  while (first.previousSibling?.nodeType === Node.TEXT_NODE) {
    first = first.previousSibling as Text;
    offset += first.length;
  }
  return { first, offset };
};

/** 把光标放到某个文本节点的指定位置,并先做一次 normalize 让相邻文本节点合并 */
const caretAtTextNode = (parent: Node, node: Text, offsetInNode: number) => {
  const { first, offset } = textRunAnchor(node);
  const target = offset + offsetInNode;
  // 立刻合并:否则 Sender 的 cleanResidualStyles 在下一次 input 时 normalize(),
  // 会再一次把刚放好的光标打乱。
  parent.normalize();
  moveCursorTo(first, Math.min(target, first.length));
};

/**
 * 溶解一个 chip(`.mention-input` / `.skill-input`),并把光标放回正确的位置。
 *
 * 为什么需要显式恢复光标:
 * `chip.replaceWith(document.createTextNode(''))` 或 `chip.remove()` 会让当前 Selection
 * 的锚点节点从文档里消失。浏览器此时会把光标塌缩到最近的可用位置 —— 实际表现就是
 * 跳到编辑器开头,即"删除 @ 之后光标出现在 @ 前面"。所以删除前先记下 chip 在父节点中的
 * 下标,删除后按这个下标重新 setStart。
 */
export const dissolveChip = (
  chip: HTMLElement | null | undefined,
  options: DissolveChipOptions = {}
): void => {
  const { keepText = true, restoreCaret = true, normalize: shouldNormalize = true } = options;
  const parent = chip?.parentNode;
  if (!chip || !parent) return;

  const text = chip.textContent || '';

  // 有文字且要求保留 → 替换成普通文本节点,光标落在文字末尾
  if (keepText && text.length > 0) {
    const textNode = document.createTextNode(text);
    // 关键:不能用 chip.replaceWith(textNode)。
    // 按 DOM 规范 replaceWith 是"先 remove 再 insert",对锚在父节点坐标上的 live range
    // (浏览器点击后就是这种锚定方式,例如光标在 chip 之后 = (parent, chipIndex + 1)):
    //   remove: startOffset > chipIndex → 减 1
    //   insert: startOffset > 插入点 不成立 → 不加回来
    // 净效果 offset 少 1,光标从"chip 之后"退到"chip 之前" —— 用户看到的
    // "点击输入框光标跳到最前面" / "删除 @ 后光标跑到 @ 前面"。
    // 先 insert 再 remove 则 +1 / -1 正好抵消,光标原地不动。
    chip.before(textNode);
    chip.remove();
    if (restoreCaret) {
      caretAtTextNode(parent, textNode, textNode.length);
    } else if (shouldNormalize) {
      // 仅在没有外部 Selection 关心当前位置时才合并,否则会顶掉浏览器刚放好的光标
      parent.normalize();
    }
    return;
  }

  // 整块删除:先记录下标,删除后光标回到同一个位置
  const index = Array.prototype.indexOf.call(parent.childNodes, chip);
  chip.remove();
  if (!restoreCaret || index < 0) {
    if (shouldNormalize) parent.normalize();
    return;
  }

  // 优先落到前一个文本节点末尾,其次是后一个文本节点开头 —— 文本节点内的偏移
  // 比 (parent, index) 更稳定,不会被 normalize()/浏览器归一化打乱。
  const prev = parent.childNodes[index - 1];
  if (prev?.nodeType === Node.TEXT_NODE) {
    caretAtTextNode(parent, prev as Text, (prev as Text).length);
    return;
  }
  const next = parent.childNodes[index];
  if (next?.nodeType === Node.TEXT_NODE) {
    caretAtTextNode(parent, next as Text, 0);
    return;
  }
  moveCursorTo(parent, Math.min(index, parent.childNodes.length));
};

/**
 * 分割文本节点
 */
export const splitTextNode = (node: Text, offset: number): Text => {
  if (offset === 0 || offset >= (node.textContent || '').length) return node;
  const text = node.textContent || '';
  const fragment = document.createDocumentFragment();
  const part1 = document.createTextNode(text.slice(0, offset));
  const part2 = document.createTextNode(text.slice(offset));
  fragment.appendChild(part1);
  fragment.appendChild(part2);
  node.replaceWith(fragment);
  return part1;
};

/**
 * 在文本节点指定位置插入节点
 */
export const insertToTextNode = (
  newNode: Node,
  textNode: Text,
  offset: number
) => {
  if (offset === textNode.textContent?.length) {
    textNode.after(newNode);
  } else if (offset === 0) {
    textNode.before(newNode);
  } else {
    splitTextNode(textNode, offset).after(newNode);
  }
};

/**
 * 获取纯文本内容
 *
 * 跳过 mention / skill 标签块（class 含 `mention-line-block`）：
 * 这些是 Sender 渲染的可视化 chip（`skill-tag` / `mention-link` 等），
 * 不应该出现在 textContent 里。它们的元数据另由 `atList` / `skillList` 字段独立传递。
 * 对齐 apps/front-react/src/components/Chat/Sender.tsx 老 Sender 的 traverse 行为。
 */
export const getPureText = (node: Node): string => {
  if (!node) return '';
  if (node.nodeName === 'BR') return '\n';

  // mention / skill 标签块整体跳过（含 skill-tag、mention-link 等所有
  // 带 mention-line-block 的 chip 子树）
  if (hasClassName(node, 'mention-line-block')) {
    return '';
  }

  if (node.childNodes && node.nodeName !== '#text') {
    let text = '';
    node.childNodes.forEach((child) => {
      text += getPureText(child);
    });
    return text;
  }
  return node.textContent || '';
};

export interface UseEditorOptions {
  editorRef: React.RefObject<HTMLDivElement>;
  onInput?: (data: { textContent: string; pureTextContent: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  showCaret?: boolean;
  maxLength?: number;  // 最大输入长度
}

export const useEditor = (options: UseEditorOptions) => {
  const { editorRef, onInput, disabled, showCaret = true, maxLength } = options;

  const [isComposing, setIsComposing] = useState(false);
  const [composingEndTime, setComposingEndTime] = useState(0);
  const [isShowPlaceholder, setIsShowPlaceholder] = useState(true);
  const lastCursorRef = useRef<CursorPosition | null>(null);

  /**
   * 检查编辑器是否为空
   */
  const isEmptyEditor = useCallback(() => {
    if (!editorRef.current) return true;
    const textContent = editorRef.current.textContent?.trim();
    const hasMentionBlock = editorRef.current.querySelector('.mention-line-block');
    return !textContent && !hasMentionBlock;
  }, [editorRef]);

  /**
   * 切换占位符显示
   */
  const togglePlaceholder = useCallback(() => {
    setIsShowPlaceholder(isEmptyEditor());
  }, [isEmptyEditor]);

  /**
   * 获取编辑器内容数据
   *
   * textContent 与 pureTextContent 都是剥离 mention/skill 标签后的纯文本，
   * 对齐老 Sender.tsx 的行为。`innerHTML` 保留完整的 chip DOM（用于显示），
   * 业务字段统一走干净文本 + 独立 atList/skillList 通道。
   */
  const getContentData = useCallback(() => {
    if (!editorRef.current) return null;
    const clone = editorRef.current.cloneNode(true) as HTMLElement;
    const cleanText = getPureText(clone).trim();
    return {
      innerHTML: clone.innerHTML,
      textContent: cleanText,
      pureTextContent: cleanText,
    };
  }, [editorRef]);

  /**
   * 插入文本
   */
  const insertText = useCallback((text: string) => {
    if (!text || !editorRef.current) return;
    const textNode = document.createTextNode(text);

    const sel = document.getSelection();
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      if (range && editorRef.current.contains(range.startContainer)) {
        range.deleteContents();
        range.insertNode(textNode);
        moveCursorToEnd(textNode);
      } else {
        editorRef.current.appendChild(textNode);
        moveCursorToEnd(editorRef.current);
      }
    } else {
      editorRef.current.appendChild(textNode);
      moveCursorToEnd(editorRef.current);
    }

    togglePlaceholder();
  }, [editorRef, togglePlaceholder]);

  /**
   * 插入节点
   *
   * 对齐 apps/front-react/src/components/Chat/Sender.tsx line 699-744 的 insertNode:
   *
   * 1. 可选 `cursor` 参数:调用方可传入(例如 `getAliveLastCursor()` 拿到的)
   *    替代默认 `getEditorCursor()`。这样点击 @ 按钮时,即便光标已被 button 抢走,
   *    也能把 chip 插入到用户上次停留的位置(原版 line 1793-1794 的 activeMentionInput(cursor))。
   *
   * 2. 选区折叠/光标不在编辑器/无选区三种情况都 fallback 到 appendChild,
   *    但当 `lastChild` 是 `<br>` 时插在它之前 —— 浏览器在空 contentEditable 中
   *    自动插入的 `<br>` 不能让 chip 落在它之后(否则视觉上 chip 被推到下一行)。
   *
   * 3. 光标在 BR 上且 BR 是 lastChild:插在 BR 之前(同上)。
   *
   * 4. 光标在 chip/其它 element 上:在该 element 后插入。
   *
   * 5. 光标在文本节点内:用 insertToTextNode 按 offset 精确切分。
   *
   * 6. 末尾调 offsetBlock(全局扫描所有 .mention-line-block 补前后空格),
   *    然后调 togglePlaceholder 同步 placeholder 状态。
   *
   * 注意:本方法不固定光标位置 —— 由调用方决定(hook 内部通常 moveCursorToEnd(input))。
   */
  const insertNode = useCallback((node: Node, cursor?: CursorPosition | null) => {
    const editor = editorRef.current;
    if (!editor) return;

    // 工具:把 node 插在最后一个 BR 之前(若有),否则 appendChild。
    const appendOrBeforeBR = () => {
      const lastChild = editor.lastChild;
      if (lastChild && (lastChild as HTMLElement).tagName === 'BR') {
        lastChild.before(node);
      } else {
        editor.appendChild(node);
      }
    };

    // 选区折叠(删除选中文本)
    // cursor.range 是可选字段 —— selectSkill / insertSkillTag 这种传 {element, cursorPos}
    // 简化 cursor 的场景不能崩。
    if (cursor?.range && !cursor.range.collapsed) {
      cursor.range.deleteContents();
    }

    if (!cursor) {
      // 没有 cursor 信息:appendChild(可能在 BR 之前)
      appendOrBeforeBR();
      offsetBlock(editor);
      togglePlaceholder();
      return;
    }

    const { element, cursorPos } = cursor;

    if (element === editor) {
      // 光标在 editor 自身。按 cursorPos 区分:
      //   cursorPos === 0 → 开头,prepend 到 firstChild 之前(用于「技能选择后 chip 必须 prepend」场景)
      //   cursorPos  > 0  → 塌缩到 editor(选中后塌缩),按 lastChild 处理
      if (cursorPos === 0) {
        const firstChild = editor.firstChild;
        if (firstChild) {
          firstChild.before(node);
        } else {
          editor.appendChild(node);
        }
      } else {
        appendOrBeforeBR();
      }
    } else if (
      (element as HTMLElement).tagName === 'BR' &&
      element === editor.lastChild
    ) {
      // 光标在尾部 BR 上:插在 BR 之前
      element.before(node);
    } else if (element.nodeType === Node.TEXT_NODE && cursorPos !== undefined) {
      // 光标在文本节点内:按 offset 精确切分插入
      insertToTextNode(node, element as Text, cursorPos);
    } else {
      // 光标在 chip/其它 element 上:在该 element 后插入
      element.after(node);
    }

    offsetBlock(editor);
    togglePlaceholder();
  }, [editorRef, togglePlaceholder]);

  /**
   * 清空编辑器
   */
  const clear = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
    togglePlaceholder();
  }, [editorRef, togglePlaceholder]);

  /**
   * 聚焦编辑器
   */
  const focus = useCallback((moveEnd = false) => {
    if (!editorRef.current || disabled) return;
    editorRef.current.focus();
    if (moveEnd) {
      moveCursorToEnd(editorRef.current);
    }
  }, [editorRef, disabled]);

  /**
   * 聚焦编辑器并把光标移到末尾(无论末尾是文本节点还是空 BR 都行)。
   * 下拉弹窗的搜索框自动抢焦点 → Esc 后需要主动 focus 回编辑器,否则
   * 后续键盘事件发不出去。
   */
  const focusAtEnd = useCallback(() => {
    focus(true);
  }, [focus]);

  /**
   * 处理输入事件
   */
  const handleInput = useCallback(() => {
    // maxLength 限制
    if (maxLength && maxLength > 0 && editorRef.current) {
      const text = editorRef.current.textContent || '';
      if (text.length > maxLength) {
        // 截断超出的内容
        const selection = document.getSelection();
        const range = selection?.getRangeAt(0);
        const cursorOffset = range?.startOffset || 0;

        // 保留 maxLength 长度的内容
        const truncated = text.slice(0, maxLength);
        editorRef.current.textContent = truncated;

        // 尝试恢复光标位置（调整到有效范围内）
        if (range && cursorOffset <= maxLength) {
          const newRange = document.createRange();
          const textNode = editorRef.current.firstChild;
          if (textNode) {
            newRange.setStart(textNode, Math.min(cursorOffset, truncated.length));
            newRange.setEnd(textNode, Math.min(cursorOffset, truncated.length));
            selection?.removeAllRanges();
            selection?.addRange(newRange);
          }
        }
      }
    }

    togglePlaceholder();
    const data = getContentData();
    if (data) {
      onInput?.({
        textContent: data.textContent,
        pureTextContent: data.pureTextContent,
      });
    }
  }, [togglePlaceholder, getContentData, onInput, maxLength, editorRef]);

  /**
   * 处理组合输入开始
   */
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  /**
   * 处理组合输入结束
   */
  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
    setComposingEndTime(Date.now());
    handleInput();
  }, [handleInput]);

  /**
   * 检查是否正在组合输入（包括 Safari 兼容）
   */
  const isCompositionActive = useCallback((event?: React.KeyboardEvent) => {
    const nativeEvent = event?.nativeEvent as globalThis.KeyboardEvent | undefined;
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const compositionRecentlyEnded = isSafari && Date.now() - composingEndTime < 20;

    return Boolean(
      isComposing ||
      (nativeEvent?.isComposing as boolean | undefined) ||
      nativeEvent?.keyCode === 229 ||
      compositionRecentlyEnded
    );
  }, [isComposing, composingEndTime]);

  /**
   * 获取当前光标（仅在编辑器内）
   */
  const getEditorCursor = useCallback((): CursorPosition | null => {
    const cursor = getCursor();
    if (cursor?.element && editorRef.current?.contains(cursor.element)) {
      return cursor;
    }
    return null;
  }, [editorRef]);

  /**
   * 保存最后光标位置
   */
  const saveCursor = useCallback(() => {
    lastCursorRef.current = getEditorCursor();
  }, [getEditorCursor]);

  /**
   * 获取"还活着的"最后光标位置
   *
   * 对齐原版 Sender.tsx line 625-632 的 getAliveLastCursor:
   * - 如果 lastCursor 记录的 element 还在编辑器 DOM 中,返回 lastCursor
   * - 否则返回 null
   *
   * 用于 triggerMention / triggerSkill 这种"从 button 点击时,光标已离开编辑器"的场景:
   * 我们用 lastCursor(用户上次在编辑器内停留的位置)作为插入位置。
   */
  const getAliveLastCursor = useCallback((): CursorPosition | null => {
    const cursor = lastCursorRef.current;
    if (
      cursor &&
      cursor.element &&
      editorRef.current?.contains(cursor.element)
    ) {
      return cursor;
    }
    return null;
  }, [editorRef]);

  // 初始化
  useEffect(() => {
    togglePlaceholder();
  }, [togglePlaceholder]);

  return {
    isComposing,
    isShowPlaceholder,
    lastCursorRef,
    insertText,
    insertNode,
    clear,
    focus,
    focusAtEnd,
    handleInput,
    handleCompositionStart,
    handleCompositionEnd,
    isCompositionActive,
    getEditorCursor,
    saveCursor,
    getAliveLastCursor,
    isEmptyEditor,
    getContentData,
  };
};
