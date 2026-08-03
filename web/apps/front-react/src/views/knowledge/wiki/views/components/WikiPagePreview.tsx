import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spin } from "antd";
import { useNavigate } from "react-router-dom";
import { SvgIcon, OverflowTooltip } from "@km/shared-components-react";
import { useSpaceStore } from "@/stores/modules/space";
import { t } from "@/locales";
import { formatFileInfo } from "@/api/modules/files/transform";
import type { WikiPageVersion } from "@/api/modules/wiki";
import { getFormatTimeStamp } from "@km/shared-utils";
import {
  buildFileIdToSourceMetaResolver,
  transformWikiInlineMarkup,
} from "../../utils/wiki-markup";
import { buildKnowledgeFileUrl, buildWikiPageUrl } from "@/utils/router";

const ChunkView = React.lazy(() =>
  import("@/components/Markdown").then((m) => ({ default: m.ChunkView })),
);

interface WikiPagePreviewProps {
  /** 预览数据源（需含 title / aliases / page_type / version_no / updated_time / body / sources / links / backlinks） */
  version: WikiPageVersion;
  /** 标题右侧的自定义操作区域（如编辑 / 收藏 / AI / 更多等），不传则不渲染右侧栏 */
  headerActions?: React.ReactNode;
  /** 详情加载中（切换版本时显示 loading） */
  loading?: boolean;
  /** 是否启用正文文本选择 */
  enableTextSelection?: boolean;
}

/**
 * 共享预览布局：标题 → 别名 → page_type + 版本号 + 更新时间 → 反向链接 → 正文 + 来源文档 / 相关知识 footer。
 *
 * ViewMode（带标题右侧操作）与 KnowledgeHistoryDrawer（不带右侧操作）共用此组件，避免布局代码重复。
 */
