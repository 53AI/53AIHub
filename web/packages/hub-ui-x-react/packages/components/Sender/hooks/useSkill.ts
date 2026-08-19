/**
 * / 技能功能 Hook
 *
 * ⚠️ 镜像同步警告 ⚠️
 * 本 hook 与 `./useMention.ts` 共享 ~70% 状态机逻辑,以下函数必须**逐行同步修改**:
 *   - closeSelect
 *   - handleClickOutside
 *   - handleClickOnInput
 *   - quitSkillInput
 *   - cancelSkillInput
 *   - checkAndConvertInput
 *   - handleSearch
 *   - handleInputCheck
 *   - handleKeyDown
 *
 * 这些函数体在两份文件里**应当字面相同**,只有关键字 / className / 数据类型差异。
 * 改动任何一个,必须立刻同步改 useMention.ts 的对应函数,否则 @ 和 / 行为会漂移。
 * 每个函数体顶部都有 `// SYNC: useMention.<fnName>` 标记,grep 即可定位。
 *
 * 长期方案:抽 `useChipTrigger` 高阶 hook 统一这两处。详见 OpenSpec 记录。
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { SkillItem } from '../types';
import { getCursor, hasClassName, findParent, moveCursorTo, moveCursorToEnd, dissolveChip } from './useEditor';

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
  /**
   * 把焦点放回编辑器。Esc 取消 / 输入态时必须调用 —— 否则焦点留在
   * 已被卸载的下拉搜索框上,用户后续按键无效。
   * 通常指向 `useEditor.focusAtEnd`。
   */
  focusEditor?: () => void;
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
    focusEditor,
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
   * 判断节点是否「惰性」(对触发位置判定不算「真内容」):
   *   - 纯空白文本节点(只有空格 / 换行)
   *   - mention / skill 等 inline-block chip(`.mention-line-block`)
   *   - 占位用的 `<br>`
   *   - `.x-sender__placeholder`
   *
   * 「逻辑开头」定义:从编辑器开头到光标位置的 Range 覆盖范围内,所有节点都是惰性的。
   * 这样 [skill-tag] | 算开头(光标前只有 chip),但 [skill-tag] hello| 不算(hello 是真内容)。
   */
  const isInertNode = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node as Text).textContent || '';
      return text.trim().length === 0;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      return (
        el.classList.contains('mention-line-block') ||
        el.tagName === 'BR' ||
        el.classList.contains('x-sender__placeholder')
      );
    }
    return false;
  };

  /**
   * 判断光标是否在「逻辑开头」。
   *
   * 用 Range(editor, 0) → (cursor.element, cursor.cursorPos) 包住光标之前的所有内容,
   * 全部惰性就算逻辑开头;出现非惰性节点(hello / 真文本 / 非 chip 元素)就算中间位置。
   *
   * 用于 / 触发位置限制 —— 领导要求 / 只能在编辑器逻辑开头触发,中间位置输入 / 当普通字符。
   * Q4 例外:如果之前选过技能(只剩 [skill-tag]),仍允许再输入 / 触发新选择。
   */
  const isCursorAtLogicalStart = (cursor: { element: Node; cursorPos: number } | null): boolean => {
    const editor = editorRef.current;
    if (!cursor || !editor) return false;

    const range = document.createRange();
    try {
      range.setStart(editor, 0);
      range.setEnd(cursor.element, cursor.cursorPos);
    } catch {
      return false;
    }

    const fragment = range.cloneContents();
    for (const node of Array.from(fragment.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node as Text).textContent || '';
        if (text.trim().length > 0) return false;
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (!isInertNode(node)) return false;
        continue;
      }
      return false;
    }
    return true;
  };

  /**
   * 把光标移到「逻辑开头」。
   *
   * 找到编辑器里第一个非惰性节点:
   *   - 文本节点 → 光标落到 (text, 0)
   *   - 非惰性元素 → 光标落到该元素之前 (editor, index)
   * 全部惰性 → 光标移到编辑器末尾。
   *
   * 由 Skill 按钮点击时调用,让用户即便光标停在中间,也能从按钮触发技能选择。
   */
  const moveCursorToLogicalStart = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    for (let i = 0; i < editor.childNodes.length; i++) {
      const node = editor.childNodes[i];
      if (isInertNode(node)) continue;

      if (node.nodeType === Node.TEXT_NODE) {
        moveCursorTo(node as Text, 0);
        return;
      }
      // 非惰性元素 → 光标落到它之前
      const sel = document.getSelection();
      const r = document.createRange();
      r.setStart(editor, i);
      r.setEnd(editor, i);
      sel?.removeAllRanges();
      sel?.addRange(r);
      return;
    }

    // 全部惰性 → 末尾
    moveCursorToEnd(editor);
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

    // 技能选择后,skill-tag 必须放在最前 ——「/ 只能在逻辑开头触发」的语义延伸。
    // 显式传 cursor={editor, 0},让 insertNode prepend 到 firstChild 之前,
    // 而不是 fallback 到 appendOrBeforeBR 把 chip 扔到编辑器末尾。
    // (insertNode 已专门处理 element === editor && cursorPos === 0 → prepend)
    if (onInsertInput) {
      (onInsertInput as any)(skillTag, { element: editorRef.current, cursorPos: 0 });
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
   * // SYNC: useMention.closeSelect
   */
  const closeSelect = useCallback(() => {
    setCanShowSelect(false);
    setSelectedIndex(-1);
    setInternalSearchKeyword('');
  }, []);

  /**
   * 点击外部处理
   * // SYNC: useMention.handleClickOutside
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
      // 已选择过 → 删除 skill-input;未选择过 → 转换为普通文字
      // restoreCaret=false + normalize=false:点击发生在编辑器外部,
      // 不能把光标抢回来,也不能合并相邻文本节点顶掉浏览器刚放好的光标
      dissolveChip(input, { keepText: !hasSelectAfterOpen, restoreCaret: false, normalize: false });
    }

    onClickOutside?.();
  }, [canShowSelect, hasSelectAfterOpen, getCurrentSkillInput, onClickOutside]);

  /**
   * 点击 skill-input 时重新打开下拉框
   * // SYNC: useMention.handleClickOnInput
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
   *
   * 用于"用户把注意力移到别处"的场景(点击编辑器其它位置、输入 @ 触发互斥清理)。
   * 这些场景下光标已经由用户的操作决定,所以 restoreCaret=false,不能抢回来。
   * 键盘主动取消(Esc / Backspace)请用 cancelSkillInput。
   *
   * 也不调 normalize():浏览器已经在 mousedown 时把光标放到了用户点击的位置,
   * 立刻合并相邻文本节点会让光标所在的节点被吞掉,Selection 失锚,光标塌缩到编辑器开头。
   *
   * @param force - 强制删除（不转换为文字）
   * // SYNC: useMention.quitMentionInput
   */
  const quitSkillInput = useCallback((force = false) => {
    const input = getCurrentSkillInput();
    if (!input) return;

    dissolveChip(input, {
      keepText: !(hasSelectAfterOpen || force),
      restoreCaret: false,
      normalize: false,
    });

    closeSelect();
    setHasSelectAfterOpen(false);
  }, [hasSelectAfterOpen, getCurrentSkillInput, closeSelect]);

  /**
   * 主动取消 / 输入态（键盘触发，必须恢复光标）
   *
   * @param toText - true: chip 还原成普通 "/" 文字，光标停在它后面（Esc）
   *                 false: 整块删除，光标回到 chip 原来的位置（删掉 / 触发符）
   * @returns 是否真的处理了（编辑器里没有 skill-input 时返回 false）
   * // SYNC: useMention.cancelMentionInput
   */
  const cancelSkillInput = useCallback((toText: boolean): boolean => {
    const input = getCurrentSkillInput();
    if (!input) return false;

    dissolveChip(input, { keepText: toText, restoreCaret: true });

    closeSelect();
    setHasSelectAfterOpen(false);
    // chip 内的文字原本被 getPureText 当作 mention 块跳过,
    // 溶解成普通文字/删除后内容变了,必须同步一次 onChange。
    onInput?.();
    // 焦点要拉回编辑器:下拉弹窗的搜索框在被卸载前抢走了 focus,
    // 不主动 focus 回去,用户后续按键(包括再次输入 /)都进不来。
    // 用 queueMicrotask 而不是 setTimeout(0):微任务在当前同步代码块结束
    // 后立即 flush,比 React 下一次 commit 早一步,焦点回拉更紧凑;
    // 且浏览器会把失败的焦点切换(目标已 detach)抛到 microtask 队列,
    // 比 setTimeout 多一层错误兜底。
    if (focusEditor) {
      queueMicrotask(() => focusEditor());
    }
    return true;
  }, [getCurrentSkillInput, closeSelect, onInput, focusEditor]);

  /**
   * 检查并转换无效的 skill-input
   *
   * 两种"无效"情况都在这里收口:
   * - 内容被删空（用户 Backspace 删掉了 /）→ 整块删除
   * - 内容不再以 / 开头 → 还原成普通文字
   *
   * 必须走 dissolveChip 恢复光标:原实现 `input.replaceWith(空文本节点)` 会让
   * Selection 失去锚点,浏览器把光标塌缩到编辑器开头 —— 即"删除 / 后光标出现在 / 前面"。
   * // SYNC: useMention.checkAndConvertInput
   */
  const checkAndConvertInput = useCallback(() => {
    const input = getCurrentSkillInput();
    if (!input) {
      closeSelect();
      return;
    }

    const text = input.textContent || '';
    if (!text.startsWith(triggerCode)) {
      dissolveChip(input, { keepText: true, restoreCaret: true });
      closeSelect();
    }
  }, [triggerCode, getCurrentSkillInput, closeSelect]);

  /**
   * 处理搜索
   * // SYNC: useMention.handleSearch
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

    // 同样传 cursor={editor, 0},强制 prepend 到最前(对齐 selectSkill 的语义)
    if (onInsertInput) {
      (onInsertInput as any)(skillTag, { element: editorRef.current, cursorPos: 0 });
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
   * // SYNC: useMention.handleInputCheck
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
      // 位置限制:领导要求 / 只能在「逻辑开头」触发。
      // 用户刚刚敲入 / 时,光标在 / 之后;所以检查的是「/ 字符所在位置之前」
      // (即 cursorPos - 1)是否全是惰性。光标前有真内容 → / 当普通字符保留,不弹窗。
      // Q4 优先:如果前面只有 [skill-tag] / [mention-link] 这类惰性 chip,
      // isCursorAtLogicalStart 仍返回 true,允许再次输入 / 触发新选择(用户语义是「替换上一个技能」)。
      if (!isCursorAtLogicalStart({ element: cursor.element, cursorPos: cursor.cursorPos - 1 })) {
        return;
      }
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
      // 必须把 cursor 透传出去,否则 activateSkillInput 的 onInsertInput 收到 undefined,
      // 内部 insertNode 走 appendOrBeforeBR 分支,chip 被 append 到编辑器末尾。
      // 表现:用户在文本中间输入 / 触发时,chip 跑到最后面,光标跟着跳过去。
      activateSkillInput(getCursor() || undefined);
    }
  }, [enabled, triggerCode, findSkillInput, getCurrentSkillInput, activateSkillInput, handleSearch]);

  /**
   * 处理键盘导航
   *
   * Esc / Backspace 的判定用 getCurrentSkillInput()(编辑器内查询)而不是
   * findSkillInput()(基于光标向上找):点技能按钮进入输入态时光标可能不在 chip 内,
   * 用光标判定会漏掉。方向键/回车仍沿用原来的光标判定,避免行为变化。
   * // SYNC: useMention.handleKeyDown
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent): boolean => {
    const skillInput = getCurrentSkillInput();
    if (!skillInput) return false;

    // Esc:取消 / 技能选择状态,chip 还原成一个普通的 "/" 字符,光标停在它后面
    if (event.key === 'Escape') {
      event.preventDefault();
      // 阻止冒泡,避免顺带关掉外层 Modal/Drawer
      event.stopPropagation();
      cancelSkillInput(true);
      return true;
    }

    // Backspace:chip 内只剩触发符时整块删除,并把光标放回 chip 原来的位置。
    // 交给浏览器处理会留下一个空 span,后续清理时 Selection 失锚,
    // 光标会被塌缩到编辑器开头(表现为跑到 / 前面)。
    if (event.key === 'Backspace') {
      const cursor = getCursor();
      const inputAtCursor = cursor?.element ? findSkillInput(cursor.element) : null;
      const isCollapsed = cursor?.range ? cursor.range.collapsed : true;
      if (
        inputAtCursor === skillInput &&
        isCollapsed &&
        (cursor?.cursorPos ?? 0) > 0 &&
        (skillInput.textContent || '') === triggerCode
      ) {
        event.preventDefault();
        cancelSkillInput(false);
        return true;
      }
    }

    if (!canShowSelect) return false;
    if (!findSkillInput()) return false;

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

    return false;
  }, [
    canShowSelect,
    triggerCode,
    getCurrentSkillInput,
    findSkillInput,
    filteredSuggestions,
    selectedIndex,
    selectSkill,
    cancelSkillInput,
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
    cancelSkillInput,
    checkAndConvertInput,
    hasSelectAfterOpen,
    moveCursorToLogicalStart,
  };
};