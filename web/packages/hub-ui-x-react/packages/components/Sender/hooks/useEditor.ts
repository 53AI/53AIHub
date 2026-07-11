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
    if (cursor && !cursor.range.collapsed) {
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
      // 光标在 editor 自身(选中后塌缩到 editor):按 lastChild 处理
      appendOrBeforeBR();
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
