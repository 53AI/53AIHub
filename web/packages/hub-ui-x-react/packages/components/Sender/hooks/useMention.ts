/**
 * @ 提及功能 Hook
 */

import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import type { MentionDocItem, MentionLinkItem } from '../types';
import { getCursor, hasClassName, findParent, moveCursorToEnd, createSpace, insertToTextNode, getPureText } from './useEditor';

export interface UseMentionOptions {
  editorRef: React.RefObject<HTMLDivElement>;
  enabled?: boolean;
  triggerCode?: string;
  maxCount?: number;
  placeholder?: string;
  createLinkInEditor?: boolean;
  list?: MentionLinkItem[];
  suggestions?: MentionDocItem[];
  recentList?: MentionDocItem[];
  searchKeyword?: string;
  searchLoading?: boolean;
  onSearch?: (keyword: string) => void;
  onSelect?: (item: MentionDocItem) => void;
  onRemove?: (item: MentionLinkItem) => void;
  onOpenLibrary?: () => void;
  /**
   * 从外部 Dialog 选中文件后调用(用于 SpaceDialog/MyFilesDialog 等)。
   * Hook 收到此回调后会清理编辑器中的 mention-input(对齐原版 Sender 行为)。
   */
  onSelectFiles?: (files: MentionDocItem[], libraries?: any[], spaces?: any[], wikis?: any[]) => void;
  onInput?: () => void;
  /** 点击编辑器外部时的回调（可选） */
  onClickOutside?: () => void;
  /**
   * 互斥:激活 mention-input 前调用,用于清理 skill-input 与 skill 弹窗。
   * 对齐原版 Sender.tsx line 1458-1463:输入 @ 时如果存在 skill-input,先清理。
   */
  onBeforeActivate?: () => void;
  /**
   * 由调用方提供,负责把 mention-input chip 真正插入编辑器并触发 placeholder 更新。
   * 通常指向 `useEditor.insertNode`,这样会自动:
   *   1. 调用 togglePlaceholder 让 .x-sender__placeholder 同步隐藏
   *   2. 在 chip 前后按需补空格文本节点(对齐原版 Sender 的 offsetBlock)
   *
   * `cursor` 可选:调用方传入(例如 `getAliveLastCursor()` 拿到的光标位置)
   * 时,会插入到该位置;否则 useEditor.insertNode 会用默认 `getEditorCursor()`。
   *
   * 如果未提供(向后兼容),hook 内部 fallback 到直接 range.insertNode/appendChild,
   * 这种情况下 placeholder 不会自动更新、inline-block chip 可能换行。
   */
  onInsertInput?: (input: HTMLElement, cursor?: any) => void;
}

