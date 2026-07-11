/**
 * / 技能功能 Hook
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { SkillItem } from '../types';
import { getCursor, hasClassName, findParent, moveCursorToEnd } from './useEditor';

export interface UseSkillOptions {
  editorRef: React.RefObject<HTMLDivElement>;
  enabled?: boolean;
  triggerCode?: string;
  list?: SkillItem[];
  suggestions?: SkillItem[];
  searchKeyword?: string;
  searchLoading?: boolean;
  onSearch?: (keyword: string) => void;
  onSelect?: (skill: SkillItem) => void;
  onRemove?: () => void;
  onOpenLibrary?: () => void;
  onInput?: () => void;
  /** 点击编辑器外部时的回调（可选） */
  onClickOutside?: () => void;
  /**
   * 互斥:激活 skill-input 前调用,用于清理 mention-input 与 mention 弹窗。
   * 对齐原版 Sender.tsx line 1474-1479:输入 / 时如果存在 mention-input,先清理。
   */
  onBeforeActivate?: () => void;
  /**
   * 由调用方提供,负责把 skill-input chip 真正插入编辑器并触发 placeholder 更新。
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

export const useSkill = (options: UseSkillOptions) => {
  const {
    editorRef,
    enabled = false,
    triggerCode = '/',
    list: externalList = [],
    suggestions = [],
    searchKeyword: externalSearchKeyword,
    searchLoading = false,
    onSearch,
    onSelect,
    onRemove,
    onOpenLibrary,
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

  // 过滤后的建议列表——无关键词时也展示全部,容器已设 max-height + overflow-y 滚动
  const filteredSuggestions = useMemo(() => {
    return suggestions;
  }, [suggestions]);

  /**
   * 创建技能输入元素
   */
  const createSkillInputElement = useCallback(() => {
    const text = document.createTextNode(triggerCode);
    const span = document.createElement('span');
    span.appendChild(text);
    span.className = 'mention-line-block skill-input empty';
    span.setAttribute('placeholder', '选择技能');
    return span;
  }, [triggerCode]);

  /**
   * 创建技能标签元素
   */
  const createSkillTagElement = useCallback((skill: SkillItem) => {
    const span = document.createElement('span');
    span.className = 'mention-line-block skill-tag';
    span.setAttribute('data-skill', skill.label || skill.display_name || '');
    span.setAttribute('contenteditable', 'false');

    const textSpan = document.createElement('span');
    textSpan.className = 'skill-tag-text';
    textSpan.textContent = skill.label || skill.display_name || '';

    const closeSpan = document.createElement('span');
    closeSpan.className = 'skill-tag-close';
    closeSpan.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeSpan.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      span.remove();
      onRemove?.();
      onInput?.();
    };

    span.appendChild(textSpan);
    span.appendChild(closeSpan);

    return span;
  }, [onRemove, onInput]);

  /**
   * 查找当前 skill-input
   */
  const findSkillInput = useCallback((el?: Node | null): HTMLElement | null => {
    const element = el || getCursor()?.element;
    return findParent(element, (n: Node) => hasClassName(n, 'skill-input')) as HTMLElement | null;
  }, []);

  /**
   * 获取当前 skill-input
   */
  const getCurrentSkillInput = useCallback((): HTMLElement | null => {
    return editorRef.current?.querySelector('.skill-input') as HTMLElement | null;
  }, [editorRef]);

  /**
   * 获取当前技能标签
   */
  const getCurrentSkillTag = useCallback((): HTMLElement | null => {
    return editorRef.current?.querySelector('.skill-tag') as HTMLElement | null;
  }, [editorRef]);

  /**
   * 激活技能输入
   *
   * 对齐原版 Sender.tsx line 770-790 的 activeSkillInput:
   * 1. 互斥清理 mention-input + 关闭 mention 弹窗(避免和 @ 输入冲突)
   * 2. 创建 skill-input chip 并通过 onInsertInput 插入
   *    这样自动:触发 togglePlaceholder + BR 处理 + 全局补空格
   * 3. 光标放进 chip 内部(moveCursorToEnd)
   * 4. 设置 atRect(同步)+ 显示下拉(canShowSelect)
   *
   * 互斥清理采用双保险:
   * - hook 内直接通过 querySelector 删 .mention-input + 关闭 mention 弹窗
   *   (这样不依赖外部 onBeforeActivate 的 ref 时序)
   * - onBeforeActivate?.() 仍保留,供调用方扩展自定义清理逻辑
   */
  const activateSkillInput = useCallback((cursor?: any) => {
    if (!enabled || !editorRef.current) return;
    if (getCurrentSkillInput()) return;

    // 互斥:激活 skill 前清理 mention-input 与 mention 弹窗(对齐原版 Sender.tsx 1474-1479)
    // 直接兜底清理(不依赖 onBeforeActivate 的 ref 时序)
    const mentionInputEl = editorRef.current.querySelector('.mention-input');
    if (mentionInputEl) mentionInputEl.remove();
    // onBeforeActivate 仍可由调用方提供,用于关闭 mention 弹窗等扩展
    onBeforeActivate?.();

    const input = createSkillInputElement();

    if (onInsertInput) {
      // 统一路径:触发 togglePlaceholder + BR 处理 + 全局补空格(对齐原版 Sender insertNode + offsetBlock)
      // onInsertInput 接受可选 cursor,默认 fallback 到 useEditor.insertNode 的 getEditorCursor
      (onInsertInput as any)(input, cursor);
    } else {
      // Fallback:直接 DOM 操作,placeholder 不会自动更新,可能换行
      if (typeof console !== 'undefined' && process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[Sender] useSkill.activateSkillInput: onInsertInput 未提供,placeholder 与 chip 布局可能异常');
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
  }, [enabled, editorRef, getCurrentSkillInput, createSkillInputElement, onBeforeActivate, onInsertInput]);

  /**
   * 选择技能
   *
   * 对齐原版 Sender.tsx line 1813-1852 的 handleSelectSkill:
   * 1. 删除 mention-input(互斥)、skill-input、旧的 skill-tag
   * 2. prepend 一个新的 skill-tag 到编辑器开头
   * 3. 走 editor.insertNode 路径(由 onInsertInput 转发)保证:
   *    - BR 处理(避免空编辑器自动 BR 导致换行)
   *    - 全局补空格(原版 offsetBlock)
   *    - placeholder 同步
   * 4. 光标移到 skill-tag 末尾
   */
  const selectSkill = useCallback((skill: SkillItem) => {
    if (!editorRef.current) return;

    // 互斥:删除 mention-input(对齐原版 line 1820-1822)
    const mentionInputEl = editorRef.current.querySelector('.mention-input');
    if (mentionInputEl) mentionInputEl.remove();

    // 移除 skill-input
    const skillInput = getCurrentSkillInput();
    if (skillInput) {
      skillInput.remove();
    }

    // 移除旧的技能标签（只保留一个）
    const oldSkillTag = getCurrentSkillTag();
    if (oldSkillTag) {
      oldSkillTag.remove();
    }

    // 创建技能标签
    const skillTag = createSkillTagElement(skill);

    // prepend 后走 editor.insertNode 路径(由 onInsertInput 转发)
    // 这样自动:BR 处理 + 全局补空格 + placeholder 同步(对齐原版 addLink)
    if (onInsertInput) {
      (onInsertInput as any)(skillTag);
    } else {
      editorRef.current.prepend(skillTag);
      moveCursorToEnd(skillTag);
    }

    // 回调
    onSelect?.(skill);

    setCanShowSelect(false);
    setInternalSearchKeyword('');
    onInput?.();
  }, [editorRef, getCurrentSkillInput, getCurrentSkillTag, createSkillTagElement, onSelect, onInput, onInsertInput]);

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
   */
  const handleClickOutside = useCallback(() => {
    if (!canShowSelect) return;

    // 关闭下拉框
    setCanShowSelect(false);
    setSelectedIndex(-1);
    setInternalSearchKeyword('');

    // 根据 hasSelectAfterOpen 决定处理方式
    const input = getCurrentSkillInput();
    if (input) {
      if (hasSelectAfterOpen) {
        input.remove();
      } else {
        const text = document.createTextNode(input.textContent || '');
        input.replaceWith(text);
      }
    }

    onClickOutside?.();
  }, [canShowSelect, hasSelectAfterOpen, getCurrentSkillInput, onClickOutside]);

  /**
   * 点击 skill-input 时重新打开下拉框
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
   * 退出 skill-input 模式
   * @param force - 强制删除（不转换为文字）
   */
  const quitSkillInput = useCallback((force = false) => {
    const input = getCurrentSkillInput();
    if (!input) return;

    if (hasSelectAfterOpen || force) {
      input.remove();
    } else {
      const text = document.createTextNode(input.textContent || '');
      input.replaceWith(text);
    }

    closeSelect();
    setHasSelectAfterOpen(false);
  }, [hasSelectAfterOpen, getCurrentSkillInput, closeSelect]);

  /**
   * 检查并转换无效的 skill-input
   */
  const checkAndConvertInput = useCallback(() => {
    const input = getCurrentSkillInput();
    if (!input) {
      closeSelect();
      return;
    }

    const text = input.textContent || '';
    if (!text.startsWith(triggerCode)) {
      const textNode = document.createTextNode(text);
      input.replaceWith(textNode);
      closeSelect();
    }
  }, [triggerCode, getCurrentSkillInput, closeSelect]);

  /**
   * 处理搜索
   */
  const handleSearch = useCallback((keyword: string) => {
    setInternalSearchKeyword(keyword);
    onSearch?.(keyword);
  }, [onSearch]);

  /**
   * 插入技能标签
   *
   * 对齐原版 Sender.tsx line 1725-1744 的 insertSkill:
   * 1. 检查重复(已有同 data-skill 则返回)
   * 2. 移除旧 skill-tag
   * 3. prepend 新 skill-tag
   * 4. 走 editor.insertNode 路径(由 onInsertInput 转发)保证 BR 处理 + 全局补空格 + placeholder 同步
   * 5. 光标移到末尾
   */
  const insertSkillTag = useCallback((skill: SkillItem) => {
    if (!editorRef.current) return;

    // 检查是否已存在
    const existingTag = editorRef.current.querySelector(`.skill-tag[data-skill="${skill.label || skill.display_name}"]`);
    if (existingTag) return;

    // 移除旧的
    const oldTag = getCurrentSkillTag();
    if (oldTag) {
      oldTag.remove();
    }

    const skillTag = createSkillTagElement(skill);

    // prepend 后走 editor.insertNode 路径(由 onInsertInput 转发)
    if (onInsertInput) {
      (onInsertInput as any)(skillTag);
    } else {
      editorRef.current.prepend(skillTag);
      moveCursorToEnd(skillTag);
    }

    onInput?.();
  }, [editorRef, getCurrentSkillTag, createSkillTagElement, onInput, onInsertInput]);

  /**
   * 清空技能标签
   */
  const clearSkillTags = useCallback(() => {
    if (!editorRef.current) return;
    const skillTags = editorRef.current.querySelectorAll('.skill-tag');
    skillTags.forEach((tag) => tag.remove());
    onInput?.();
  }, [editorRef, onInput]);

  /**
   * 处理输入（检查 / 触发）
   */
  const handleInputCheck = useCallback((event?: React.KeyboardEvent) => {
    if (!enabled) return;

    const cursor = getCursor();
    if (!cursor || !cursor.element) return;

    // 检查是否在 skill-input 中
    const skillInput = findSkillInput(cursor.element);
    if (skillInput) {
      setAtRect(skillInput.getBoundingClientRect());
      setCanShowSelect(true);
      const text = skillInput.textContent || '';
      const keyword = text.startsWith(triggerCode) ? text.slice(1) : text;
      handleSearch(keyword);
      return;
    }

    // 检查是否输入了 /
    const cursorChar = cursor.element.textContent?.slice(cursor.cursorPos - 1, cursor.cursorPos) || '';
    if (cursorChar === triggerCode && !getCurrentSkillInput()) {
      // 移除 / 字符并激活输入
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
      activateSkillInput();
    }
  }, [enabled, triggerCode, findSkillInput, getCurrentSkillInput, activateSkillInput, handleSearch]);

  /**
   * 处理键盘导航
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent): boolean => {
    if (!canShowSelect) return false;

    const skillInput = findSkillInput();
    if (!skillInput) return false;

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
        selectSkill(filteredSuggestions[selectedIndex]);
      }
      return true;
    }

    if (event.key === 'Escape') {
      closeSelect();
      return true;
    }

    return false;
  }, [canShowSelect, findSkillInput, filteredSuggestions, selectedIndex, selectSkill, closeSelect]);

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
    activateSkillInput,
    selectSkill,
    closeSelect,
    handleSearch,
    handleInputCheck,
    handleKeyDown,
    insertSkillTag,
    clearSkillTags,
    // 新增方法
    handleClickOutside,
    handleClickOnInput,
    quitSkillInput,
    checkAndConvertInput,
    hasSelectAfterOpen,
  };
};