import { buildKnowledgeFileUrl } from "@/utils/router";

// ============================================================
// 正则模式
// ============================================================

/** wiki 内链 [[slug|label]] 与引用 [c123]
 *  label 段允许多种 token:
 *    1. `\[` / `\]` 转义序列(字面 `[` / `]`,或与 `]]` 邻接的边界场景)
 *    2. `]` 后面不接 `]`(因为 `]]` 是闭合符,只能当 label 内的字面 `]`)
 *    3. 任意非 `]` 字符
 *  这让用户的原始未转义形式 `[[...|财会[2018]15 号）]]` 也能匹配。 */
const WIKI_INLINE_PATTERN =
  /\[\[([^\]|]+?)(?:\|((?:\\[\[\]]|[^\]]|](?!\]))*?))?\]\]|\[(c\d+)\]/gi;

/** 来源引用 4 种语法;chunkId 可选,兼容 `[source: file:XXX]` 与 `[source: file:XXX#c000]` */
const SOURCE_REF_PREFIX_PATTERN =
  /\[source:\s*file:([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?\]/gi;
const SOURCE_REF_CITE_PATTERN =
  /<cite>\s*file:([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?\s*<\/cite>/gi;
const SOURCE_REF_BRACKET_PATTERN =
  /\[file:([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?\]/gi;
const SOURCE_REF_BARE_PATTERN =
  /(^|[^\w/])file:([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?(?=$|[^\w])/gi;

/** 转换中间占位符,避免命中其他规则;chunkId 段为空时表示无 chunk */
const SOURCE_REF_PLACEHOLDER_PATTERN =
  /@@WIKI_SOURCE_REF:([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]*))?#([^@]*)@@/g;

/** code block + inline code,豁免误转换 */
const CODE_BLOCK_PATTERN = /```[\s\S]*?```|`[^`]*`/g;

/** markdown 链接 [label](href),用于保存时反解
 *  label 段只允许 `\[` / `\]` 转义(forward 路径总会把 `[` / `]` 转义进 markdown);
 *  不允许裸 `]`,因为那会终止 markdown 链接标签 */
const MARKDOWN_LINK_PATTERN = /\[((?:\\[\[\]]|[^\]])*)\]\(([^)]*)\)/g;

// ============================================================
// 类型
// ============================================================

export type WikiPageHrefBuilder = (slug: string) => string;

/** 来源文件的元信息(fileId -> ...) */
export interface WikiFileSourceMeta {
  /** 来源文件所属知识库 ID,用于拼接跳转 URL */
  libraryId?: string;
  /** 来源文件名称,用于渲染引用链接的显示文本 */
  fileName?: string;
}

export type FileIdToSourceMetaResolver = (fileId: string) => WikiFileSourceMeta | undefined;

// ============================================================
// 小工具
// ============================================================

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 对 markdown 链接 label 做最小转义,避免 `[` / `]` 破坏语法 */
function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\[\]])/g, "\\$1");
}

/** 还原 wiki label 内的 `\[` / `\]` 转义回字面 `[` / `]`;其他 `\X` 不动 */
function unescapeWikiLabel(value: string): string {
  return value.replace(/\\([\[\]])/g, "$1");
}

/** 把字面 `[` / `]` 转义回 `\[` / `\]`,用于把 markdown label 写回 wiki 语法 */
function escapeForWikiLabel(value: string): string {
  return value.replace(/([\[\]])/g, "\\$1");
}

/** 从 URL 中取 query 参数,支持绝对 / 相对 URL */
function getQueryParam(href: string, name: string): string | null {
  try {
    return new URL(href).searchParams.get(name);
  } catch {
    const qIdx = href.indexOf("?");
    if (qIdx === -1) return null;
    return new URLSearchParams(href.slice(qIdx + 1)).get(name);
  }
}

/** 从来源引用 URL 中解析 fileId */
function extractFileIdFromLibraryFileHref(href: string): string | null {
  const match = href.match(/\/library\/[^/?#]+\/file\/([^/?#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// ============================================================
// URL 构造
// ============================================================

function buildLibraryWikiPageHref(libraryId: string, slug: string): string {
  return `/library/${encodeURIComponent(libraryId)}/wiki/${encodeURIComponent(slug)}?view=page`;
}

function resolveWikiPageHrefBuilder(
  target: string | WikiPageHrefBuilder,
): WikiPageHrefBuilder {
  if (typeof target === "function") return target;
  return (slug) => buildLibraryWikiPageHref(target, slug);
}

// ============================================================
// fileId -> 文件元信息 解析器
// ============================================================

export function buildFileIdToSourceMetaResolver(
  sources:
    | ReadonlyArray<{ source_file_id?: string; library_id?: string; file_name?: string }>
    | undefined,
): FileIdToSourceMetaResolver {
  if (!sources || sources.length === 0) {
    return () => undefined;
  }
  const map = new Map<string, WikiFileSourceMeta>();
  for (const src of sources) {
    const fileId = src.source_file_id != null ? String(src.source_file_id) : "";
    if (!fileId) continue;
    const meta: WikiFileSourceMeta = {};
    if (src.library_id != null) meta.libraryId = String(src.library_id);
    if (src.file_name != null && String(src.file_name).length > 0) {
      meta.fileName = String(src.file_name);
    }
    map.set(fileId, meta);
  }
  return (fileId) => map.get(fileId);
}

// ============================================================
// 来源引用 转换
// ============================================================

/** 把来源引用原 match 包成中间占位符,二阶段再还原 */
function wrapAsSourceRefPlaceholder(
  fileId: string,
  chunkId: string | undefined,
  originalMatch: string,
): string {
  return `@@WIKI_SOURCE_REF:${fileId}#${chunkId ?? ""}#${encodeURIComponent(originalMatch)}@@`;
}

/** 占位符 -> markdown 链接;命中 resolver 时使用 file_name 显示文本,否则保留原语法 */
function resolveSourceRefToMarkdownLink(
  originalMatch: string,
  fileId: string,
  chunkId: string | undefined,
  fileIdResolver?: FileIdToSourceMetaResolver,
): string {
  const meta = fileIdResolver?.(fileId);
  const libraryId = meta?.libraryId;
  if (!libraryId) return originalMatch;
  const chunk = chunkId ?? "";
  const displayLabel = meta?.fileName || (chunk ? `${fileId}#${chunk}` : fileId);
  return `[${displayLabel}](${buildKnowledgeFileUrl(libraryId, fileId, chunk || undefined)})`;
}

/** 单段内完成 4 种来源引用语法 -> markdown 链接 */
function transformSourceReferencesInSegment(
  segment: string,
  fileIdResolver?: FileIdToSourceMetaResolver,
): string {
  return segment
    .replace(SOURCE_REF_PREFIX_PATTERN, (match, fileId: string, chunkId?: string) =>
      wrapAsSourceRefPlaceholder(fileId, chunkId, match),
    )
    .replace(SOURCE_REF_CITE_PATTERN, (match, fileId: string, chunkId?: string) =>
      wrapAsSourceRefPlaceholder(fileId, chunkId, match),
    )
    .replace(SOURCE_REF_BRACKET_PATTERN, (match, fileId: string, chunkId?: string) =>
      wrapAsSourceRefPlaceholder(fileId, chunkId, match),
    )
    .replace(
      SOURCE_REF_BARE_PATTERN,
      (match: string, prefix: string, fileId: string, chunkId?: string) =>
        `${prefix}${wrapAsSourceRefPlaceholder(fileId, chunkId, match.slice(prefix.length))}`,
    )
    .replace(
      SOURCE_REF_PLACEHOLDER_PATTERN,
      (_match, fileId: string, chunkId: string | undefined, encodedOriginal: string) =>
        resolveSourceRefToMarkdownLink(
          decodeURIComponent(encodedOriginal),
          fileId,
          chunkId,
          fileIdResolver,
        ),
    );
}

/** 全文级别转换:跳过 code block / inline code */
function transformSourceReferencesToMarkdown(
  content: string,
  fileIdResolver?: FileIdToSourceMetaResolver,
): string {
  let result = "";
  let lastIndex = 0;
  CODE_BLOCK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_PATTERN.exec(content)) !== null) {
    result += transformSourceReferencesInSegment(content.slice(lastIndex, match.index), fileIdResolver);
    result += match[0];
    lastIndex = match.index + match[0].length;
  }
  result += transformSourceReferencesInSegment(content.slice(lastIndex), fileIdResolver);
  return result;
}

// ============================================================
// wiki 内链 转换
// ============================================================

/** 单段内:wiki 内链 -> markdown 链接,引用 [c123] -> HTML 标记;随后再走来源引用转换 */
function renderWikiInlineSegment(
  segment: string,
  hrefBuilder: WikiPageHrefBuilder,
  fileIdResolver?: FileIdToSourceMetaResolver,
): string {
  let result = "";
  let lastIndex = 0;
  WIKI_INLINE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WIKI_INLINE_PATTERN.exec(segment)) !== null) {
    result += segment.slice(lastIndex, match.index);

    const slug = String(match[1] ?? "").trim();
    const hasLabel = match[2] !== undefined;
    const label = (
      hasLabel ? unescapeWikiLabel(String(match[2] ?? "")) : slug
    ).trim();
    const citation = String(match[3] ?? "").trim();

    if (slug) {
      const href = hrefBuilder(slug);
      result += `[${escapeMarkdownLabel(label || slug)}](${href})`;
    } else if (citation) {
      result += `<span class="source-reference wiki-source-reference" data-source-number="${escapeHtml(citation)}" title="来源片段 ${escapeHtml(citation)}">${escapeHtml(citation)}</span>`;
    } else {
      result += match[0];
    }

    lastIndex = match.index + match[0].length;
  }

  result += segment.slice(lastIndex);
  return transformSourceReferencesInSegment(result, fileIdResolver);
}