export const useMention = (options: UseMentionOptions) => {
  const {
    editorRef,
    enabled = false,
    triggerCode = '@',
    maxCount = 20,
    placeholder = '指定文档',
    createLinkInEditor = false,
    list: externalList = [],
    suggestions = [],
    recentList = [],
    searchKeyword: externalSearchKeyword,
    searchLoading = false,
    onSearch,
    onSelect,
    onRemove,
    onOpenLibrary,
    onSelectFiles,
    onInput,
    onClickOutside,
    onBeforeActivate,
    onInsertInput,
  } = options;

  const [canShowSelect, setCanShowSelect] = useState(false);
  const [atRect, setAtRect] = useState<DOMRect | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [internalSearchKeyword, setInternalSearchKeyword] = useState('');
  const [hasSelectAfterOpen, setHasSelectAfterOpen] = useState(false);

  // 搜索关键词（受控/非受控）
  const searchKeyword = externalSearchKeyword !== undefined ? externalSearchKeyword : internalSearchKeyword;

  // 过滤后的建议列表
  const filteredSuggestions = useMemo(() => {
    const keyword = searchKeyword.trim();
    if (keyword && suggestions.length > 0) {
      return suggestions;
    }
    if (recentList.length > 0) {
      return recentList.slice(0, 5);
    }
    return suggestions.length > 0 ? suggestions.slice(0, 5) : [];
  }, [searchKeyword, suggestions, recentList]);

  /**
   * 创建 @ 输入元素
   */
  const createMentionInputElement = useCallback(() => {
    const text = document.createTextNode(triggerCode);
    const span = document.createElement('span');
    span.appendChild(text);
    span.className = 'mention-line-block mention-input empty';
    span.setAttribute('placeholder', placeholder);
    return span;
  }, [triggerCode, placeholder]);

  /**
   * 创建链接元素
   */
  const createMentionLinkElement = useCallback((data: MentionLinkItem) => {
    const a = document.createElement('a');
    a.setAttribute('data-json', JSON.stringify({
      id: data.id,
      name: data.name,
      icon: data.icon,
      upload_file_id: data.upload_file_id,
      file_size: data.file_size,
      file_mime: data.file_mime,
      library_id: data.library_id,
      isfolder: data.isfolder,
      islibrary: data.islibrary,
      isspace: data.isspace,
    }));

    const iconSpan = document.createElement('span');
    iconSpan.className = 'mention-link-icon';
    if (data.icon) {
      const img = document.createElement('img');
      img.src = data.icon;
      img.className = 'mention-link-icon-img';
      iconSpan.appendChild(img);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'mention-link-text';
    textSpan.textContent = data.name;

    const closeSpan = document.createElement('span');
    closeSpan.className = 'mention-link-close';
    closeSpan.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeSpan.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      a.remove();
      onRemove?.(data);
      onInput?.();
    };

    a.appendChild(iconSpan);
    a.appendChild(textSpan);
    a.appendChild(closeSpan);

    a.setAttribute('contenteditable', 'false');
    a.className = 'mention-link mention-line-block';

    return a;
  }, [onRemove, onInput]);

  /**
   * 查找当前 mention-input
   */
  const findMentionInput = useCallback((el?: Node | null): HTMLElement | null => {
    const element = el || getCursor()?.element;
    return findParent(element, (n: Node) => hasClassName(n, 'mention-input')) as HTMLElement | null;
  }, []);

  /**
   * 获取当前 mention-input
   */
  const getCurrentMentionInput = useCallback((): HTMLElement | null => {
    return editorRef.current?.querySelector('.mention-input') as HTMLElement | null;
  }, [editorRef]);

  /**
   * 激活 @ 输入
   *
   * 对齐原版 Sender.tsx line 746-768 的 activeMentionInput:
   * 1. 互斥清理 skill-input + 关闭 skill 弹窗(避免和 / 输入冲突)
   * 2. 创建 mention-input chip 并通过 onInsertInput(由调用方接 editor.insertNode)插入
   *    这样自动:触发 togglePlaceholder + BR 处理 + 全局补空格(对齐原版 offsetBlock)
   * 3. 光标放进 chip 内部(moveCursorToEnd)
   * 4. 设置 atRect(同步)+ 显示下拉(canShowSelect)
   *
   * 互斥清理采用双保险:
   * - hook 内直接通过 querySelector 删 .skill-input + 关闭 skill 弹窗
   *   (这样不依赖外部 onBeforeActivate 的时序)
   * - onBeforeActivate?.() 仍保留,供调用方扩展自定义清理逻辑
   */
  const activateMentionInput = useCallback((cursor?: any) => {
    if (!enabled || !editorRef.current) return;
    if (getCurrentMentionInput()) return;

    // 互斥:激活 mention 前清理 skill-input 与 skill 弹窗(对齐原版 Sender.tsx 1458-1463)
    // 直接兜底清理(不依赖 onBeforeActivate 的 ref 时序)
    const skillInputEl = editorRef.current.querySelector('.skill-input');
    if (skillInputEl) skillInputEl.remove();
    // onBeforeActivate 仍可由调用方提供,用于关闭 skill 弹窗等扩展
    onBeforeActivate?.();

    const input = createMentionInputElement();

    if (onInsertInput) {
      // 统一路径:触发 togglePlaceholder + BR 处理 + 全局补空格(对齐原版 Sender insertNode + offsetBlock)
      // onInsertInput 接受可选 cursor,默认 fallback 到 useEditor.insertNode 的 getEditorCursor
      (onInsertInput as any)(input, cursor);
    } else {
      // Fallback:直接 DOM 操作,placeholder 不会自动更新,可能换行
      if (typeof console !== 'undefined' && process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[Sender] useMention.activateMentionInput: onInsertInput 未提供,placeholder 与 chip 布局可能异常');
      }
      const sel = document.getSelection();
      let inserted = false;
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        if (editorRef.current.contains(range.startContainer)) {
          if (!range.collapsed) {
            range.deleteContents();
          }
          range.insertNode(input);
          inserted = true;
        }
      }
      if (!inserted) {
        editorRef.current.appendChild(input);
      }
    }

    // 先同步设置 atRect 再显示弹窗,避免 dropdown 先 fallback 到输入框下方再闪到正确位置的闪烁。
    setAtRect(input.getBoundingClientRect());
    // 光标放进 chip 内部(对齐原版 Sender:insertNode 后再 moveCursorToElementEnd(input))
    moveCursorToEnd(input);

    setCanShowSelect(true);
    setSelectedIndex(-1);
  }, [enabled, editorRef, getCurrentMentionInput, createMentionInputElement, onBeforeActivate, onInsertInput]);

