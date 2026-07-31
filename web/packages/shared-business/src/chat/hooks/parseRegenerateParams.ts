import type { Message } from "../types/message";
import type {
  RegenerateParams,
  UseChatMessagesRegenerateOptions,
} from "../types/regenerate";
import { parseQuestionWithSkill } from "../utils/parseQuestionWithSkill";

/**
 * 把 Message 提取为"重新生成回答"所需的参数。
 *
 * 纯函数，便于测试和复用。skill 前缀解析行为与 useChatMessages.loadMessages 一致
 * （通过 parseQuestionWithSkill 工具统一实现，避免行为漂移）。
 */
export function parseRegenerateParams(
  message: Message,
  options: UseChatMessagesRegenerateOptions = {},
): RegenerateParams {
  if (!message) {
    throw new TypeError("parseRegenerateParams: message is required");
  }

  const originalQuestion = (message as any).question || "";
  const shouldParseSkill = options.parseSkillPrefix !== false;
  const parsed = shouldParseSkill
    ? parseQuestionWithSkill(originalQuestion, {
        skillList: options.skillList || [],
        mySkillList: options.mySkillList || [],
      })
    : { question: originalQuestion, skill: (message as any).skill || undefined };

  // parseQuestionWithSkill returns an empty skill object ({ skill_name: "", display_name: "" })
  // when no skill prefix is present. Normalize that to undefined so callers can rely on
  // `skill === undefined` to mean "no skill applied".
  const parsedSkill =
    parsed.skill && parsed.skill.skill_name ? parsed.skill : undefined;

  return {
    question: parsed.question,
    originalQuestion,
    files: (message as any).uploaded_files || [],
    specifiedFiles: (message as any).specified_files || [],
    skill: parsedSkill || ((message as any).skill || undefined),
    networkSearch: (message as any).rag_stats?.type === "web_search",
    knowledgeGraph: Boolean((message as any).knowledge_graph),
    specifiedContent: (message as any).specified_content,
    sourceMessage: message,
    // 从 specifiedFiles 中提取动态知识（type === 'wiki'）
    // 修复:不要从 isspace 推断 wikiType。isspace 同时被普通知识库空间使用,
    // 改用 iswiki 标记区分「动态知识页面」,其它归为「动态知识空间」。
    wikis: ((message as any).specified_files || [])
      .filter((f: any) => f.type === 'wiki')
      .map((f: any) => ({
        id: f.id,
        name: f.name,
        icon: f.icon,
        wikiType: f.iswiki ? 'page' as const : 'space' as const,
        title: f.title,
        slug: f.slug,
        summary: f.summary,
        type: 'wiki'
      })),
  };
}