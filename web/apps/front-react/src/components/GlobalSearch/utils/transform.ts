import { getSimpleDateFormatString } from "@km/shared-utils";
import { formatFileInfo } from "@/api/modules/files/transform";
import type { GlobalSearchResultItem } from "@/api/modules/global-search/types";

/** 全局搜索结果（RAG / wiki 源共用）展示项 */
export interface GlobalSearchFile {
  file_id: string;
  name: string;
  icon: string;
  path: string;
  library_id: string;
  library_name: string;
  space_id: string;
  space_name: string;
  creator_id: number;
  creator_name: string;
  location: string;
  lastUpdated: string;
  isfolder: boolean;
  /** 后端生成的高亮 HTML（含 <mark> 标签），仅在搜索模式下有值 */
  highlight?: string;
  /** 后端生成的高亮正文片段 HTML（含 <mark> + wiki 语法），仅在搜索模式下有值 */
  content_highlight?: string;
}

/**
 * 清洗后端返回的高亮 HTML：除 <mark> 标签外其余全部转义，
 * 防止不可信 HTML（script 等）经 dangerouslySetInnerHTML 注入。
 */
export function sanitizeSearchHighlight(html?: string): string | undefined {
  if (!html) return undefined;
  // 用私有区占位符暂存 <mark> 开闭标签，避免转义阶段破坏它们
  const OPEN = "\uE000";
  const CLOSE = "\uE001";
  const escaped = html
    .replace(/<mark\b[^>]*>/gi, OPEN)
    .replace(/<\/mark>/gi, CLOSE)
    .replace(/[&<>]/g, (ch) => {
      switch (ch) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        default:
          return ch;
      }
    });
  return escaped
    .replaceAll(OPEN, "<mark>")
    .replaceAll(CLOSE, "</mark>");
}

/** 把 wiki 内链 `[[slug|label]]` / `[[slug]]` 还原为纯文本 label/slug，用于搜索片段展示 */
const WIKI_LINK_TO_TEXT = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
function wikiLinksToPlainText(html: string): string {
  return html.replace(
    WIKI_LINK_TO_TEXT,
    (_match, slug: string, label?: string) =>
      ((label !== undefined ? label : slug).trim() || slug.trim()),
  );
}

/**
 * 清洗 content_highlight 成可安全展示的片段 HTML：
 * 保留 <mark> 高亮、把 wiki 实体链接还原成纯文本，其余 HTML 全部转义。
 */
export function sanitizeSearchContent(html?: string): string | undefined {
  if (!html) return undefined;
  return sanitizeSearchHighlight(wikiLinksToPlainText(html));
}

/** 将 RAG 文档搜索响应条目转换为展示项（知识文档 Tab 使用） */
export function transformResult(item: GlobalSearchResultItem): GlobalSearchFile {
  const isfolder = item.isfolder ?? item.type === 0;
  const { fname, icon } = formatFileInfo(item.file_name, isfolder);

  return {
    file_id: item.file_id,
    name: fname,
    icon: icon,
    path: item.path,
    library_id: item.library_id,
    library_name: item.library_name,
    space_id: item.space_id,
    space_name: item.space_name,
    creator_id: item.creator_id,
    creator_name: item.creator_name,
    location: `${item.space_name}/${item.library_name}`,
    lastUpdated: getSimpleDateFormatString({ date: item.latest_file_body_update_time }),
    isfolder: isfolder,
    highlight: item.highlight,
    content_highlight: item.content_highlight,
  };
}