/**
   * 选择项目
   *
   * 对齐原版 Sender.tsx line 1109-1139 的 onSingleSelected:
   * - createLinkInEditor=true:把 mention-input 替换为 mention-link chip,后面跟一个空格,
   *   走 editor.insertNode 路径自动补全前后空格(对齐原版 addLink)
   * - createLinkInEditor=false:删除 mention-input(对齐原版 removeInputingMention)
   */
  const selectItem = useCallback((item: MentionDocItem) => {
    if (!editorRef.current) return;

    // 检查是否已选择
    if (externalList.some((l) => l.id === item.id)) {
      setHasSelectAfterOpen(true);
      setCanShowSelect(false);
      return;
    }

    // 回调
    onSelect?.(item);

    if (createLinkInEditor) {
      const input = getCurrentMentionInput();
      const link = createMentionLinkElement({ ...item, ui: { active: true } });
      const space = createSpace(1);

      if (input) {
        // mention-input → mention-link 替换,然后 link 后跟一个空格
        // 走 editor.insertNode(传入 space)走统一的 BR/空格/placeholder 流程
        input.replaceWith(link);
        if (onInsertInput) {
          (onInsertInput as any)(space);
        } else {
          link.after(space);
          moveCursorToEnd(space);
        }
      } else {
        // 没有 mention-input:直接插入 link + space(对齐原版:这里原版 addLink 在 createLinkInEditor
        // 且 !input 时只 insert link + space,不调 insertNode,我们保留同样行为)
        editorRef.current.appendChild(link);
        editorRef.current.appendChild(space);
        moveCursorToEnd(space);
      }
    } else {
      // 非编辑器内创建链接模式:删除 mention-input(对齐原版 onSingleSelected 行为)
      // apps/front-react/src/components/Chat/Sender.tsx line 1122-1124
      const input = getCurrentMentionInput();
      if (input) {
        input.remove();
      }
    }

    // 标记已选择过
    setHasSelectAfterOpen(true);
    setCanShowSelect(false);
    setInternalSearchKeyword('');
    onInput?.();
  }, [editorRef, externalList, onSelect, createLinkInEditor, getCurrentMentionInput, createMentionLinkElement, onInput]);

  /**
   * 关闭选择器
   */
  const closeSelect = useCallback(() => {
    setCanShowSelect(false);
    setSelectedIndex(-1);
    setInternalSearchKeyword('');
  }, []);

  /**
   * 点击外部处理
   * 根据 hasSelectAfterOpen 决定是否删除 mention-input
   */
  const handleClickOutside = useCallback(() => {
    if (!canShowSelect) return;

    // 关闭下拉框
    setCanShowSelect(false);
    setSelectedIndex(-1);
    setInternalSearchKeyword('');

    // 根据 hasSelectAfterOpen 决定处理方式
    const input = getCurrentMentionInput();
    if (input) {
      if (hasSelectAfterOpen) {
        // 已选择过 → 删除 mention-input
        input.remove();
      } else {
        // 未选择过 → 转换为普通文字
        const text = document.createTextNode(input.textContent || '');
        input.replaceWith(text);
      }
    }

    onClickOutside?.();
  }, [canShowSelect, hasSelectAfterOpen, getCurrentMentionInput, onClickOutside]);

  /**
   * 点击 mention-input 时重新打开下拉框
   */
  const handleClickOnInput = useCallback((input: HTMLElement) => {
    if (!enabled) return;

    setAtRect(input.getBoundingClientRect());
    setCanShowSelect(true);
    setSelectedIndex(-1);

    // 提取搜索关键词
    const text = input.textContent || '';
    const keyword = text.startsWith(triggerCode) ? text.slice(1) : text;
    setInternalSearchKeyword(keyword);
    onSearch?.(keyword);

    // 移动光标到输入末尾
    setTimeout(() => moveCursorToEnd(input), 0);
  }, [enabled, triggerCode, onSearch]);

  /**
   * 退出 mention-input 模式
   * @param force - 强制删除（不转换为文字）
   */
  const quitMentionInput = useCallback((force = false) => {
    const input = getCurrentMentionInput();
    if (!input) return;

    if (hasSelectAfterOpen || force) {
      // 删除 mention-input
      input.remove();
    } else {
      // 转换为普通文字
      const text = document.createTextNode(input.textContent || '');
      input.replaceWith(text);
    }

    closeSelect();
    setHasSelectAfterOpen(false);
  }, [hasSelectAfterOpen, getCurrentMentionInput, closeSelect]);

  /**
   * 处理外部 Dialog 选中文件(SpaceDialog / MyFilesDialog)。
   * 清理编辑器中的 mention-input 并关闭下拉框。
   * 对齐原版 Sender:onSelectFiles 触发的副作用。
   *
   * 由 SenderRef.quitMentionInput 间接触发,保留以供外部直接调用。
   */
  const handleSelectFiles = useCallback(() => {
    // 关闭下拉框
    setCanShowSelect(false);
    setSelectedIndex(-1);
    setInternalSearchKeyword('');

    // 清理 mention-input
    const input = getCurrentMentionInput();
    if (input) {
      input.remove();
    }
    setHasSelectAfterOpen(false);

    // 触发输入回调
    onInput?.();
  }, [getCurrentMentionInput, onInput]);

  /**
   * 检查并转换无效的 mention-input
   * 内容不以 @ 开头时转换为普通文字
   */
  const checkAndConvertInput = useCallback(() => {
    const input = getCurrentMentionInput();
    if (!input) {
      // 没有 mention-input → 关闭下拉框
      closeSelect();
      return;
    }

    const text = input.textContent || '';
    if (!text.startsWith(triggerCode)) {
      // 内容不以 @ 开头 → 转换为普通文字
      const textNode = document.createTextNode(text);
      input.replaceWith(textNode);
      closeSelect();
    }
  }, [triggerCode, getCurrentMentionInput, closeSelect]);

  /**
   * 处理搜索
   */
  const handleSearch = useCallback((keyword: string) => {
    setInternalSearchKeyword(keyword);
    onSearch?.(keyword);
  }, [onSearch]);

  /**
   * 处理输入（检查 @ 触发）
   */
  const handleInputCheck = useCallback((event?: React.KeyboardEvent) => {
    if (!enabled) return;

    const cursor = getCursor();
    if (!cursor || !cursor.element) return;

    // 检查是否在 mention-input 中
    const mentionInput = findMentionInput(cursor.element);
    if (mentionInput) {
      setAtRect(mentionInput.getBoundingClientRect());
      setCanShowSelect(true);
      const text = mentionInput.textContent || '';
      const keyword = text.startsWith(triggerCode) ? text.slice(1) : text;
      handleSearch(keyword);
      return;
    }

    // 检查是否输入了 @
    const cursorChar = cursor.element.textContent?.slice(cursor.cursorPos - 1, cursor.cursorPos) || '';
    if (cursorChar === triggerCode && !getCurrentMentionInput()) {
      // 移除 @ 字符并激活输入
      if (cursor.element.nodeType === Node.TEXT_NODE) {
        const textNode = cursor.element as Text;
        const text = textNode.textContent || '';
        const beforeText = text.slice(0, cursor.cursorPos - 1);
        const afterText = text.slice(cursor.cursorPos);
        textNode.textContent = beforeText + afterText;

        // 重新设置光标位置
        const sel = document.getSelection();
        if (sel && textNode.parentElement) {
          const newRange = document.createRange();
          const newOffset = Math.max(0, cursor.cursorPos - 1);
          newRange.setStart(textNode, Math.min(newOffset, beforeText.length));
          newRange.setEnd(textNode, Math.min(newOffset, beforeText.length));
          sel.removeAllRanges();
          sel.addRange(newRange);
        }
      }
      activateMentionInput();
    }
  }, [enabled, triggerCode, findMentionInput, getCurrentMentionInput, activateMentionInput, handleSearch]);

  /**
   * 处理键盘导航
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent): boolean => {
    if (!canShowSelect) return false;

    const mentionInput = findMentionInput();
    if (!mentionInput) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredSuggestions.length - 1 ? prev + 1 : 0
      );
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredSuggestions.length - 1
      );
      return true;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < filteredSuggestions.length) {
        selectItem(filteredSuggestions[selectedIndex]);
      }
      return true;
    }

    if (event.key === 'Escape') {
      closeSelect();
      return true;
    }

    return false;
  }, [canShowSelect, findMentionInput, filteredSuggestions, selectedIndex, selectItem, closeSelect]);

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchKeyword]);

  return {
    canShowSelect,
    atRect,
    selectedIndex,
    searchKeyword,
    searchLoading,
    filteredSuggestions,
    activateMentionInput,
    selectItem,
    closeSelect,
    handleSearch,
    handleInputCheck,
    handleKeyDown,
    createMentionLinkElement,
    // 新增方法
    handleClickOutside,
    handleClickOnInput,
    quitMentionInput,
    checkAndConvertInput,
    handleSelectFiles,
    hasSelectAfterOpen,
  };
};
