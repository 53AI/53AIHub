/**
 * EnhancedMentionDropdown — agent_usage === 4 (WORK_AI) 时,@ 下拉的多入口版本。
 * 也复用于 agent_usage === 1 (KM_AI_SEARCH, AI 搜问)——此时只展示「从知识库里选择」入口。
 *
 * 来源:apps/front-react/src/components/Chat/Sender.tsx line 2400-2499
 * (legacy enhancedMention=true 模式下的 dropdown)
 *
 * 2 个入口:
 *   1. @ 从知识库里选择  → onOpenLibrary(ChatContainer 渲染 SpaceDialog 或 KnowledgeSourceSelector)
 *   2. @ 从我的中选择    → onOpenMyFiles(ChatContainer 渲染合并后的 MyFilesDialog)
 *
 * 入口的可见性:
 *   - 入口 1 由 hasKnowledgeBase + 回调存在 共同决定;
 *   - 入口 2 由 onOpenMyFiles 回调存在决定;version 模块(WORKBENCH / RECORDING)
 *     的判定由 ChatContainer 在计算 enabledSources 时完成,本组件不感知。
 *   - knowledge 模式复用本组件时不传 onOpenMyFiles → 自动隐藏入口 2。
 *
 * 视觉效果:对齐 legacy(308px 宽 / max-h-[450px] / antd 风格阴影 / 圆角 xl / 搜索框 + 最近访问 + 文件列表)。
 */
import { Empty, Input } from "antd";
import {
  CloseOutlined,
  LoadingOutlined,
  RightOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useRef } from "react";
import type { MentionDropdownSlotProps, MentionDocItem } from "@km/hub-ui-x-react";
import { VERSION_MODULE } from "@/constants/enterprise";
import { checkVersion } from "@/utils/version";
import { t } from "@/locales";

export interface EnhancedMentionDropdownCallbacks {
  /** 「从知识库里选择」入口回调;不传则不渲染 */
  onOpenLibrary?: () => void;
  /** 「从我的中选择」入口回调;不传则不渲染(对齐小助理专属) */
  onOpenMyFiles?: () => void;
}

export type EnhancedMentionDropdownProps = MentionDropdownSlotProps &
  EnhancedMentionDropdownCallbacks & {
    className?: string;
  };

