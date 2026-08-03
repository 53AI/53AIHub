import { useState, useMemo, useRef, useCallback, useEffect, type ReactNode } from "react";
import { Tree, message } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { markdownPreview } from "./helper";
import {
  generateHeadingId,
  parseMarkdownOutline,
  type OutlineNode,
} from "./parseMarkdownOutline";
import VirtualList from "@/components/VirtualList";
import { copyToClip } from "@km/shared-utils";
import loadLib from "@/utils/loadLib";
import { t } from "@/locales";
import "./chunk-view.css";

declare global {
  interface Window {
    TextHighlighter: any;
  }
}

interface ChunkItem {
  id: number;
  content: string;
}

// footer 占位项的哨兵 id，使用 Number.MIN_SAFE_INTEGER 避免与真实 id 冲突
const FOOTER_CHUNK_ID = Number.MIN_SAFE_INTEGER;

interface ChunkViewProps {
  className?: string;
  chunks?: ChunkItem[];
  content?: string;
  outlinePosition?: "absolute" | "relative";
  outlineSide?: "left" | "right";
  outlineMode?: "default" | "simple";
  defaultOutlineVisible?: boolean;
  contentTransformer?: (content: string) => string;
  showDisplayMode?: boolean;
  showOutline?: boolean;
  mode?: "pdf" | "web";
  contentClass?: string;
  footer?: ReactNode;
  /**
   * 划词选区（v0.4.2 §3.4 配套）：开启后，会在每个 chunk 挂载时创建
   * TextHighlighter 实例，提供高亮视觉 + 选区菜单（复制等），
   * 选区文本通过 window 派发 `selection-change` 事件；
   * 并响应 `viewer-event` 的 `menu` / `auto-select-enabled` 切换。
   * 对齐 library/main/file/assistant/Chat.tsx 与 MarkdownViewer 的实现。
   */
  enableTextSelection?: boolean;
  /**
   * Markdown 预览中的链接点击回调（透传至 Vditor 的 `link.click`）。
   * 返回 false 或在内部调用 `event.preventDefault()` 即可阻止浏览器整页刷新，
   * 通常配合 SPA 导航（`navigate(anchor.href)`）使用。
   */
  onLinkClick?: (event: MouseEvent, anchor: HTMLAnchorElement) => void;
}

interface ViewerEventDetail {
  type: "menu" | "auto-select-enabled";
  data: any;
}

const PREVIEW_MODE = {
  pdf: "pdf",
  web: "web",
} as const;

// 复制菜单项，与 MarkdownViewer / NormalViewer 保持一致
const copyItem = {
  logo: "/viewer/images/copy.png",
  label: "复制",
  handler: (info: any) => {
    copyToClip(info.text).then(() => {
      message.success("已复制");
    });
  },
};

// Simple 模式的目录组件
interface SimpleOutlineProps {
  outline: OutlineNode[];
  activeHeadingId: string;
  onNodeClick: (node: OutlineNode) => void;
}