// ============================================================
// 公共 API
// ============================================================

/**
 * 查看模式转换:wiki 内链 + 来源引用 全部转 markdown 链接
 * - [[slug|label]] -> [label](?space_id=...&selected=slug&vd-type=dynamicKnowledge)
 * - [source: file:xxx#c000] -> [file_name](/library/LIB/file/xxx?vd-type=knowledge&chunk=c000)
 * - [c123] 引用保持为 <span> HTML(语义由 markdown 解析器外使用)
 * - 未命中 sources / resolver 时保留原语法
 * - 跳过 code block / inline code
 */
export function transformWikiInlineMarkup(
  content: string,
  target: string | WikiPageHrefBuilder,
  fileIdResolver?: FileIdToSourceMetaResolver,
): string {
  if (!content) return content;
  if (!target) return content;

  const hrefBuilder = resolveWikiPageHrefBuilder(target);

  let result = "";
  let lastIndex = 0;
  CODE_BLOCK_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_PATTERN.exec(content)) !== null) {
    result += renderWikiInlineSegment(content.slice(lastIndex, match.index), hrefBuilder, fileIdResolver);
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  result += renderWikiInlineSegment(content.slice(lastIndex), hrefBuilder, fileIdResolver);
  return result;
}

export function buildWikiContentTransformer(
  target: string | WikiPageHrefBuilder,
  fileIdResolver?: FileIdToSourceMetaResolver,
): (content: string) => string {
  return (content: string) => transformWikiInlineMarkup(content, target, fileIdResolver);
}

