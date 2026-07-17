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