const SimpleOutline: React.FC<SimpleOutlineProps> = ({
  outline,
  activeHeadingId,
  onNodeClick,
}) => {
  // 扁平化所有节点，按深度缩进
  const flattenNodes = (nodes: OutlineNode[], level = 0): Array<OutlineNode & { indent: number }> => {
    const result: Array<OutlineNode & { indent: number }> = [];
    nodes.forEach((node) => {
      result.push({ ...node, indent: level });
      if (node.children.length > 0) {
        result.push(...flattenNodes(node.children, level + 1));
      }
    });
    return result;
  };

  const items = useMemo(() => flattenNodes(outline), [outline]);

  return (
    <div className="relative pl-2">
      {/* 左侧装饰线：上虚-中实-下虚 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-px"
        style={{
          background: `linear-gradient(to bottom,
            transparent 0%,
            #E6E8EB 10%,
            #E6E8EB 90%,
            transparent 100%
          )`,
        }}
      />
      <div className="space-y-1">
        {items.map((item) => {
          const isActive = item.id === activeHeadingId;
          return (
            <div
              key={item.id}
              data-outline-id={item.id}
              className={`relative flex items-center gap-1 py-1 cursor-pointer text-sm font-medium ${
                isActive
                  ? "text-theme font-medium"
                  : "text-primary hover:text-theme"
              }`}
              style={{ paddingLeft: `${item.indent * 12 + 16}px` }}
              onClick={() => onNodeClick(item)}
            >
              {isActive && (
                <span className="absolute left-0 text-[10px] text-[#2563EB]">
                  ▶
                </span>
              )}
              <span className="truncate">{item.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default function ChunkView({
  className = "",
  chunks = [],
  content = "",
  outlinePosition = "relative",
  outlineSide = "left",
  outlineMode = "default",
  defaultOutlineVisible = false,
  contentTransformer,
  showDisplayMode = true,
  showOutline = true,
  mode,
  contentClass = "p-16",
  footer,
  enableTextSelection = false,
  onLinkClick,
}: ChunkViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const virtualListRef = useRef<any>(null);
  const outlineScrollRef = useRef<HTMLDivElement>(null);

  // 高亮器实例：按 chunk.id 索引
  // ChunkView 一次会渲染多个 chunk（VirtualList 渲染窗口内的所有分片），
  // 每个 chunk 都需要独立的 TextHighlighter 实例
  const highlighterInstancesRef = useRef<Map<number, any>>(new Map());
  // 第三方库加载状态：避免每个 chunk 都重复 loadLib
  const highlighterLibLoadedRef = useRef<boolean>(false);
  // viewer-event 事件积压队列：高亮器尚未创建时先入队，等首个实例就绪后回放
  const eventCallbackRef = useRef<Event[]>([]);
  // 当前活动的手动高亮选区文本：用于点击 sender 等内容区外的位置时，
  // 先存下来再清高亮，避免清高亮派发的 selection-change('') 把 Chat
  // 侧的 slideContent 一并清掉（用户仍希望保留"已选文本"作为上下文）。
  const activeSelectionTextRef = useRef<string>("");

  const [outlineVisible, setOutlineVisible] = useState(defaultOutlineVisible);
  const [displayMode, setDisplayMode] = useState<"pdf" | "web">(
    mode || PREVIEW_MODE.web,
  );
  const [activeHeadingId, setActiveHeadingId] = useState<string>("");

  const finalChunks = useMemo(() => {
    let next: ChunkItem[];
    if (content !== undefined && content !== null && content !== "") {
      next = [{ id: -1, content }];
    } else {
      // 用 filter 也行；为最小变更用展开并显式跳过 footer 哨兵
      next = (chunks || []).filter((c) => c.id !== FOOTER_CHUNK_ID);
    }
    // 将 footer 作为最后一项追加（占位 id），避免污染原始 chunks 引用
    if (footer) {
      next = [...next, { id: FOOTER_CHUNK_ID, content: "" }];
    }
    return next;
  }, [content, chunks, footer]);

  const outline = useMemo(() => parseMarkdownOutline(finalChunks), [finalChunks]);

  const handleNodeClick = async (data: OutlineNode) => {
    // 通过 ID 直查 heading，不再用文本匹配
    const findHeading = (): Element | null => {
      return rootRef.current?.querySelector(`#${CSS.escape(data.id)}`) || null;
    };

    // 如果标题已渲染，直接滚动
    const heading = findHeading();
    if (heading) {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    // 标题未渲染，使用 finder 函数在加载完成后自动定位
    await virtualListRef.current?.scrollToIndex(data.chunkIndex, "auto", findHeading);
  };

  // 处理 viewer-event：对所有已挂载的高亮器实例广播
  // （菜单项更新、自动划词开关切换）。无实例时事件入队，
  // 等到首个高亮器就绪时由 initChunkHighlighter 回放。
  const viewerEvent = useCallback((event: Event) => {
    const detail = (event as CustomEvent<ViewerEventDetail>).detail;
    const instances = Array.from(highlighterInstancesRef.current.values());
    if (instances.length === 0) {
      eventCallbackRef.current.push(event);
      return;
    }

    if (detail.type === "menu") {
      const menuItems = detail.data.map((item: any) => ({
        logo: item.logo,
        label: item.name,
        handler: (e: any) => {
          window.dispatchEvent(
            new CustomEvent("quick-command", {
              detail: { name: item.name, prompt: item.content, text: e.text },
            }),
          );
        },
      }));
      instances.forEach((inst) => {
        try {
          inst.updateMenuItems?.(menuItems, copyItem);
        } catch (e) {
          console.error("更新菜单项失败:", e);
        }
      });
    }

    if (detail.type === "auto-select-enabled") {
      instances.forEach((inst) => {
        try {
          inst.updateAutoSelectEnabled?.(detail.data);
        } catch (e) {
          console.error("更新自动划词状态失败:", e);
        }
      });
    }
  }, []);

  // 监听 viewer-event
  useEffect(() => {
    if (!enableTextSelection) return;
    window.addEventListener("viewer-event", viewerEvent);
    return () => {
      window.removeEventListener("viewer-event", viewerEvent);
    };
  }, [enableTextSelection, viewerEvent]);

  // 监听文档点击：高亮器自身的 handleClickOutside 只处理容器内的点击，
  // 当菜单位置在内容区之外（例如覆盖到右侧 Chat 的输入框）时，点击
  // 输入框不会触发任何隐藏逻辑，菜单会一直停在原位并拦截点击事件，
  // 导致用户无法在 sender 中输入。补一个 mousedown 监听：
  // 点击目标既不在内容区、也不在任何高亮器菜单内时，隐藏所有菜单
  // 并清掉手动选区（释放 highlight 状态，允许后续重新划词）。
  // 注意：clearManualHighlight 内部会派发 selection-change('')，
  // 这会把 Chat 侧的 slideContent 也清掉。为了让用户继续把"已选文本"
  // 作为上下文引用，在清高亮前先把当前文本存到 ref，清完后再用同一文本
  // 派发一次 selection-change。React 会把这两个 setSlideContent 批处理，
  // 视觉上 slideContent 不会闪。
  useEffect(() => {
    if (!enableTextSelection) return;

    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      // 点击在内容区内：高亮器自己处理
      if (rootRef.current?.contains(target)) return;

      // 点击在任何一个高亮器菜单内：高亮器自己处理（按钮 click 会 stopPropagation）
      for (const inst of highlighterInstancesRef.current.values()) {
        if (inst?.state?.menuElement?.contains?.(target)) return;
      }

      // 先把当前选区文本存下来，供清完之后还原 slideContent 用
      const preservedText = activeSelectionTextRef.current || "";

      highlighterInstancesRef.current.forEach((inst) => {
        try {
          inst.clearManualHighlight?.();
        } catch (err) {
          console.error("清除手动高亮失败:", err);
        }
        try {
          inst.clearAutoHighlight?.();
        } catch (err) {
          console.error("清除自动高亮失败:", err);
        }
        inst.state && (inst.state.isSelecting = false);
      });

      // 还原：把选中文本重新派发一次 selection-change，保持 Chat 侧
      // 的 slideContent 引用；React 18 自动批处理会合并这两次更新。
      if (preservedText) {
        activeSelectionTextRef.current = preservedText;
        window.dispatchEvent(
          new CustomEvent("selection-change", {
            detail: { text: preservedText },
          }),
        );
      } else {
        activeSelectionTextRef.current = "";
      }
    };

    // 用 mousedown 而不是 click：保证在浏览器把焦点交给输入框之前先把菜单收掉
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocMouseDown);
    };
  }, [enableTextSelection]);

  // 初始化单个 chunk 的高亮器
  const initChunkHighlighter = useCallback(
    async (chunkId: number, container: HTMLElement) => {
      if (!enableTextSelection) return;
      // 同一个 chunk 已挂载，跳过
      if (highlighterInstancesRef.current.has(chunkId)) return;
      if (!highlighterLibLoadedRef.current) {
        try {
          await loadLib("highlighter");
          highlighterLibLoadedRef.current = true;
        } catch (e) {
          console.error("加载 highlighter 失败:", e);
          return;
        }
      }
      if (!window.TextHighlighter) return;
      const instance = new window.TextHighlighter({
        container,
        enableAutoHighlight: false,
        enableManualHighlight: true,
        forceVirtualMode: true,
        menuItems: [copyItem],
        onSelectionChange: (text: string) => {
          // 记录当前活动选区文本，供外部点击的 fallback 使用
          activeSelectionTextRef.current = text || "";
          window.dispatchEvent(
            new CustomEvent("selection-change", { detail: { text } }),
          );
        },
      });
      highlighterInstancesRef.current.set(chunkId, instance);
      instance.init();

      // 处理积压事件：首个高亮器就绪后回放队列
      if (eventCallbackRef.current.length > 0) {
        const pending = eventCallbackRef.current.splice(0);
        pending.forEach((e) => viewerEvent(e));
      }
    },
    [enableTextSelection, viewerEvent],
  );

  // 销毁单个 chunk 的高亮器
  const destroyChunkHighlighter = useCallback((chunkId: number) => {
    const instance = highlighterInstancesRef.current.get(chunkId);
    if (instance) {
      try {
        instance.destroy();
      } catch (e) {
        console.error("销毁高亮器失败:", e);
      }
      highlighterInstancesRef.current.delete(chunkId);
    }
  }, []);

  // 卸载时销毁所有高亮器
  useEffect(() => {
    return () => {
      highlighterInstancesRef.current.forEach((inst) => {
        try {
          inst.destroy();
        } catch (e) {
          console.error("销毁高亮器失败:", e);
        }
      });
      highlighterInstancesRef.current.clear();
      eventCallbackRef.current = [];
    };
  }, []);

  const handleItemVisible = useCallback(
    (index: number, item: ChunkItem, done: () => void) => {
      // footer item 不需要 markdown 渲染
      if (item.id === FOOTER_CHUNK_ID) {
        done();
        return;
      }

      const node = rootRef.current?.querySelector(
        `.preview-${item.id}`,
      ) as HTMLDivElement;
      if (!node) return;

      const rawContent = String(item.content).replace(
        /(\n\s*<[^>]*>)/g,
        (match) => {
          return `${match.trim()}\n`;
        },
      );
      const itemContent = contentTransformer ? contentTransformer(rawContent) : rawContent;

      // markdownPreview is async due to loadLib, but the callback handles completion
      void markdownPreview(node, itemContent, {
        after() {
          // 渲染完成后，覆盖 vditor 生成的 heading ID，与 outline 的 ID 格式对齐
          const headings = node.querySelectorAll("h1, h2, h3, h4, h5, h6");
          let headingIndex = 0;
          headings.forEach((heading) => {
            heading.id = generateHeadingId(index, headingIndex++);
          });
          // 初始化高亮器（异步，不阻塞渲染完成回调）
          void initChunkHighlighter(item.id, node);
          setTimeout(() => done(), 200);
        },
        // 透传链接点击拦截；未提供时不附加，避免对其他消费者产生副作用
        ...(onLinkClick ? { link: { click: onLinkClick } } : {}),
      });
    },
    [contentTransformer, initChunkHighlighter, onLinkClick],
  );

  const handleItemHidden = useCallback(
    (index: number, item: ChunkItem) => {
      // chunk 离开可见区域时销毁对应高亮器，避免内存泄漏
      destroyChunkHighlighter(item.id);
    },
    [destroyChunkHighlighter],
  );

  const handleToggleOutline = () => {
    setOutlineVisible(!outlineVisible);
  };

  // 收集所有标题 ID（扁平化）
  const allHeadingIds = useMemo(() => {
    const ids: string[] = [];
    const traverse = (nodes: OutlineNode[]) => {
      nodes.forEach((node) => {
        ids.push(node.id);
        if (node.children.length > 0) {
          traverse(node.children);
        }
      });
    };
    traverse(outline);
    return ids;
  }, [outline]);

  // 滚动时高亮当前可见的标题
  useEffect(() => {
    if (outlineMode !== "simple" || !outlineVisible) return;

    // VirtualList 的滚动容器在其内部的 .virtual-list-container
    const findScrollContainer = () => {
      return rootRef.current?.querySelector('.virtual-list-container') as HTMLDivElement | null;
    };

    let scrollEl: HTMLDivElement | null = null;
    let animationFrameId: number | null = null;

    const handleScroll = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = requestAnimationFrame(() => {
        const headings = rootRef.current?.querySelectorAll(
          "h1, h2, h3, h4, h5, h6"
        );
        if (!headings || headings.length === 0) return;

        // 找到当前可见区域最上方的标题
        const containerRect = scrollEl?.getBoundingClientRect();
        if (!containerRect) return;

        let activeId = "";

        for (let i = headings.length - 1; i >= 0; i--) {
          const heading = headings[i];
          const rect = heading.getBoundingClientRect();
          // 标题顶部在容器上方或刚进入可见区域
          if (rect.top <= containerRect.top + 100) {
            activeId = heading.id;
            break;
          }
        }

        if (activeId && activeId !== activeHeadingId) {
          setActiveHeadingId(activeId);
        }
      });
    };

    // 等待 VirtualList 渲染后找到滚动容器
    const timer = setTimeout(() => {
      scrollEl = findScrollContainer();
      if (scrollEl) {
        scrollEl.addEventListener("scroll", handleScroll);
        handleScroll(); // 初始调用
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      if (scrollEl) {
        scrollEl.removeEventListener("scroll", handleScroll);
      }
    };
  }, [outlineMode, outlineVisible, activeHeadingId]);

  // activeHeadingId 变化时，让目录容器跟随滚动，保证高亮项始终可见
  useEffect(() => {
    if (outlineMode !== "simple" || !outlineVisible || !activeHeadingId) return;

    const container = outlineScrollRef.current;
    if (!container) return;

    const activeItem = container.querySelector<HTMLElement>(
      `[data-outline-id="${CSS.escape(activeHeadingId)}"]`,
    );
    if (!activeItem) return;

    const containerRect = container.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const inView =
      itemRect.top >= containerRect.top && itemRect.bottom <= containerRect.bottom;
    if (inView) return;

    activeItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeHeadingId, outlineMode, outlineVisible]);

  return (
    <div
      ref={rootRef}
      className={`h-full w-full overflow-hidden relative flex ${className}`}
    >
      {/* Outline Toggle Button */}
      {!outlineVisible && showOutline && (
        <div
          className={`flex-none w-9 h-15 px-3 rounded-r bg-[#EEEEF0] flex-center cursor-pointer text-sm text-[#4F5052] z-[9] absolute top-28 hover:shadow ${
            outlineSide === "right" ? "right-0" : "left-0"
          }`}
          onClick={handleToggleOutline}
        >
          {t("common.outline")}
        </div>
      )}

      {/* Content Panel */}
      <div className="flex-1 flex flex-col overflow-hidden py-5">
        <VirtualList
          ref={virtualListRef}
          items={finalChunks}
          itemHeight={100}
          buffer={8}
          visibleDelay={150}
          sequential={false}
          className="flex-1 vditor-reset"
          wrapperClass={`${ contentClass } bg-white mx-auto ${displayMode === PREVIEW_MODE.pdf ? "max-w-4xl" : ""} ${outlineMode === "simple" && outlineVisible ? "mr-[160px]" : ""}`}
          onItemVisible={handleItemVisible}
          onItemHidden={handleItemHidden}
          renderItem={(item: ChunkItem) => {
            if (item.id === FOOTER_CHUNK_ID) {
              return <div className="preview-footer bg-white">{footer}</div>;
            }
            return <div className={`preview-${item.id}`} />;
          }}
        />

        {/* Display Mode Toggle */}
        {showDisplayMode && (
          <div className="flex-none px-4 py-2 flex justify-end gap-1.5 bg-[#F5F5F5] border-t">
            <div className="flex items-center gap-1.5">
              <div
                className={`h-6 rounded flex-center gap-2 px-2.5 cursor-pointer ${
                  displayMode === PREVIEW_MODE.pdf
                    ? "text-[#2563EB] bg-[#E5EAF5] shadow"
                    : "text-[#4F5052]"
                }`}
                onClick={() => setDisplayMode(PREVIEW_MODE.pdf)}
              >
                <span className="text-sm">{t("library.document")}</span>
              </div>
              <div
                className={`h-6 rounded flex-center gap-2 px-2.5 cursor-pointer ${
                  displayMode === PREVIEW_MODE.web
                    ? "text-[#2563EB] bg-[#E5EAF5] shadow"
                    : "text-[#4F5052]"
                }`}
                onClick={() => setDisplayMode(PREVIEW_MODE.web)}
              >
                <span className="text-sm">Web</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Outline Panel */}
      {outlineVisible && (
        <div
          className={`${
            outlineMode === "simple"
              ? `absolute top-1/2 -translate-y-1/2 ${outlineSide === "right" ? "right-4" : "left-4"} max-h-[80%] w-[160px] bg-white overflow-hidden flex flex-col`
              : `flex-none w-[220px] bg-white h-full overflow-hidden flex flex-col ${
                  outlineSide === "right" ? "border-l" : "border-r"
                } ${
                  outlinePosition === "absolute"
                    ? outlineSide === "right"
                      ? "absolute right-0 top-0 bottom-0 z-[5]"
                      : "absolute left-0 top-0 bottom-0 z-[5]"
                    : "relative"
                }`
          }`}
        >
          {outlineMode === "default" && (
            <div className="flex-none h-14 px-5 border-b flex items-center justify-between">
              <h4 className="text-sm text-[#4F5052]">{t("common.outline")}</h4>
              <CloseOutlined
                className="cursor-pointer"
                onClick={handleToggleOutline}
              />
            </div>
          )}
          <div
            ref={outlineScrollRef}
            className={`${outlineMode === "simple" ? "py-4 px-3" : "p-5"} flex-1 overflow-y-auto`}
          >
            {outlineMode === "simple" ? (
              <SimpleOutline
                outline={outline}
                activeHeadingId={activeHeadingId}
                onNodeClick={handleNodeClick}
              />
            ) : (
              <Tree
                treeData={outline}
                defaultExpandAll
                fieldNames={{ title: "text", key: "id", children: "children" }}
                onSelect={(keys, info: any) => {
                  if (info.node) {
                    handleNodeClick(info.node);
                  }
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}