export const WikiPagePreview: React.FC<WikiPagePreviewProps> = ({
  version,
  headerActions,
  loading = false,
  enableTextSelection = false,
}) => {
  const navigate = useNavigate();
  const spaceId = useSpaceStore((state) => state.spaceId);
  const markdownContainerRef = useRef<HTMLDivElement>(null);
  const [isMetadataHidden, setIsMetadataHidden] = useState(false);

  // 监听正文滚动：滚离顶部时收起别名/类型/反向链接，保留标题始终可见
  useEffect(() => {
    const mount = markdownContainerRef.current;
    if (!mount) return;

    let scrollEl: HTMLElement | null = null;
    let rafId: number | null = null;
    // 滞回阈值：避免在边缘位置反复切换造成顶部闪烁
    const HIDE_AT = 24;
    const SHOW_AT = 4;
    let hidden = false;

    const apply = () => {
      rafId = null;
      if (!scrollEl) return;
      const top = scrollEl.scrollTop;
      const next = hidden ? top > SHOW_AT : top > HIDE_AT;
      if (next !== hidden) {
        hidden = next;
        setIsMetadataHidden(next);
      }
    };

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(apply);
    };

    const attach = () => {
      scrollEl = mount.querySelector<HTMLElement>(".virtual-list-container");
      if (!scrollEl) return false;
      scrollEl.addEventListener("scroll", handleScroll, { passive: true });
      return true;
    };

    if (!attach()) {
      const observer = new MutationObserver(() => {
        if (attach()) observer.disconnect();
      });
      observer.observe(mount, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        if (rafId !== null) cancelAnimationFrame(rafId);
        scrollEl?.removeEventListener("scroll", handleScroll);
      };
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      scrollEl?.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const aliases = version.aliases ?? [];
  const backlinks = version.backlinks ?? [];
  const links = version.links ?? [];
  const sources = (version.sources ?? []).map(item => {
    const file = formatFileInfo(item.file_name)
    item.file_name = file.fname
    return item
  });
  const hrefBuilder = useMemo(
    () => (slug: string) => buildWikiPageUrl(spaceId || "", slug),
    [spaceId],
  );

  const fileIdResolver = useMemo(
    () => buildFileIdToSourceMetaResolver(sources),
    [sources],
  );

  const transformedContent = useMemo(() => {
    if (!version.body) return "";
    return transformWikiInlineMarkup(version.body, hrefBuilder, fileIdResolver);
  }, [version.body, hrefBuilder, fileIdResolver]);

  // Markdown 预览内的链接点击：阻止浏览器整页刷新，改用 SPA 导航
  const handleLinkClick = useCallback(
    (event: MouseEvent, anchor: HTMLAnchorElement) => {
      event.preventDefault();
      navigate(anchor.href);
    },
    [navigate],
  );


  return (
    <div className="flex-1 min-h-0 flex flex-col px-8 pt-5 overflow-hidden">
      {/* 标题 + 右侧操作区 */}
      <div className="flex justify-between items-center overflow-hidden">
        <OverflowTooltip>
          <h1 className="flex-1 text-2xl font-medium text-primary truncate">
            {version.title}
          </h1>
        </OverflowTooltip>
        {headerActions && (
          <div className="flex items-center gap-2">{headerActions}</div>
        )}
      </div>

      {/* 别名 */}
      {aliases.length > 0 && (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
            isMetadataHidden ? "max-h-0 opacity-0" : "mt-3 max-h-20 opacity-100"
          }`}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[#888994] text-xs mr-0.5">
              {t("wiki.alias_label")}:
            </span>
            {aliases.map((alias, idx) => (
              <span
                key={idx}
                className="h-[18px] flex items-center bg-[#F2F5FA] text-[10px] text-[#373A3D] px-2 rounded-md"
              >
                {alias}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 类型 + 版本号 + 更新时间 */}
      <div
        className={`flex items-center gap-2 overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
          isMetadataHidden ? "max-h-0 opacity-0" : "mt-3 max-h-8 opacity-100"
        }`}
      >
        {version.page_type && (
          <div className="h-5 flex items-center bg-[#F0F5FF] text-theme px-2 rounded-md">
            {t(`wiki.page_type.${version.page_type}`)}
          </div>
        )}
        <span className="text-theme text-xs">V{version.version_no}</span>
        <span className="text-xs text-[#9CA3AF]">
          {getFormatTimeStamp(version.updated_time)}
        </span>
      </div>

      {/* 被链接（反向链接） */}
      {backlinks.length > 0 && (
        <div
          className={`flex items-start gap-2 text-xs overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
            isMetadataHidden ? "max-h-0 opacity-0" : "mt-3 max-h-40 opacity-100"
          }`}
        >
          <div className="shrink-0 h-5 flex items-center gap-1.5 mr-3 text-[#888994]">
            <SvgIcon name="unlink" size={14} className="rotate-90" />
            <span className="shrink-0">{t("wiki.backlinks_label")}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {backlinks.map((link) => {
              const href = link.from_page_slug ? buildWikiPageUrl(spaceId || "", link.from_page_slug):  ''
              return (
                <a
                  key={link.id}
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    href && navigate(href);
                  }}
                  className="py-0.5 px-2 flex items-center bg-[#F2F5FA] text-[#6B7280] rounded cursor-pointer hover:text-main no-underline"
                >
                  {link.from_page_title || link.anchor_text}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* 正文 */}
      <div ref={markdownContainerRef} className="-mr-6 flex-1 min-h-0">
        <React.Suspense
          fallback={
            <div className="py-10 flex justify-center">
              <Spin />
            </div>
          }
        >
          <ChunkView
            content={transformedContent}
            showDisplayMode={false}
            defaultOutlineVisible={true}
            outlinePosition="relative"
            outlineSide="right"
            outlineMode="simple"
            contentClass=""
            enableTextSelection={enableTextSelection}
            onLinkClick={handleLinkClick}
            footer={
              <div className="border-t pt-7 mt-7 space-y-7">
                {/* 来源引用 */}
                {sources.length > 0 && (
                  <section className="flex items-start gap-3">
                    <h3 className="text-base font-medium text-main shrink-0">
                      {t("wiki.source_documents")}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {sources.map((src) => {
                        if (src.source_kind === 'manual') return null
                        const displayName = src.file_name
                          ? formatFileInfo(src.file_name).fname
                          : src.source_ref ||
                              src.source_slug ||
                              src.source_kind;
                        const canJump = !!(src.source_file_id && src.library_id);
                        if (!canJump) {
                          return (
                            <div
                              key={src.id}
                              className="h-[22px] px-2 rounded bg-[#F2F5FA] text-theme text-xs flex items-center"
                              title={displayName}
                            >
                              {displayName}
                            </div>
                          );
                        }
                        const href = buildKnowledgeFileUrl(
                          src.library_id!,
                          src.source_file_id!,
                        );
                        return (
                          <a
                            key={src.id}
                            href={href}
                            onClick={(e) => {
                              e.preventDefault();
                              navigate(href);
                            }}
                            className="h-[22px] px-2 rounded bg-[#F2F5FA] text-theme text-xs flex items-center cursor-pointer hover:text-blue-600 no-underline"
                            title={displayName}
                          >
                            {displayName}
                          </a>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* 相关知识 */}
                {links.length > 0 && (
                  <section className="flex items-start gap-3">
                    <h3 className="h-5 flex items-center text-base font-medium text-main shrink-0">
                      {t("wiki.related_knowledge")}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {links.map((link) => {
                        const href = buildWikiPageUrl(
                          spaceId || "",
                          link.target_slug,
                        );
                        return (
                          <a
                            key={link.id}
                            href={href}
                            onClick={(e) => {
                              e.preventDefault();
                              navigate(href);
                            }}
                            className="py-0.5 px-2 rounded bg-[#F2F5FA] text-[#373A3D] text-xs flex items-center cursor-pointer hover:text-main no-underline"
                            title={link.target_slug}
                          >
                            {link.anchor_text}
                          </a>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            }
          />
        </React.Suspense>
      </div>
    </div>
  );
};

export default WikiPagePreview;