/**
 * 编辑入口转换:与查看模式同样输出 markdown 链接,但入口是 wiki 内链语法
 * - [[slug|label]] -> [label](url)
 * - [[slug]]      -> [slug](url)
 * - [source: file:xxx#c000] -> [file_name](/library/LIB/file/xxx?vd-type=knowledge&chunk=c000)
 * - [c123] 引用保持不变
 */
export function wikiToMarkdownLink(
  content: string,
  hrefBuilder: WikiPageHrefBuilder,
  fileIdResolver?: FileIdToSourceMetaResolver,
): string {
  if (!content) return content;

  // 1) 来源引用 转 markdown 链接(走 transformSourceReferencesToMarkdown 处理 code block 豁免)
  const withSourceLinks = transformSourceReferencesToMarkdown(content, fileIdResolver);

  // 2) wiki 内链 [[slug|label]] 转 markdown 链接
  return withSourceLinks.replace(WIKI_INLINE_PATTERN, (match, slugOrCit, label) => {
    if (slugOrCit?.startsWith?.("c") && /^\d+$/.test(slugOrCit.slice(1))) {
      return match;
    }
    const slug = String(slugOrCit ?? "").trim();
    const hasLinkLabel = label !== undefined;
    const linkLabel = (
      hasLinkLabel ? unescapeWikiLabel(String(label ?? "")) : slug
    ).trim();
    if (slug) {
      return `[${escapeMarkdownLabel(linkLabel)}](${hrefBuilder(slug)})`;
    }
    return match;
  });
}

/**
 * 保存时反解:markdown 链接 -> wiki 内链语法
 * - [label](url?vd-type=knowledge&chunk=xxx) -> [source: file:FILEID#xxx]
 *   FILEID 从 URL 路径解析(/library/LIB/file/FILEID);chunk 缺失时降级为不带 chunk
 * - [label](url?selected=slug) -> [[slug|label]]
 * - 其他链接保持原样
 */
export function markdownLinkToWiki(content: string): string {
  if (!content) return content;

  return content.replace(MARKDOWN_LINK_PATTERN, (match, label: string, href: string) => {
    if (/[?&]vd-type=knowledge(?:&|$)/.test(href)) {
      const fileId = extractFileIdFromLibraryFileHref(href);
      if (!fileId) return match;
      const chunk = getQueryParam(href, "chunk");
      return chunk ? `[source: file:${fileId}#${chunk}]` : `[source: file:${fileId}]`;
    }
    const slug = getQueryParam(href, "selected");
    if (slug) {
      const decodedLabel = label ? unescapeWikiLabel(label) : "";
      if (!decodedLabel || decodedLabel === slug) return `[[${slug}]]`;
      return `[[${slug}|${escapeForWikiLabel(decodedLabel)}]]`;
    }
    return match;
  });
}