/**
 * ProcessFlow 组件导出
 */

export { default as ProcessFlow } from "./ProcessFlow";
// ProcessFlowHeader 是 ProcessFlow 的别名，保持向后兼容
export { default as ProcessFlowHeader } from "./ProcessFlow";

// 类型导出
export type {
  ProcessFlowType,
  StepStatus,
  SSEStepStatus,
  ProcessRecord,
  KnowledgeSource,
  ProcessFlowHeaderProps,
  TaskProcessFlowProps,
  SkillProcessFlowProps,
  TranslateFn,
} from "./types";

// 工具函数导出
export {
  safeParseJson,
  formatArguments,
  formatResult,
  formatLlmContent,
  getFlowType,
  getFileIcon,
  dedupeWikiPages,
} from "./utils";

export type { FormatFileInfoResult } from "./utils";