export function EnhancedMentionDropdown(props: EnhancedMentionDropdownProps) {
  const {
    suggestions,
    recentList = [],
    searchKeyword,
    searchLoading,
    selectedIndex,
    onSelect,
    onSearchChange,
    onClose,
    onCancel,
    style,
    hasKnowledgeBase = true,
    onOpenLibrary,
    onOpenMyFiles,
    className = "",
  } = props;

  const inputRef = useRef<any>(null);

  useEffect(() => {
    try {
      inputRef.current?.focus?.({ cursor: "all" });
    } catch {
      inputRef.current?.focus?.();
    }
  }, []);

  // 入口可见性:
  // - 「从知识库里选择」由 hasKnowledgeBase + KNOWLEDGE_BASE 版本 + 回调存在 共同决定。
  // - 「从我的中选择」由 onOpenMyFiles 回调存在 决定;version / recordingConfig 的
  //   守卫由调用方在计算 enabledSources 时完成,本组件不感知。
  // 回调缺失即可关闭对应入口,使 AI 搜问复用同一组件时只展示「从知识库里选择」。
  const showKnowledgeEntry =
    Boolean(hasKnowledgeBase) && checkVersion(VERSION_MODULE.KNOWLEDGE_BASE) && Boolean(onOpenLibrary);
  const showMyFilesEntry = Boolean(onOpenMyFiles);

  // 显示的列表:有搜索关键词时用 suggestions,否则用 recentList
  const displayList = useMemo<MentionDocItem[]>(() => {
    const keyword = searchKeyword.trim();
    if (keyword) return suggestions;
    return recentList.slice(0, 5);
  }, [searchKeyword, suggestions, recentList]);

  const isSearching = Boolean(searchKeyword.trim());

  // 搜索态下只呈现搜索结果,隐藏底部 4 个入口
  const showEntries = !isSearching;

  const handleItemClick = (item: MentionDocItem) => {
    onSelect(item);
  };

  const handleEntryClick = (entry: (() => void) | undefined) => {
    if (!entry) return;
    // 关闭下拉,然后触发外部 dialog
    onClose?.();
    entry();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      // Esc 必须把 chip 还原成普通字符,而不仅是关掉下拉 —— 否则
      // `<span class="mention-input">@</span>` 会继续以 chip 形式留在编辑器里。
      if (onCancel) {
        onCancel();
      } else {
        onClose?.();
      }
    }
  };

  // 只在没有任何入口时,显示"无匹配项"占位
  const noEntries = !showKnowledgeEntry && !showMyFilesEntry;

  return (
    <div
      className={`enhanced-mention-dropdown pointer-events-auto ${className}`}
      style={style}
      onKeyDown={handleKeyDown}
    >
      {/* 搜索框 */}
      {hasKnowledgeBase && (
        <div className="py-3">
          <Input
            ref={inputRef}
            value={searchKeyword}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("chat.mention.search_placeholder")}
            prefix={searchLoading && isSearching ? <LoadingOutlined /> : <SearchOutlined />}
            allowClear
          />
        </div>
      )}

      {/* 列表 */}
      <div className="enhanced-mention-dropdown__list scroll-y-auto">
        {hasKnowledgeBase && (
          <>
            <div className="enhanced-mention-dropdown__section-title">
              {isSearching ? t("chat.mention.search_result") : t("common.recently_visit")}
            </div>
            {/* 搜索中只展示 loading,不与(上一次关键词的)列表同时展示 */}
            {isSearching && searchLoading ? (
              <div className="enhanced-mention-dropdown__loading">
                <LoadingOutlined /> {t("chat.mention.searching")}
              </div>
            ) : displayList.length === 0 ? (
              <Empty
                className="enhanced-mention-dropdown__empty"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  isSearching ? t("chat.mention.search_no_result") : t("chat.mention.no_recent")
                }
              />
            ) : (
              <div className="enhanced-mention-dropdown__items">
                {displayList.map((doc, index) => (
                  <div
                    key={doc.id}
                    className={`enhanced-mention-dropdown__item ${selectedIndex === index ? "is-selected" : ""}`}
                    onClick={() => handleItemClick(doc)}
                  >
                    <div className="enhanced-mention-dropdown__icon">
                      {doc.icon ? (
                        <img src={doc.icon} className="enhanced-mention-dropdown__icon-img" alt="" />
                      ) : null}
                    </div>
                    <p className="enhanced-mention-dropdown__name">{doc.name}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 2 个入口 —— 搜索态下隐藏,只呈现搜索结果 */}
        {showEntries && showKnowledgeEntry && (
          <div
            className="enhanced-mention-dropdown__entry"
            onClick={() => handleEntryClick(onOpenLibrary)}
          >
            <span className="flex-1">
              @ {t("chat.select_from_knowledge")}
            </span>
            <RightOutlined />
          </div>
        )}
        {showEntries && showMyFilesEntry && (
          <div
            className="enhanced-mention-dropdown__entry"
            onClick={() => handleEntryClick(onOpenMyFiles)}
          >
            <span className="flex-1">@ {t("chat.select_from_my")}</span>
            <RightOutlined />
          </div>
        )}

        {/* 没有任何入口(非内部用户)时给提示 */}
        {noEntries && !hasKnowledgeBase && (
          <Empty
            className="enhanced-mention-dropdown__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="当前模式暂无可用入口"
          />
        )}
      </div>

      {/* 关闭按钮(右上角)— 对齐 legacy 当知识库模式无搜索框时不显示关闭按钮的逻辑 */}
      {!hasKnowledgeBase && onClose && (
        <button
          type="button"
          aria-label="close"
          className="enhanced-mention-dropdown__close"
          onClick={() => onClose()}
        >
          <CloseOutlined />
        </button>
      )}

      {/* 与 legacy 一致的样式 */}
      <style>{`
        .enhanced-mention-dropdown {
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15);
          padding: 6px 12px 6px;
          width: 308px;
          max-height: 450px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .enhanced-mention-dropdown__list {
          overflow-y: auto;
          max-height: 400px;
        }
        .enhanced-mention-dropdown__section-title {
          height: 36px;
          display: flex;
          align-items: center;
          padding: 0 8px;
          color: #999;
          font-size: 12px;
        }
        .enhanced-mention-dropdown__items {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .enhanced-mention-dropdown__item {
          display: flex;
          align-items: center;
          width: 100%;
          height: 36px;
          padding: 0 10px;
          border-radius: 8px;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .enhanced-mention-dropdown__item:hover,
        .enhanced-mention-dropdown__item.is-selected {
          background-color: #EBF1FF;
        }
        .enhanced-mention-dropdown__icon {
          width: 20px;
          height: 20px;
          margin-right: 12px;
          background: #F5F5F5;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: none;
          overflow: hidden;
        }
        .enhanced-mention-dropdown__icon-img {
          width: 16px;
          height: 16px;
          object-fit: contain;
        }
        .enhanced-mention-dropdown__name {
          flex: 1;
          font-size: 14px;
          color: #1D1E1F;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .enhanced-mention-dropdown__entry {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 32px;
          padding: 0 10px;
          margin-top: 4px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
        }
        .enhanced-mention-dropdown__entry:hover {
          background-color: #EBF1FF;
        }
        .enhanced-mention-dropdown__loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 24px 16px;
          font-size: 12px;
          color: #9FA4C5;
        }
        .enhanced-mention-dropdown__empty {
          margin: 12px 0;
        }
        .enhanced-mention-dropdown__empty .ant-empty-description {
          font-size: 12px;
          color: #9FA4C5;
        }
        .enhanced-mention-dropdown__close {
          position: absolute;
          top: 12px;
          right: 12px;
          cursor: pointer;
          color: #666;
          background: transparent;
          border: none;
          padding: 4px;
        }
        .enhanced-mention-dropdown__close:hover {
          color: #333;
        }
      `}</style>
    </div>
  );
}

export default EnhancedMentionDropdown;
