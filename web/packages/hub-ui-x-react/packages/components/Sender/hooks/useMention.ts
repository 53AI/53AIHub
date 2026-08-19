/**
 * @ 提及功能 Hook
 *
 * ⚠️ 镜像同步警告 ⚠️
 * 本 hook 与 `./useSkill.ts` 共享 ~70% 状态机逻辑,以下函数必须**逐行同步修改**:
 *   - closeSelect
 *   - handleClickOutside
 *   - handleClickOnInput
 *   - quitMentionInput
 *   - cancelMentionInput
 *   - checkAndConvertInput
 *   - handleSearch
 *   - handleInputCheck
 *   - handleKeyDown
 *
 * 这些函数体在两份文件里**应当字面相同**,只有关键字 / className / 数据类型差异。
 * 改动任何一个,必须立刻同步改 useSkill.ts 的对应函数,否则 @ 和 / 行为会漂移。
 * 每个函数体顶部都有 `// SYNC: useSkill.<fnName>` 标记,grep 即可定位。
 *
 * 长期方案:抽 `useChipTrigger` 高阶 hook 统一这两处。详见 OpenSpec 记录。
 */

import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import type { MentionDocItem, MentionLinkItem } from '../types';
import { getCursor, hasClassName, findParent, moveCursorToEnd, createSpace, insertToTextNode, getPureText, dissolveChip } from './useEditor';

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
  /**
   * 把焦点放回编辑器。Esc 取消 @ 输入态时必须调用 —— 否则焦点留在
   * 已被卸载的下拉搜索框上,用户后续按键无效。
   * 通常指向 `useEditor.focusAtEnd`。
   */
  focusEditor?: () => void;
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
    focusEditor,
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
    // 搜索态:结果即结果,空结果就是空态,不回落到「最近访问」
    // (回落会导致 results=null 时下拉里仍列出最近文件,用户误以为是搜索命中)
    if (keyword) {
      return suggestions;
    }
    if (recentList.length > 0) {
      return recentList.slice(0, 5);
    }
    return suggestions.slice(0, 5);
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
        // 走 editor.insertNode 走统一的 BR/空格/placeholder 流程
        input.replaceWith(link);
        if (onInsertInput) {
          // 必须传 cursor,否则 insertNode fallback 到 appendOrBeforeBR,
          // space 会被 append 到编辑器末尾(用户看到的「空格跑掉了」)。
          // link 是 element 不是 text,cursorPos 任意 → insertNode 走 element.after(node) 分支,
          // 把 space 插到 link 之后,正是我们想要的位置。
          (onInsertInput as any)(space, { element: link, cursorPos: 0 });
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
   * // SYNC: useSkill.closeSelect
   */
  const closeSelect = useCallback(() => {
    setCanShowSelect(false);
    setSelectedIndex(-1);
    setInternalSearchKeyword('');
  }, []);

  /**
   * 点击外部处理
   * 根据 hasSelectAfterOpen 决定是否删除 mention-input
   * // SYNC: useSkill.handleClickOutside
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
      // 已选择过 → 删除 mention-input;未选择过 → 转换为普通文字
      // restoreCaret=false + normalize=false:点击发生在编辑器外部,
      // 不能把光标抢回来,也不能合并相邻文本节点顶掉浏览器刚放好的光标
      dissolveChip(input, { keepText: !hasSelectAfterOpen, restoreCaret: false, normalize: false });
    }

    onClickOutside?.();
  }, [canShowSelect, hasSelectAfterOpen, getCurrentMentionInput, onClickOutside]);

  /**
   * 点击 mention-input 时重新打开下拉框
   * // SYNC: useSkill.handleClickOnInput
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
   *
   * 用于"用户把注意力移到别处"的场景(点击编辑器其它位置、输入 / 触发互斥清理)。
   * 这些场景下光标已经由用户的操作决定,所以 restoreCaret=false,不能抢回来。
   * 键盘主动取消(Esc / Backspace)请用 cancelMentionInput。
   *
   * 也不调 normalize():浏览器已经在 mousedown 时把光标放到了用户点击的位置,
   * 立刻合并相邻文本节点会让光标所在的节点被吞掉,Selection 失锚,光标塌缩到编辑器开头。
   *
   * @param force - 强制删除（不转换为文字）
   * // SYNC: useSkill.quitSkillInput
   */
  const quitMentionInput = useCallback((force = false) => {
    const input = getCurrentMentionInput();
    if (!input) return;

    dissolveChip(input, {
      keepText: !(hasSelectAfterOpen || force),
      restoreCaret: false,
      normalize: false,
    });

    closeSelect();
    setHasSelectAfterOpen(false);
  }, [hasSelectAfterOpen, getCurrentMentionInput, closeSelect]);

  /**
   * 主动取消 @ 输入态（键盘触发，必须恢复光标）
   *
   * @param toText - true: chip 还原成普通 "@" 文字，光标停在它后面（Esc）
   *                 false: 整块删除，光标回到 chip 原来的位置（删掉 @ 触发符）
   * @returns 是否真的处理了（编辑器里没有 mention-input 时返回 false）
   * // SYNC: useSkill.cancelSkillInput
   */
  const cancelMentionInput = useCallback((toText: boolean): boolean => {
    const input = getCurrentMentionInput();
    if (!input) return false;

    dissolveChip(input, { keepText: toText, restoreCaret: true });

    closeSelect();
    setHasSelectAfterOpen(false);
    // chip 内的文字原本被 getPureText 当作 mention 块跳过,
    // 溶解成普通文字/删除后内容变了,必须同步一次 onChange。
    onInput?.();
    // 焦点要拉回编辑器:下拉弹窗的搜索框在被卸载前抢走了 focus,
    // 不主动 focus 回去,用户后续按键(包括再次输入 @)都进不来。
    // 用 queueMicrotask 而不是 setTimeout(0):微任务在当前同步代码块结束
    // 后立即 flush,比 React 下一次 commit 早一步,焦点回拉更紧凑;
    // 且浏览器会把失败的焦点切换(目标已 detach)抛到 microtask 队列,
    // 比 setTimeout 多一层错误兜底。
    if (focusEditor) {
      queueMicrotask(() => focusEditor());
    }
    return true;
  }, [getCurrentMentionInput, closeSelect, onInput, focusEditor]);

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
   *
   * 两种"无效"情况都在这里收口:
   * - 内容被删空（用户 Backspace 删掉了 @）→ 整块删除
   * - 内容不再以 @ 开头 → 还原成普通文字
   *
   * 必须走 dissolveChip 恢复光标:原实现 `input.replaceWith(空文本节点)` 会让
   * Selection 失去锚点,浏览器把光标塌缩到编辑器开头 —— 即"删除 @ 后光标出现在 @ 前面"。
   * // SYNC: useSkill.checkAndConvertInput
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
      dissolveChip(input, { keepText: true, restoreCaret: true });
      closeSelect();
    }
  }, [triggerCode, getCurrentMentionInput, closeSelect]);

  /**
   * 处理搜索
   * // SYNC: useSkill.handleSearch
   */
  const handleSearch = useCallback((keyword: string) => {
    setInternalSearchKeyword(keyword);
    onSearch?.(keyword);
  }, [onSearch]);

  /**
   * 处理输入（检查 @ 触发）
   * // SYNC: useSkill.handleInputCheck
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
      activateMentionInput(getCursor() || undefined);
    }
  }, [enabled, triggerCode, findMentionInput, getCurrentMentionInput, activateMentionInput, handleSearch]);

  /**
   * 处理键盘导航
   *
   * Esc / Backspace 的判定用 getCurrentMentionInput()(编辑器内查询)而不是
   * findMentionInput()(基于光标向上找):点 @ 按钮进入输入态时光标可能不在 chip 内,
   * 用光标判定会漏掉。方向键/回车仍沿用原来的光标判定,避免行为变化。
   * // SYNC: useSkill.handleKeyDown
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent): boolean => {
    const mentionInput = getCurrentMentionInput();
    if (!mentionInput) return false;

    // Esc:取消 @ 文档选择状态,chip 还原成一个普通的 "@" 字符,光标停在它后面
    if (event.key === 'Escape') {
      event.preventDefault();
      // 阻止冒泡,避免顺带关掉外层 Modal/Drawer
      event.stopPropagation();
      cancelMentionInput(true);
      return true;
    }

    // Backspace:chip 内只剩触发符时整块删除,并把光标放回 chip 原来的位置。
    // 交给浏览器处理会留下一个空 span,后续清理时 Selection 失锚,
    // 光标会被塌缩到编辑器开头(表现为跑到 @ 前面)。
    if (event.key === 'Backspace') {
      const cursor = getCursor();
      const inputAtCursor = cursor?.element ? findMentionInput(cursor.element) : null;
      const isCollapsed = cursor?.range ? cursor.range.collapsed : true;
      if (
        inputAtCursor === mentionInput &&
        isCollapsed &&
        (cursor?.cursorPos ?? 0) > 0 &&
        (mentionInput.textContent || '') === triggerCode
      ) {
        event.preventDefault();
        cancelMentionInput(false);
        return true;
      }
    }

    if (!canShowSelect) return false;
    if (!findMentionInput()) return false;

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

    return false;
  }, [
    canShowSelect,
    triggerCode,
    getCurrentMentionInput,
    findMentionInput,
    filteredSuggestions,
    selectedIndex,
    selectItem,
    cancelMentionInput,
  ]);

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
    cancelMentionInput,
    checkAndConvertInput,
    handleSelectFiles,
    hasSelectAfterOpen,
  };
};
