/**
 * ProcessFlow 工具函数
 */

// 从 shared-utils 导入通用工具
import { safeParseJson, getFileIconPath, type FormatFileInfoResult } from "@km/shared-utils";

// 重新导出供其他组件使用
export { safeParseJson, getFileIconPath, type FormatFileInfoResult };

/** 格式化工具参数 */
export function formatArguments(args?: string): string {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args);
    if (parsed.path && parsed.content) {
      return `write_file(${parsed.path})`;
    }
    if (parsed.command) {
      return `$ ${parsed.command}`;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return args;
  }
}

/** 格式化输出结果 */
export function formatResult(result?: string, maxLength = 300): string {
  if (!result) return "";
  return result.length > maxLength ? result.substring(0, maxLength) + "..." : result;
}

/** 格式化 LLM 内容 */
export function formatLlmContent(content: string, maxLength = 500): string {
  if (!content) return "";
  return content.length > maxLength ? content.substring(0, maxLength) + "..." : content;
}

/** 判断流程类型 */
export function getFlowType(
  processRecords: Array<{ step_code?: string }> | undefined
): 'task' | 'skill' | 'none' {
  if (!processRecords || processRecords.length === 0) {
    return 'none';
  }

  for (const record of processRecords) {
    if (record.step_code) {
      if (record.step_code === 'intent_classification') return 'task';
      if (record.step_code === 'skill_routing') return 'skill';
    }
  }

  return 'none';
}

/** 获取文件图标 - 兼容旧调用方式 */
export function getFileIcon(mime: string): string {
  return getFileIconPath(mime);
}

/**
 * 从 sources 中提取并去重 wiki 类型来源
 * - 仅保留 chunk_type === "wiki" 且 wiki_page_id 非空的项
 * - 按 wiki_page_id 去重，保留首次出现的 source
 */
export function dedupeWikiPages(
  sources: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const result: Array<Record<string, unknown>> = [];
  for (const source of sources) {
    if (source.chunk_type !== "wiki") continue;
    const pageId = source.wiki_page_id;
    if (typeof pageId !== "string" || pageId === "") continue;
    if (seen.has(pageId)) continue;
    seen.add(pageId);
    result.push(source);
  }
  return result;
}
