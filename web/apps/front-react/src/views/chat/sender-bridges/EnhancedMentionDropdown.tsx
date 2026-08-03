/**
 * EnhancedMentionDropdown — agent_usage === 4 (WORK_AI) 时,@ 下拉的多入口版本。
 * 也复用于 agent_usage === 1 (KM_AI_SEARCH, AI 搜问)——此时只展示「从知识库里选择」入口。
 *
 * 来源:apps/front-react/src/components/Chat/Sender.tsx line 2400-2499
 * (legacy enhancedMention=true 模式下的 dropdown)
 *
 * 4 个入口:
 *   1. @ 从知识库里选择  → onOpenLibrary(ChatContainer 渲染 SpaceDialog 或 KnowledgeSourceSelector)
 *   2. @ 从我上传的选择  → onOpenUploads(ChatContainer 渲染 MyFilesDialog source=uploads)
 *   3. @ 从AI生成的选择  → onOpenAIGenerated(MyFilesDialog source=ai-generated)
 *   4. @ 从我的录音选择  → onOpenRecordings(MyFilesDialog source=recordings)
 *
 * 入口的可见性:
 *   - 入口 1 由 hasKnowledgeBase 控制(回调存在时显示);
 *   - 入口 2、3 由回调 + workbench 版本控制;
 *   - 入口 4 由回调 + recording 版本控制。
 *   - 实际项目中也通过 VERSION_MODULE.KNOWLEDGE_BASE / WORKBENCH / RECORDING 判定。
 *
 * 视觉效果:对齐 legacy(308px 宽 / max-h-[450px] / antd 风格阴影 / 圆角 xl / 搜索框 + 最近访问 + 文件列表)。
 */
import { Input } from "antd";
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
  /** 「从我上传的选择」入口回调;不传则不渲染(对齐小助理专属) */
  onOpenUploads?: () => void;
  /** 「从AI生成的选择」入口回调;不传则不渲染(对齐小助理专属) */
  onOpenAIGenerated?: () => void;
  /** 「从我的录音选择」入口回调;不传则不渲染(对齐小助理专属) */
  onOpenRecordings?: () => void;
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
    style,
    hasKnowledgeBase = true,
    onOpenLibrary,
    onOpenUploads,
    onOpenAIGenerated,
    onOpenRecordings,
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
  // - 「从知识库里选择」由 hasKnowledgeBase + 回调存在 共同决定(knowledge 模式 + 小助理 都可见)
  // - 「从我上传/AI 生成」由回调存在 + workbench 版本 共同决定(仅小助理可见)
  // - 「从我的录音」由回调存在 + recording 版本 共同决定(仅小助理可见)
  // 回调缺失即可关闭对应入口,使 AI 搜问复用同一组件时只展示「从知识库里选择」。
  const showKnowledgeEntry =
    Boolean(hasKnowledgeBase) && checkVersion(VERSION_MODULE.KNOWLEDGE_BASE) && Boolean(onOpenLibrary);
  const showUploadsEntry =
    Boolean(onOpenUploads) && checkVersion(VERSION_MODULE.WORKBENCH);
  const showAIGeneratedEntry =
    Boolean(onOpenAIGenerated) && checkVersion(VERSION_MODULE.WORKBENCH);
  const showRecordingsEntry =
    Boolean(onOpenRecordings) && checkVersion(VERSION_MODULE.RECORDING);

  // 显示的列表:有搜索关键词时用 suggestions,否则用 recentList
  const displayList = useMemo<MentionDocItem[]>(() => {
    const keyword = searchKeyword.trim();
    if (keyword) return suggestions;
    return recentList.slice(0, 5);
  }, [searchKeyword, suggestions, recentList]);

  const isSearching = Boolean(searchKeyword.trim());

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
      onClose?.();
    }
  };

  // 只在没有任何入口时,显示"无匹配项"占位
  const noEntries = !showKnowledgeEntry && !showUploadsEntry && !showAIGeneratedEntry && !showRecordingsEntry;

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
              {isSearching && searchLoading && (
                <div className="enhanced-mention-dropdown__empty">
                  <LoadingOutlined /> 搜索中...
                </div>
              )}
              {!searchLoading && displayList.length === 0 && (
                <div className="enhanced-mention-dropdown__empty">
                  {isSearching ? t("chat.mention.search_no_result") : t("chat.mention.no_recent")}
                </div>
              )}
            </div>
          </>
        )}

        {/* 4 个入口 */}
        {showKnowledgeEntry && (
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
        {showUploadsEntry && (
          <div
            className="enhanced-mention-dropdown__entry"
            onClick={() => handleEntryClick(onOpenUploads)}
          >
            <span className="flex-1">@ 从我上传的选择</span>
            <RightOutlined />
          </div>
        )}
        {showAIGeneratedEntry && (
          <div
            className="enhanced-mention-dropdown__entry"
            onClick={() => handleEntryClick(onOpenAIGenerated)}
          >
            <span className="flex-1">@ 从AI生成的选择</span>
            <RightOutlined />
          </div>
        )}
        {showRecordingsEntry && (
          <div
            className="enhanced-mention-dropdown__entry"
            onClick={() => handleEntryClick(onOpenRecordings)}
          >
            <span className="flex-1">@ 从我的录音选择</span>
            <RightOutlined />
          </div>
        )}

        {/* 没有任何入口(非内部用户)时给提示 */}
        {noEntries && !hasKnowledgeBase && (
          <div className="enhanced-mention-dropdown__empty">
            当前模式暂无可用入口
          </div>
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
        .enhanced-mention-dropdown__empty {
          padding: 24px 16px;
          text-align: center;
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
