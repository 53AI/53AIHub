/**
 * 划词高亮插件
 * 支持自动段落识别和手动划词高亮
 * 兼容 Vue 和 React
 */

(function (global) {
  'use strict';

  // 全局菜单管理，避免多个实例同时显示菜单
  const globalMenuManager = {
    activeMenus: new Set(),
    hideAllMenus() {
      this.activeMenus.forEach(highlighter => {
        if (highlighter && highlighter.state && highlighter.state.menuElement) {
          highlighter.state.menuElement.style.display = 'none';
        }
      });
      this.activeMenus.clear();
    },
    registerMenu(highlighter) {
      this.hideAllMenus();
      this.activeMenus.add(highlighter);
    },
    unregisterMenu(highlighter) {
      this.activeMenus.delete(highlighter);
    }
  };

  /**
   * 高亮器类
   */
  class TextHighlighter {
    constructor(options = {}) {
      // 配置选项
      this.options = {
        // 目标容器（必需）
        container: options.container || null,
        // 菜单项配置
        menuItems: options.menuItems || [],
        // 高亮样式类名
        highlightClass: options.highlightClass || 'text-highlight',
        // 自动高亮样式类名
        autoHighlightClass: options.autoHighlightClass || 'text-auto-highlight',
        // 是否启用自动段落识别
        enableAutoHighlight: options.enableAutoHighlight !== false,
        // 是否启用手动划词
        enableManualHighlight: options.enableManualHighlight !== false,
        // 强制使用虚拟高亮模式（不修改 DOM，适用于复杂结构如 Markdown）
        forceVirtualMode: options.forceVirtualMode || false,
        // 限制划词区域的选择器
        restrictSelector: options.restrictSelector || null,
        // 菜单位置偏移
        menuOffset: options.menuOffset || { x: 0, y: 4 },
        // 菜单类名
        menuClass: options.menuClass || 'highlight-menu',
        // 回调函数
        onHighlight: options.onHighlight || null,
        onMenuClick: options.onMenuClick || null,
        // 选择变化回调（用于传递手动划词事件）
        onSelectionChange: options.onSelectionChange || null,
        // 是否自动通过 postMessage 传递事件（在 iframe 中时）
        autoPostMessage: options.autoPostMessage !== false,
        ...options
      };

      // 状态管理
      this.state = {
        currentAutoHighlight: null,
        currentManualHighlight: null,
        currentManualHighlights: [], // 保存所有手动高亮元素（跨标签时可能有多个）
        menuElement: null,
        isSelecting: false,
        paragraphs: []
      };

      // 鼠标位置跟踪
      this.lastMouseX = 0;
      this.lastMouseY = 0;

      // 绑定方法上下文
      this.handleParagraphEnter = this.handleParagraphEnter.bind(this);
      this.handleParagraphLeave = this.handleParagraphLeave.bind(this);
      this.handleMouseOver = this.handleMouseOver.bind(this);
      this.handleMouseOut = this.handleMouseOut.bind(this);
      this.handleContainerMouseOver = this.handleContainerMouseOver.bind(this);
      this.handleContainerMouseOut = this.handleContainerMouseOut.bind(this);
      this.handleMouseUp = this.handleMouseUp.bind(this);
      this.handleSelectionChange = this.handleSelectionChange.bind(this);
      this.handleClickOutside = this.handleClickOutside.bind(this);
      this.handleMouseMove = (e) => {
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      };

      // 防抖定时器
      this.clearHighlightTimer = null;
      this.highlightTimer = null;
      this.enterTimer = null;

      // 初始化
      this.init();
    }

    /**
     * 初始化
     */
    init() {
      if (!this.options.container) {
        console.error('TextHighlighter: container is required');
        return;
      }

      const container = typeof this.options.container === 'string'
        ? document.querySelector(this.options.container)
        : this.options.container;

      if (!container) {
        console.error('TextHighlighter: container element not found');
        return;
      }

      this.container = container;
      this.setupEventListeners();
      this.identifyParagraphs();
    }

    /**
     * 识别段落
     */
    identifyParagraphs() {
      const restrictElement = this.options.restrictSelector
        ? this.container.querySelector(this.options.restrictSelector)
        : this.container;

      if (!restrictElement) return;

      // 查找所有段落元素
      const paragraphSelectors = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'];
      const allElements = restrictElement.querySelectorAll(paragraphSelectors.join(', '));

      this.state.paragraphs = Array.from(allElements).filter(el => {
        // 过滤掉空元素和已经包含高亮的元素
        const text = el.textContent.trim();
        // 排除菜单元素本身
        if (el.classList.contains(this.options.menuClass)) return false;
        // 排除已经是高亮元素的子元素
        if (el.closest(`.${this.options.highlightClass}`)) return false;
        return text.length > 0 && !el.querySelector(`.${this.options.highlightClass}`);
      });

      this.updateAutoSelectEnabled(this.options.enableAutoHighlight);
    }

    /**
     * 设置事件监听
     */
    setupEventListeners() {
      this.updateManualSelectEnabled(this.options.enableManualHighlight);

      // 跟踪鼠标位置
      document.addEventListener('mousemove', this.handleMouseMove);

      // 点击外部关闭菜单
      document.addEventListener('click', this.handleClickOutside, true);
    }


    /**
     * 处理段落鼠标进入（直接绑定，更稳定）
     */
    handleParagraphEnter(e) {
      // 如果已经有手动高亮，阻止自动高亮
      if (this.state.currentManualHighlight) {
        return;
      }

      // 如果正在选择文本，清除之前的手动高亮，允许新的操作
      if (this.state.isSelecting) {
        this.clearManualHighlight();
        return;
      }

      const paragraph = e.currentTarget;

      // 如果已经在高亮这个段落，不重复处理
      if (this.state.currentAutoHighlight === paragraph) return;

      // 检查段落是否在限制区域内（如果有设置限制选择器）
      if (this.options.restrictSelector) {
        const restrictElement = this.container.querySelector(this.options.restrictSelector);
        if (restrictElement && !restrictElement.contains(paragraph)) {
          return; // 不在限制区域内，不处理
        }
      }

      // 清除之前的进入定时器
      if (this.enterTimer) {
        clearTimeout(this.enterTimer);
        this.enterTimer = null;
      }

      // 立即清除之前的高亮
      this.clearAutoHighlight();

      // 立即添加高亮
      this.highlightParagraph(paragraph);
      this.state.currentAutoHighlight = paragraph;

      // 显示菜单
      this.showMenu(paragraph, e);
    }

    /**
     * 处理段落鼠标离开（直接绑定，更稳定）
     */
    handleParagraphLeave(e) {
      const paragraph = e.currentTarget;
      const relatedTarget = e.relatedTarget;

      // 如果移到了菜单上，不清除
      if (this.state.menuElement && relatedTarget && this.state.menuElement.contains(relatedTarget)) {
        return;
      }

      // 如果还在段落内（移到了子元素），不清除
      if (relatedTarget && paragraph.contains(relatedTarget)) {
        return;
      }

      // 延迟清除，避免快速移动时闪烁
      this.scheduleClearHighlight();
    }

    /**
     * 处理容器鼠标悬停（事件委托，保留作为备用）
     */
    handleContainerMouseOver(e) {
      if (this.state.isSelecting) return;

      // 查找最近的段落元素
      const paragraph = this.findParagraphElement(e.target);
      if (!paragraph) return;

      // 如果已经在高亮这个段落，不重复处理
      if (this.state.currentAutoHighlight === paragraph) return;

      // 清除之前的定时器
      if (this.highlightTimer) {
        clearTimeout(this.highlightTimer);
        this.highlightTimer = null;
      }

      // 立即清除之前的高亮
      this.clearAutoHighlight();

      // 立即添加高亮（移除延迟，提升响应速度）
      this.highlightParagraph(paragraph);
      this.state.currentAutoHighlight = paragraph;

      // 显示菜单
      this.showMenu(paragraph, e);
    }

    /**
     * 处理容器鼠标离开（事件委托，保留作为备用）
     */
    handleContainerMouseOut(e) {
      // 检查是否真的离开了段落区域
      const relatedTarget = e.relatedTarget;
      if (!relatedTarget) {
        // 鼠标移出窗口
        this.scheduleClearHighlight();
        return;
      }

      // 查找相关目标是否还在段落内
      const paragraph = this.findParagraphElement(e.target);
      if (!paragraph) {
        this.scheduleClearHighlight();
        return;
      }

      // 检查相关目标是否还在同一个段落或其子元素中
      if (paragraph.contains(relatedTarget) || relatedTarget === paragraph) {
        return; // 还在段落内，不清除
      }

      // 检查是否移到了菜单上
      if (this.state.menuElement && this.state.menuElement.contains(relatedTarget)) {
        return; // 移到了菜单上，不清除
      }

      // 延迟清除，避免快速移动时闪烁
      this.scheduleClearHighlight();
    }

    /**
     * 查找段落元素
     */
    findParagraphElement(element) {
      if (!element) return null;

      // 检查元素本身是否是段落
      const paragraphSelectors = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'];
      const tagName = element.tagName ? element.tagName.toLowerCase() : '';

      if (paragraphSelectors.includes(tagName)) {
        // 检查是否在段落列表中
        if (this.state.paragraphs.includes(element)) {
          return element;
        }
      }

      // 向上查找段落元素
      let current = element.parentElement;
      while (current && current !== this.container) {
        const currentTag = current.tagName ? current.tagName.toLowerCase() : '';
        if (paragraphSelectors.includes(currentTag)) {
          if (this.state.paragraphs.includes(current)) {
            return current;
          }
        }
        current = current.parentElement;
      }

      return null;
    }

    /**
     * 安排清除高亮（带防抖）
     */
    scheduleClearHighlight() {
      // 清除之前的定时器
      if (this.clearHighlightTimer) {
        clearTimeout(this.clearHighlightTimer);
      }

      // 延迟清除，避免快速移动时闪烁
      this.clearHighlightTimer = setTimeout(() => {
        // 再次检查鼠标是否在菜单上
        if (!this.isMouseOverMenu() && !this.isMouseOverCurrentParagraph()) {
          this.clearAutoHighlight();
        }
        this.clearHighlightTimer = null;
      }, 100);
    }

    /**
     * 检查鼠标是否在当前段落上
     */
    isMouseOverCurrentParagraph() {
      if (!this.state.currentAutoHighlight) return false;
      const rect = this.state.currentAutoHighlight.getBoundingClientRect();
      const mouseX = this.lastMouseX || 0;
      const mouseY = this.lastMouseY || 0;
      return (
        mouseX >= rect.left &&
        mouseX <= rect.right &&
        mouseY >= rect.top &&
        mouseY <= rect.bottom
      );
    }

    /**
     * 处理鼠标悬停（保留用于兼容）
     */
    handleMouseOver(e) {
      // 这个方法保留用于向后兼容，但主要使用 handleContainerMouseOver
      this.handleContainerMouseOver(e);
    }

    /**
     * 处理鼠标离开（保留用于兼容）
     */
    handleMouseOut(e) {
      // 这个方法保留用于向后兼容，但主要使用 handleContainerMouseOut
      this.handleContainerMouseOut(e);
    }

    /**
     * 处理鼠标抬起（手动选择）
     */
    handleMouseUp(e) {
      if (!this.options.enableManualHighlight) return;

      // 如果已经有手动高亮，阻止新的选择
      if (this.state.currentManualHighlight) {
        // 清除选择，阻止新选择
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          selection.removeAllRanges();
        }
        return;
      }

      const selection = window.getSelection();
      const selectedText = selection.toString().trim();

      if (selectedText.length === 0) {
        // 如果没有选择文本，重置选择状态
        this.state.isSelecting = false;

        // 检查是否在限制区域内
        if (this.isInRestrictArea(e.target)) {
          return;
        }
        // 清除手动高亮
        this.clearManualHighlight();
        return;
      }

      // 检查是否在限制区域内
      if (!this.isInRestrictArea(e.target)) {
        selection.removeAllRanges();
        this.state.isSelecting = false;
        return;
      }

      // 清除自动高亮和之前的手动高亮
      this.clearAutoHighlight();
      this.clearManualHighlight();

      // 延迟处理，确保选择完成
      setTimeout(() => {
        this.handleManualSelection(selection);
      }, 10);
    }

    /**
     * 发送选择变化事件
     */
    emitSelectionChange(text) {
      const selectedText = text || '';

      // 调用回调函数
      if (this.options.onSelectionChange) {
        this.options.onSelectionChange(selectedText);
      }

      // 如果在 iframe 中且启用了自动 postMessage，发送消息
      if (this.options.autoPostMessage && window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'selection-change',
            text: selectedText
          },
          '*'
        );
      }
    }

    /**
     * 处理选择变化
     */
    handleSelectionChange() {
      // 如果已经有手动高亮，阻止新的选择
      if (this.state.currentManualHighlight) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const selectedText = range.toString().trim();
          // 如果有新选择，清除它
          if (selectedText.length > 0) {
            selection.removeAllRanges();
          }
        }
        return;
      }

      const selection = window.getSelection();
      if (selection.rangeCount === 0) {
        // 选择被清除时，延迟重置状态，避免与 mouseup 冲突
        setTimeout(() => {
          if (selection.rangeCount === 0) {
            this.state.isSelecting = false;
            // 发送空文本事件
            this.emitSelectionChange('');
          }
        }, 50);
        return;
      }

      const range = selection.getRangeAt(0);

      // 检查选择是否在容器内
      if (!this.isSelectionInContainer(range)) {
        this.state.isSelecting = false;
        return;
      }

      const selectedText = range.toString().trim();

      if (selectedText.length > 0) {
        this.state.isSelecting = true;
        // 清除自动高亮和之前的手动高亮
        this.clearAutoHighlight();
        this.clearManualHighlight();
        // 发送选择变化事件
        this.emitSelectionChange(selectedText);
      } else {
        this.state.isSelecting = false;
        // 发送空文本事件
        this.emitSelectionChange('');
      }
    }

    /**
     * 检查选择是否在容器内
     */
    isSelectionInContainer(range) {
      if (!this.options.container) {
        return true; // 如果没有指定容器，默认允许
      }

      const container = range.commonAncestorContainer;
      const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;

      // 检查元素是否在指定容器内
      return this.options.container.contains(element);
    }

    /**
     * 检查选择是否在复杂结构中（如代码块）
     */
    isInComplexStructure(range) {
      const container = range.commonAncestorContainer;
      const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;

      // 检查是否在代码块或其他复杂结构中
      const complexSelectors = [
        '.hljs', // highlight.js 代码高亮
        '.vditor-linenumber', // vditor 行号
        'pre code', // 代码块
        '.language-', // 代码语言标识
        '[class*="hljs-"]' // 任何 hljs 相关的类
      ];

      for (const selector of complexSelectors) {
        if (element.closest(selector)) {
          return true;
        }
      }

      return false;
    }

    /**
     * 处理手动选择
     */
    handleManualSelection(selection) {
      if (selection.rangeCount === 0) {
        this.state.isSelecting = false;
        return;
      }

      const range = selection.getRangeAt(0);

      // 检查选择是否在容器内
      if (!this.isSelectionInContainer(range)) {
        this.state.isSelecting = false;
        return;
      }

      const selectedText = range.toString().trim();

      if (selectedText.length === 0) {
        this.state.isSelecting = false;
        return;
      }

      // 清除之前的手动高亮（已经在 mouseup 中清除，这里确保清除）
      this.clearManualHighlight();

      // 检查是否应该使用虚拟高亮模式
      const isComplex = this.isInComplexStructure(range);
      const shouldUseVirtual = this.options.forceVirtualMode || isComplex;

      if (shouldUseVirtual) {
        // 在复杂结构中，不修改 DOM，只记录选择信息
        this.state.currentManualHighlight = {
          isVirtual: true, // 标记为虚拟高亮（不修改DOM）
          text: selectedText,
          range: range.cloneRange() // 克隆 range 以便后续使用
        };
        this.state.currentManualHighlights = [];

        // 显示菜单
        const rect = range.getBoundingClientRect();
        this.showMenuAtPosition(rect);

        // 触发回调
        if (this.options.onHighlight) {
          this.options.onHighlight({
            type: 'manual',
            text: selectedText,
            element: null,
            range: range,
            isVirtual: true
          });
        }

        // 发送选择变化事件
        this.emitSelectionChange(selectedText);

        // 不清除选择，保持视觉高亮效果
        // selection.removeAllRanges();
        this.state.isSelecting = false;
      } else {
        // 在普通结构中，创建 DOM 高亮
        const highlightElement = this.createHighlight(range);
        if (highlightElement) {
          this.state.currentManualHighlight = highlightElement;

          // 收集所有相关的高亮元素（跨标签时可能有多个）
          const baseId = highlightElement.getAttribute('data-highlight-base-id');
          if (baseId) {
            // 查找所有具有相同 baseId 的高亮元素
            const allHighlights = this.container.querySelectorAll(
              `mark.${this.options.highlightClass}[data-highlight-base-id="${baseId}"]`
            );
            this.state.currentManualHighlights = Array.from(allHighlights);
          } else {
            // 如果没有 baseId，只保存当前高亮元素
            this.state.currentManualHighlights = [highlightElement];
          }

          // 显示菜单
          const rect = range.getBoundingClientRect();
          this.showMenuAtPosition(rect);

          // 触发回调
          if (this.options.onHighlight) {
            this.options.onHighlight({
              type: 'manual',
              text: selectedText,
              element: highlightElement,
              range: range
            });
          }

          // 发送选择变化事件
          this.emitSelectionChange(selectedText);
        }

        // 清除选择并重置状态
        selection.removeAllRanges();
        this.state.isSelecting = false;
      }
    }

    /**
     * 高亮段落
     */
    highlightParagraph(paragraph) {
      paragraph.classList.add(this.options.autoHighlightClass);
    }

    /**
     * 创建高亮元素
     */
    createHighlight(range) {
      try {
        const baseId = Date.now().toString();
        const highlight = document.createElement('mark');
        highlight.className = this.options.highlightClass;
        highlight.setAttribute('data-highlight-id', baseId);
        highlight.setAttribute('data-highlight-base-id', baseId); // 用于标识同一选择的所有高亮

        // 尝试使用 surroundContents（适用于简单情况，不跨标签）
        try {
          range.surroundContents(highlight);
          return highlight;
        } catch (e) {
          // 如果 surroundContents 失败（跨标签情况），使用手动包裹方法
          return this.wrapRangeWithHighlight(range, highlight, baseId);
        }
      } catch (error) {
        console.error('TextHighlighter: Failed to create highlight', error);
        return null;
      }
    }

    /**
     * 手动包裹范围内容（处理跨标签情况）
     */
    wrapRangeWithHighlight(range, highlight, baseId) {
      try {
        // 获取范围内的所有文本节点
        const textNodes = this.getTextNodesInRange(range);
        if (textNodes.length === 0) {
          return null;
        }

        const startContainer = range.startContainer;
        const endContainer = range.endContainer;
        const startOffset = range.startOffset;
        const endOffset = range.endOffset;

        // 如果只有一个文本节点，直接处理
        if (textNodes.length === 1) {
          return this.wrapSingleTextNode(textNodes[0], startContainer, endContainer, startOffset, endOffset, highlight);
        }

        // 多个文本节点的情况（跨标签）
        // 按父元素分组，确保每个父元素内的高亮是独立的
        const parentGroups = new Map();

        for (let i = 0; i < textNodes.length; i++) {
          const textNode = textNodes[i];
          const parent = textNode.parentNode;

          if (!parentGroups.has(parent)) {
            parentGroups.set(parent, []);
          }

          const isFirst = i === 0;
          const isLast = i === textNodes.length - 1;
          const nodeStartOffset = isFirst && textNode === startContainer ? startOffset : 0;
          const nodeEndOffset = isLast && textNode === endContainer ? endOffset : textNode.textContent.length;

          parentGroups.get(parent).push({
            node: textNode,
            startOffset: nodeStartOffset,
            endOffset: nodeEndOffset
          });
        }

        // 为每个父元素创建高亮
        // 按文档顺序处理父元素（确保顺序正确）
        const sortedParentGroups = Array.from(parentGroups.entries()).sort((a, b) => {
          const [parentA] = a;
          const [parentB] = b;
          const position = parentA.compareDocumentPosition(parentB);
          if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
            return -1; // parentA 在 parentB 之前
          } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
            return 1; // parentA 在 parentB 之后
          }
          return 0;
        });

        let firstHighlight = null;
        let highlightIndex = 0;

        sortedParentGroups.forEach(([parent, nodes]) => {
          // 确保节点按文档顺序排序
          nodes.sort((a, b) => {
            const position = a.node.compareDocumentPosition(b.node);
            if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
              return -1; // a 在 b 之前
            } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
              return 1; // a 在 b 之后
            }
            return 0;
          });
          // 为这个父元素创建高亮元素
          const parentHighlight = highlightIndex === 0 ? highlight : document.createElement('mark');
          if (highlightIndex > 0) {
            parentHighlight.className = this.options.highlightClass;
            parentHighlight.setAttribute('data-highlight-id', baseId + '_' + highlightIndex);
            parentHighlight.setAttribute('data-highlight-base-id', baseId); // 使用相同的基础ID
          }

          // 收集需要添加到高亮中的内容（按文档顺序）
          const highlightContents = [];
          let insertBeforeNode = null; // 用于确定高亮元素的插入位置
          let firstBeforeNode = null; // 第一个节点的前面文本节点（如果有）

          // 按文档顺序处理这个父元素内的所有文本节点
          // 从后往前处理DOM操作，避免节点引用失效
          for (let i = nodes.length - 1; i >= 0; i--) {
            const { node: textNode, startOffset: nodeStartOffset, endOffset: nodeEndOffset } = nodes[i];
            const isFirst = i === 0;

            // 如果整个文本节点都被选中
            if (nodeStartOffset === 0 && nodeEndOffset === textNode.textContent.length) {
              // 收集到高亮内容中（按顺序，从前往后）
              highlightContents.unshift({
                type: 'node',
                node: textNode
              });

              // 从DOM中移除
              if (textNode.parentNode === parent) {
                // 如果是第一个节点，记录插入位置
                if (isFirst) {
                  insertBeforeNode = textNode.nextSibling;
                }
                parent.removeChild(textNode);
              }
            } else {
              // 部分选中，需要分割文本节点
              const beforeText = textNode.textContent.substring(0, nodeStartOffset);
              const selectedText = textNode.textContent.substring(nodeStartOffset, nodeEndOffset);
              const afterText = textNode.textContent.substring(nodeEndOffset);

              // 创建后面的文本节点
              if (afterText) {
                const afterNode = document.createTextNode(afterText);
                if (textNode.nextSibling) {
                  parent.insertBefore(afterNode, textNode.nextSibling);
                } else {
                  parent.appendChild(afterNode);
                }
              }

              // 收集选中的文本到高亮内容中（按顺序）
              if (selectedText) {
                highlightContents.unshift({
                  type: 'text',
                  text: selectedText
                });
              }

              // 创建前面的文本节点
              let beforeNode = null;
              if (beforeText) {
                beforeNode = document.createTextNode(beforeText);
                parent.insertBefore(beforeNode, textNode);

                // 如果是第一个节点，记录前面的文本节点和插入位置
                if (isFirst) {
                  firstBeforeNode = beforeNode;
                  insertBeforeNode = textNode; // 插入位置是原始节点（会在移除后变成后面的节点）
                }
              } else if (isFirst) {
                // 第一个节点没有前面的文本，插入位置就是原始节点
                insertBeforeNode = textNode;
              }

              // 移除原始文本节点
              parent.removeChild(textNode);

              // 如果是第一个节点且创建了前面的文本节点，更新插入位置
              if (isFirst && beforeNode) {
                // 插入位置应该是前面的文本节点之后（即原始节点的位置，现在已经被移除）
                // 查找原始节点的下一个兄弟节点（可能是afterNode或原来的nextSibling）
                insertBeforeNode = beforeNode.nextSibling;
              }
            }
          }

          // 如果高亮内容为空，跳过这个父元素
          if (highlightContents.length === 0) {
            // 如果高亮元素已经在DOM中，需要移除它
            if (parentHighlight.parentNode) {
              parentHighlight.parentNode.removeChild(parentHighlight);
            }
            // 如果这是第一个高亮元素，重置它，让下一个父元素使用
            if (highlightIndex === 0) {
              // 重新创建第一个高亮元素
              highlight = document.createElement('mark');
              highlight.className = this.options.highlightClass;
              highlight.setAttribute('data-highlight-id', baseId);
              highlight.setAttribute('data-highlight-base-id', baseId);
            }
            highlightIndex++;
            return;
          }

          // 按顺序将内容添加到高亮中
          highlightContents.forEach(item => {
            if (item.type === 'node') {
              parentHighlight.appendChild(item.node);
            } else if (item.type === 'text') {
              parentHighlight.appendChild(document.createTextNode(item.text));
            }
          });

          // 确保高亮元素有内容（防止空高亮）
          if (parentHighlight.childNodes.length === 0) {
            // 如果高亮元素已经在DOM中，移除它
            if (parentHighlight.parentNode) {
              parentHighlight.parentNode.removeChild(parentHighlight);
            }
            // 如果这是第一个高亮元素，重置它
            if (highlightIndex === 0) {
              highlight = document.createElement('mark');
              highlight.className = this.options.highlightClass;
              highlight.setAttribute('data-highlight-id', baseId);
              highlight.setAttribute('data-highlight-base-id', baseId);
            }
            highlightIndex++;
            return;
          }

          // 将高亮元素插入到正确的位置
          if (parentHighlight.parentNode !== parent) {
            let finalInsertBefore = null;

            // 优先使用之前确定的插入位置
            if (insertBeforeNode && insertBeforeNode.parentNode === parent) {
              finalInsertBefore = insertBeforeNode;
            } else if (firstBeforeNode && firstBeforeNode.parentNode === parent) {
              // 如果有第一个节点的前面文本节点，插入到它之后
              finalInsertBefore = firstBeforeNode.nextSibling;
            } else {
              // 如果找不到，尝试查找第一个节点的位置
              const firstOriginalNode = nodes[0].node;

              // 如果第一个节点还在DOM中（不应该发生，但作为备用）
              if (firstOriginalNode.parentNode === parent) {
                finalInsertBefore = firstOriginalNode;
              } else {
                // 查找第一个创建的文本节点（如果有）
                const firstNodeInfo = nodes[0];
                if (firstNodeInfo.startOffset > 0) {
                  const beforeText = firstNodeInfo.node.textContent.substring(0, firstNodeInfo.startOffset);
                  for (let child = parent.firstChild; child; child = child.nextSibling) {
                    if (child.nodeType === Node.TEXT_NODE && child.textContent === beforeText) {
                      finalInsertBefore = child.nextSibling;
                      break;
                    }
                  }
                }

                if (!finalInsertBefore) {
                  // 如果还是找不到，使用第一个子节点
                  finalInsertBefore = parent.firstChild;
                }
              }
            }

            if (finalInsertBefore) {
              parent.insertBefore(parentHighlight, finalInsertBefore);
            } else {
              // 如果还是找不到，追加到父元素末尾
              parent.appendChild(parentHighlight);
            }
          }

          // 规范化高亮元素
          parentHighlight.normalize();

          if (highlightIndex === 0) {
            firstHighlight = parentHighlight;
          }

          highlightIndex++;
        });

        return firstHighlight || highlight;
      } catch (error) {
        console.error('TextHighlighter: Failed to wrap range with highlight', error);
        // 如果上面的方法失败，尝试更复杂的方法
        return this.wrapRangeWithHighlightComplex(range, highlight);
      }
    }

    /**
     * 包裹单个文本节点
     */
    wrapSingleTextNode(textNode, startContainer, endContainer, startOffset, endOffset, highlight) {
      const nodeStartOffset = textNode === startContainer ? startOffset : 0;
      const nodeEndOffset = textNode === endContainer ? endOffset : textNode.textContent.length;

      if (nodeStartOffset === 0 && nodeEndOffset === textNode.textContent.length) {
        // 包裹整个文本节点
        const parent = textNode.parentNode;
        parent.replaceChild(highlight, textNode);
        highlight.appendChild(textNode);
      } else {
        // 分割文本节点
        const beforeText = textNode.textContent.substring(0, nodeStartOffset);
        const selectedText = textNode.textContent.substring(nodeStartOffset, nodeEndOffset);
        const afterText = textNode.textContent.substring(nodeEndOffset);
        const parent = textNode.parentNode;

        // 创建前面的文本节点
        if (beforeText) {
          parent.insertBefore(document.createTextNode(beforeText), textNode);
        }

        // 创建高亮节点
        const selectedTextNode = document.createTextNode(selectedText);
        highlight.appendChild(selectedTextNode);
        parent.insertBefore(highlight, textNode);

        // 创建后面的文本节点
        if (afterText) {
          parent.insertBefore(document.createTextNode(afterText), textNode);
        }

        // 移除原始文本节点
        parent.removeChild(textNode);
      }

      return highlight;
    }

    /**
     * 复杂的手动包裹方法（备用方案）
     */
    wrapRangeWithHighlightComplex(range, highlight) {
      try {
        // 获取范围内的所有文本节点
        const textNodes = this.getTextNodesInRange(range);
        if (textNodes.length === 0) {
          return null;
        }

        const startContainer = range.startContainer;
        const endContainer = range.endContainer;
        const startOffset = range.startOffset;
        const endOffset = range.endOffset;

        // 如果只有一个文本节点
        if (textNodes.length === 1) {
          const textNode = textNodes[0];
          const nodeStartOffset = textNode === startContainer ? startOffset : 0;
          const nodeEndOffset = textNode === endContainer ? endOffset : textNode.textContent.length;

          if (nodeStartOffset === 0 && nodeEndOffset === textNode.textContent.length) {
            // 包裹整个文本节点
            const parent = textNode.parentNode;
            parent.replaceChild(highlight, textNode);
            highlight.appendChild(textNode);
          } else {
            // 分割文本节点
            const beforeText = textNode.textContent.substring(0, nodeStartOffset);
            const selectedText = textNode.textContent.substring(nodeStartOffset, nodeEndOffset);
            const afterText = textNode.textContent.substring(nodeEndOffset);
            const parent = textNode.parentNode;

            // 创建前面的文本节点
            if (beforeText) {
              parent.insertBefore(document.createTextNode(beforeText), textNode);
            }

            // 创建高亮节点
            const selectedTextNode = document.createTextNode(selectedText);
            highlight.appendChild(selectedTextNode);
            parent.insertBefore(highlight, textNode);

            // 创建后面的文本节点
            if (afterText) {
              parent.insertBefore(document.createTextNode(afterText), textNode);
            }

            // 移除原始文本节点
            parent.removeChild(textNode);
          }

          return highlight;
        }

        // 多个文本节点的情况（跨标签）
        // 从后往前处理，避免 DOM 操作导致节点引用失效
        const firstNode = textNodes[0];
        const lastNode = textNodes[textNodes.length - 1];
        const firstStartOffset = firstNode === startContainer ? startOffset : 0;
        const lastEndOffset = lastNode === endContainer ? endOffset : lastNode.textContent.length;

        // 先处理最后一个节点（从后往前，避免引用失效）
        if (textNodes.length > 1) {
          if (lastEndOffset < lastNode.textContent.length) {
            const selectedText = lastNode.textContent.substring(0, lastEndOffset);
            const afterText = lastNode.textContent.substring(lastEndOffset);
            const parent = lastNode.parentNode;

            const selectedTextNode = document.createTextNode(selectedText);
            highlight.appendChild(selectedTextNode);

            if (afterText) {
              parent.insertBefore(document.createTextNode(afterText), lastNode);
            }

            parent.removeChild(lastNode);
          } else {
            // 包裹整个最后一个节点
            const parent = lastNode.parentNode;
            parent.removeChild(lastNode);
            highlight.appendChild(lastNode);
          }
        }

        // 处理中间的所有完整节点（从后往前）
        for (let i = textNodes.length - 2; i > 0; i--) {
          const node = textNodes[i];
          // 检查节点是否还在 DOM 中（可能已经被之前的操作移动）
          if (node.parentNode && node.parentNode !== highlight) {
            const parent = node.parentNode;
            parent.removeChild(node);
            // 插入到 highlight 的开头（因为是从后往前处理）
            highlight.insertBefore(node, highlight.firstChild);
          }
        }

        // 最后处理第一个节点
        if (firstStartOffset > 0) {
          const beforeText = firstNode.textContent.substring(0, firstStartOffset);
          const selectedText = firstNode.textContent.substring(firstStartOffset);
          const parent = firstNode.parentNode;

          if (beforeText) {
            parent.insertBefore(document.createTextNode(beforeText), firstNode);
          }

          const selectedTextNode = document.createTextNode(selectedText);
          highlight.insertBefore(selectedTextNode, highlight.firstChild);
          parent.insertBefore(highlight, firstNode);
          parent.removeChild(firstNode);
        } else {
          // 包裹整个第一个节点
          const parent = firstNode.parentNode;
          parent.removeChild(firstNode);
          highlight.insertBefore(firstNode, highlight.firstChild);
        }

        // 规范化：合并相邻的文本节点
        highlight.normalize();

        return highlight;
      } catch (error) {
        console.error('TextHighlighter: Failed to wrap range with highlight (complex)', error);
        return null;
      }
    }

    /**
     * 获取范围内的所有文本节点
     */
    getTextNodesInRange(range) {
      const textNodes = [];
      const startContainer = range.startContainer;
      const endContainer = range.endContainer;

      // 如果开始和结束是同一个文本节点
      if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
        return [startContainer];
      }

      // 使用 TreeWalker 遍历共同祖先下的所有文本节点
      const commonAncestor = range.commonAncestorContainer;
      const walker = document.createTreeWalker(
        commonAncestor,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node;
      while (node = walker.nextNode()) {
        // 检查节点是否在范围内
        if (node === startContainer && node === endContainer) {
          // 同一个节点
          textNodes.push(node);
        } else if (node === startContainer) {
          // 是开始节点
          textNodes.push(node);
        } else if (node === endContainer) {
          // 是结束节点
          textNodes.push(node);
        } else {
          // 检查节点是否在开始和结束之间
          // 使用 Range 比较来判断
          const nodeRange = document.createRange();
          try {
            nodeRange.selectNodeContents(node);
            const startComparison = range.compareBoundaryPoints(Range.START_TO_START, nodeRange);
            const endComparison = range.compareBoundaryPoints(Range.END_TO_END, nodeRange);

            // 节点完全在范围内（开始<=节点开始 且 结束>=节点结束）
            // 或者范围完全在节点内（开始>节点开始 且 结束<节点结束）
            // 或者有部分交集
            if (startComparison <= 0 && endComparison >= 0) {
              // 节点完全在范围内
              textNodes.push(node);
            } else if (startComparison > 0 && endComparison < 0) {
              // 范围完全在节点内（部分选择）
              textNodes.push(node);
            } else if (startComparison > 0 && endComparison > 0) {
              // 检查是否有交集：范围的开始是否在节点结束之前
              const startToEnd = range.compareBoundaryPoints(Range.START_TO_END, nodeRange);
              if (startToEnd < 0) {
                textNodes.push(node);
              }
            } else if (startComparison < 0 && endComparison < 0) {
              // 检查是否有交集：范围的结束是否在节点开始之后
              const endToStart = range.compareBoundaryPoints(Range.END_TO_START, nodeRange);
              if (endToStart > 0) {
                textNodes.push(node);
              }
            }
          } catch (e) {
            // 如果选择失败，使用 intersectsNode（如果支持）
            if (range.intersectsNode && range.intersectsNode(node)) {
              textNodes.push(node);
            }
          }
        }
      }

      return textNodes;
    }

    /**
     * 清除自动高亮
     */
    clearAutoHighlight() {
      if (this.state.currentAutoHighlight) {
        this.state.currentAutoHighlight.classList.remove(this.options.autoHighlightClass);
        this.state.currentAutoHighlight = null;
      }
      this.hideMenu();
    }

    /**
     * 清除手动高亮
     */
    clearManualHighlight() {
      if (!this.state.currentManualHighlight) {
        return;
      }

      // 如果是虚拟高亮（在复杂结构中），只需清除选择
      if (this.state.currentManualHighlight.isVirtual) {
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
        }
        this.state.currentManualHighlight = null;
        this.state.currentManualHighlights = [];
        this.hideMenu();
        this.emitSelectionChange('');
        return;
      }

      // 清除所有手动高亮元素
      const highlightsToClear = this.state.currentManualHighlights.length > 0
        ? this.state.currentManualHighlights
        : [this.state.currentManualHighlight];

      if (highlightsToClear.length === 0) {
        return;
      }

      // 按文档顺序排序高亮元素（从后往前清除，避免DOM操作导致引用失效）
      const sortedHighlights = highlightsToClear.slice().sort((a, b) => {
        const position = a.compareDocumentPosition(b);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          return 1; // a 在 b 之后
        } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
          return -1; // a 在 b 之前
        }
        return 0;
      });

      // 收集所有受影响的父元素，用于后续规范化
      const affectedParents = new Set();

      // 从后往前清除，避免DOM操作导致引用失效
      for (let i = sortedHighlights.length - 1; i >= 0; i--) {
        const highlightElement = sortedHighlights[i];
        if (highlightElement && highlightElement.parentNode) {
          const parent = highlightElement.parentNode;
          affectedParents.add(parent);

          // 将高亮内容移回父节点
          const contents = Array.from(highlightElement.childNodes);
          contents.forEach(node => {
            parent.insertBefore(node, highlightElement);
          });

          // 移除高亮元素
          parent.removeChild(highlightElement);
        }
      }

      // 对所有受影响的父元素进行规范化，合并相邻的文本节点
      affectedParents.forEach(parent => {
        this.normalizeTextNodes(parent);
      });

      this.state.currentManualHighlight = null;
      this.state.currentManualHighlights = [];
      this.hideMenu();
      // 发送空文本事件，表示选择已清除
      this.emitSelectionChange('');
    }

    /**
     * 规范化文本节点，合并相邻的文本节点
     */
    normalizeTextNodes(element) {
      if (!element) return;

      // 使用 normalize() 方法合并相邻的文本节点（浏览器原生方法）
      element.normalize();

      // 递归处理所有子元素
      const children = Array.from(element.childNodes);
      children.forEach(child => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          this.normalizeTextNodes(child);
        }
      });
    }

    /**
     * 显示菜单
     */
    showMenu(element, event) {
      const rect = element.getBoundingClientRect();
      this.showMenuAtPosition(rect, event);
    }

    /**
     * 在指定位置显示菜单
     */
    showMenuAtPosition(rect, event) {
      if (!this.options.menuItems || this.options.menuItems.length === 0) {
        return;
      }

      // 先隐藏所有其他菜单
      globalMenuManager.hideAllMenus();

      // 创建或获取菜单元素
      if (!this.state.menuElement) {
        this.createMenu();
      }

      const menu = this.state.menuElement;
      if (!menu) return;

      // 计算菜单位置
      const viewportHeight = window.innerHeight;
      const menuHeight = menu.offsetHeight || 50; // 估算高度
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      let top, left;

      // 决定菜单显示在上方还是下方
      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
        // 显示在上方
        top = rect.top - menuHeight - this.options.menuOffset.y;
      } else {
        // 显示在下方
        top = rect.bottom + this.options.menuOffset.y;
      }

      // 水平居中
      left = rect.left + (rect.width / 2) - (menu.offsetWidth / 2) + this.options.menuOffset.x;

      // 确保菜单不超出视口
      const maxLeft = window.innerWidth - menu.offsetWidth - 10;
      const minLeft = 10;
      left = Math.max(minLeft, Math.min(maxLeft, left));

      // 应用位置
      menu.style.position = 'fixed';
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.display = 'flex';
      menu.style.zIndex = '10000';

      // 添加到body（如果还没有）
      if (!menu.parentNode) {
        document.body.appendChild(menu);
      }

      // 调整下拉菜单的位置，确保不超出视口
      const dropdownMenu = menu.querySelector('.dropdown-menu');
      if (dropdownMenu) {
        const adjustDropdownPosition = () => {
          const menuRect = menu.getBoundingClientRect();
          const dropdownRect = dropdownMenu.getBoundingClientRect();
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

          // 如果下拉菜单超出右边界，调整位置
          if (dropdownRect.right > viewportWidth - 10) {
            const overflow = dropdownRect.right - viewportWidth + 10;
            dropdownMenu.style.right = '0';
            dropdownMenu.style.left = 'auto';
            dropdownMenu.style.transform = `translateX(-${overflow}px)`;
          } else {
            dropdownMenu.style.transform = '';
          }

          // 如果下拉菜单超出下边界，显示在上方
          if (menuRect.bottom + dropdownRect.height > viewportHeight - 10) {
            dropdownMenu.style.top = 'auto';
            dropdownMenu.style.bottom = '100%';
            dropdownMenu.style.marginTop = '0';
            dropdownMenu.style.marginBottom = '4px';
          } else {
            dropdownMenu.style.top = 'calc(100% + 4px)';
            dropdownMenu.style.bottom = 'auto';
            dropdownMenu.style.marginTop = '';
            dropdownMenu.style.marginBottom = '';
          }
        };

        // 监听下拉菜单显示时调整位置
        const observer = new MutationObserver(() => {
          if (dropdownMenu.classList.contains('visible')) {
            requestAnimationFrame(adjustDropdownPosition);
          }
        });
        observer.observe(dropdownMenu, {
          attributes: true,
          attributeFilter: ['class']
        });
      }

      // 注册到全局菜单管理器
      globalMenuManager.registerMenu(this);
    }

    /**
     * 创建菜单
     */
    createMenu() {
      const menu = document.createElement('div');
      menu.className = this.options.menuClass;

      // 创建菜单项按钮的辅助函数
      // @param {Object} item - 菜单项数据
      // @param {Number} index - 菜单项索引
      // @param {Boolean} isMainMenu - 是否为主菜单（主菜单需要文字截断）
      const createMenuItemButton = (item, index, isMainMenu = false) => {
        const menuItem = document.createElement('button');
        menuItem.className = `${this.options.menuClass}-item`;

        const displayText = item.label || item.text || `选项 ${index + 1}`;
        const logoHtml = item.logo ? `<img class="icon" src="${item.logo}"></img>` : '';

        // 主菜单的文字需要包在span中以便CSS截断
        if (isMainMenu) {
          menuItem.innerHTML = `${logoHtml}<span class="button-text">${displayText}</span>`;
        } else {
          menuItem.innerHTML = `${logoHtml}${displayText}`;
        }

        // 点击事件
        menuItem.addEventListener('click', (e) => {
          e.stopPropagation();
          this.handleMenuClick(item, index);
          // 点击后关闭下拉菜单
          const dropdownMenu = menu.querySelector('.dropdown-menu');
          if (dropdownMenu) {
            dropdownMenu.classList.remove('visible');
          }
        });

        return menuItem;
      };

      // 计算需要显示的菜单项数量（最多4个）
      const maxVisibleItems = 4;
      const maxDropdownItems = 10; // 下拉菜单最多显示10个
      const visibleItems = this.options.menuItems.slice(0, maxVisibleItems);
      const hiddenItems = this.options.menuItems.slice(maxVisibleItems);

      // 添加可见的菜单项（主菜单文字需要截断）
      visibleItems.forEach((item, index) => {
        const menuItem = createMenuItemButton(item, index, true); // 主菜单需要截断文字
        menu.appendChild(menuItem);
      });

      // 如果有隐藏的菜单项，创建下拉按钮和下拉菜单
      if (hiddenItems.length > 0) {
        const dropdownToggle = document.createElement('button');
        dropdownToggle.type = 'button';
        dropdownToggle.className = `${this.options.menuClass}-item dropdown-toggle`;
        dropdownToggle.innerHTML = '<svg class="icon" viewBox="0 0 16 16" fill="currentColor" style="width: 16px; height: 16px; display: block;"><path d="M3 6l5 5 5-5z"/></svg>';

        dropdownToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const dropdownMenu = dropdownToggle.querySelector('.dropdown-menu');
          if (dropdownMenu) {
            dropdownMenu.classList.toggle('visible');
          }
        });

        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'dropdown-menu';

        // 下拉菜单最多显示10个菜单项，文字不截断
        const dropdownItems = hiddenItems;
        dropdownItems.forEach((item, index) => {
          const menuItem = createMenuItemButton(item, maxVisibleItems + index, false); // 下拉菜单不需要截断文字
          dropdownMenu.appendChild(menuItem);
        });

        dropdownToggle.appendChild(dropdownMenu);
        menu.appendChild(dropdownToggle);

        // 点击外部时关闭下拉菜单
        let handleClickOutside = null;
        dropdownToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const isVisible = dropdownMenu.classList.contains('visible');

          // 如果之前有监听器，先移除
          if (handleClickOutside) {
            document.removeEventListener('click', handleClickOutside);
          }

          if (!isVisible) {
            // 打开下拉菜单时，添加外部点击监听
            handleClickOutside = (event) => {
              if (!menu.contains(event.target)) {
                dropdownMenu.classList.remove('visible');
                document.removeEventListener('click', handleClickOutside);
                handleClickOutside = null;
              }
            };
            setTimeout(() => {
              document.addEventListener('click', handleClickOutside);
            }, 0);
          } else {
            handleClickOutside = null;
          }
        });
      }

      this.state.menuElement = menu;
    }

    /**
     * 处理菜单点击
     */
    handleMenuClick(item, index) {
      const highlightInfo = this.getCurrentHighlightInfo();

      if (this.options.onMenuClick) {
        this.options.onMenuClick({
          item: item,
          index: index,
          highlight: highlightInfo
        });
      }

      // 如果菜单项有handler，执行它
      if (item.handler && typeof item.handler === 'function') {
        item.handler(highlightInfo);
      }

      // 如果菜单项有action，执行它
      if (item.action && typeof item.action === 'function') {
        item.action(highlightInfo);
      }

      // 菜单点击后，清除所有高亮，允许继续选择
      this.clearAutoHighlight();
      this.clearManualHighlight();
      this.state.isSelecting = false;
    }

    /**
     * 获取当前高亮信息
     */
    getCurrentHighlightInfo() {
      const isAuto = !!this.state.currentAutoHighlight;
      const isManual = !!this.state.currentManualHighlight;

      if (isAuto) {
        return {
          type: 'auto',
          element: this.state.currentAutoHighlight,
          text: this.state.currentAutoHighlight.textContent.trim()
        };
      }

      if (isManual) {
        // 检查是否是虚拟高亮（在复杂结构如代码块中）
        if (this.state.currentManualHighlight.isVirtual) {
          return {
            type: 'manual',
            element: null,
            elements: [],
            text: this.state.currentManualHighlight.text,
            isVirtual: true,
            range: this.state.currentManualHighlight.range
          };
        }

        // 如果有多个高亮元素（跨标签情况），合并所有元素的文本
        let text = '';
        if (this.state.currentManualHighlights.length > 0) {
          text = this.state.currentManualHighlights
            .map(el => el.textContent)
            .join('')
            .trim();
        } else {
          text = this.state.currentManualHighlight.textContent.trim();
        }

        return {
          type: 'manual',
          element: this.state.currentManualHighlight,
          elements: this.state.currentManualHighlights, // 添加所有高亮元素的引用
          text: text
        };
      }

      return null;
    }

    /**
     * 隐藏菜单
     */
    hideMenu() {
      if (this.state.menuElement) {
        this.state.menuElement.style.display = 'none';
      }
      // 从全局菜单管理器中移除
      globalMenuManager.unregisterMenu(this);
    }

    /**
     * 处理点击外部（容器内但不在菜单上）
     */
    handleClickOutside(e) {
      if (!this.state.menuElement) return;

      const menu = this.state.menuElement;
      const clickedInsideMenu = menu.contains(e.target);
      const clickedInContainer = this.container.contains(e.target);

      // 如果点击在菜单上，不处理
      if (clickedInsideMenu) {
        return;
      }

      // 只处理容器内的点击（但不是菜单），容器外的点击不处理
      if (clickedInContainer) {
        this.clearAutoHighlight();
        this.clearManualHighlight();
        this.state.isSelecting = false;
      }
    }

    /**
     * 检查是否在限制区域内
     */
    isInRestrictArea(element) {
      if (!this.options.restrictSelector) {
        return this.container.contains(element);
      }

      const restrictElement = this.container.querySelector(this.options.restrictSelector);
      return restrictElement && restrictElement.contains(element);
    }

    /**
     * 检查鼠标是否在元素上
     */
    isMouseOverElement(element) {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const mouseX = this.lastMouseX || 0;
      const mouseY = this.lastMouseY || 0;
      return (
        mouseX >= rect.left &&
        mouseX <= rect.right &&
        mouseY >= rect.top &&
        mouseY <= rect.bottom
      );
    }

    /**
     * 检查鼠标是否在菜单上
     */
    isMouseOverMenu() {
      if (!this.state.menuElement) return false;
      const rect = this.state.menuElement.getBoundingClientRect();
      const mouseX = this.lastMouseX || 0;
      const mouseY = this.lastMouseY || 0;
      return (
        mouseX >= rect.left &&
        mouseX <= rect.right &&
        mouseY >= rect.top &&
        mouseY <= rect.bottom
      );
    }

    /**
     * 更新菜单项
     */
    updateMenuItems(menuItems, copyItem) {
      menuItems = (menuItems || []).concat([]);
      if (menuItems.length > 4) {
        menuItems.splice(3, 0, copyItem);
      } else {
        menuItems.push(copyItem);
      }
      this.options.menuItems = menuItems;
      if (this.state.menuElement) {
        this.state.menuElement.remove();
        this.state.menuElement = null;
      }
      this.createMenu();
    }

    updateManualSelectEnabled(enableManualHighlight) {
      this.options.enableManualHighlight = enableManualHighlight;
      if (this.options.enableManualHighlight) {
        // 监听文本选择
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('selectionchange', this.handleSelectionChange);
      } else {
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('selectionchange', this.handleSelectionChange);
      }
    }

    updateAutoSelectEnabled(enableAutoHighlight) {
      this.options.enableAutoHighlight = enableAutoHighlight;
      // 为每个段落直接绑定事件（更稳定）
      // 先移除所有旧的事件监听
      this.state.paragraphs.forEach(paragraph => {
        paragraph.removeEventListener('mouseenter', this.handleParagraphEnter);
        paragraph.removeEventListener('mouseleave', this.handleParagraphLeave);
      });
      if (this.options.enableAutoHighlight) {
        // 为每个段落添加事件监听
        this.state.paragraphs.forEach(paragraph => {
          paragraph.addEventListener('mouseenter', this.handleParagraphEnter, { passive: true });
          paragraph.addEventListener('mouseleave', this.handleParagraphLeave, { passive: true });
        });
      }
    }
    /**
     * 刷新段落识别
     */
    refresh() {
      // 移除所有段落的事件监听
      this.state.paragraphs.forEach(paragraph => {
        paragraph.removeEventListener('mouseenter', this.handleParagraphEnter);
        paragraph.removeEventListener('mouseleave', this.handleParagraphLeave);
      });

      // 重新识别段落
      this.identifyParagraphs();
    }

    /**
     * 销毁实例
     */
    destroy() {
      // 移除所有段落的事件监听
      this.state.paragraphs.forEach(paragraph => {
        paragraph.removeEventListener('mouseenter', this.handleParagraphEnter);
        paragraph.removeEventListener('mouseleave', this.handleParagraphLeave);
      });

      // 清除定时器
      if (this.clearHighlightTimer) {
        clearTimeout(this.clearHighlightTimer);
        this.clearHighlightTimer = null;
      }
      if (this.highlightTimer) {
        clearTimeout(this.highlightTimer);
        this.highlightTimer = null;
      }
      if (this.enterTimer) {
        clearTimeout(this.enterTimer);
        this.enterTimer = null;
      }

      document.removeEventListener('mouseup', this.handleMouseUp);
      document.removeEventListener('selectionchange', this.handleSelectionChange);
      document.removeEventListener('mousemove', this.handleMouseMove);
      document.removeEventListener('click', this.handleClickOutside, true);

      // 清除高亮
      this.clearAutoHighlight();
      this.clearManualHighlight();

      // 移除菜单
      if (this.state.menuElement && this.state.menuElement.parentNode) {
        this.state.menuElement.parentNode.removeChild(this.state.menuElement);
      }

      // 从全局菜单管理器中移除
      globalMenuManager.unregisterMenu(this);

      // 重置状态
      this.state = {
        currentAutoHighlight: null,
        currentManualHighlight: null,
        currentManualHighlights: [],
        menuElement: null,
        isSelecting: false,
        paragraphs: []
      };
    }
  }

  // 导出
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextHighlighter;
  } else if (typeof define === 'function' && define.amd) {
    define([], function () {
      return TextHighlighter;
    });
  } else {
    global.TextHighlighter = TextHighlighter;
  }
})(typeof window !== 'undefined' ? window : this);


