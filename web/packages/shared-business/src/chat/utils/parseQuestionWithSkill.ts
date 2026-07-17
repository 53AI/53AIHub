import type { Skill } from "../types/message";

export interface ParseSkillResult {
  question: string;
  skill: Skill;
}

/**
 * 解析 "/skill_name 实际内容" 前缀。
 *
 * 行为必须与 useChatMessages.loadMessages 中已有的实现一致：
 * - 命中列表（skillList / mySkillList 任一）→ question 去前缀、skill 填入列表项
 * - 未命中 → skill 降级为 { skill_name: 原前缀, display_name: 原前缀 }
 * - 无前缀 → 返回原 question、skill 为空
 */
export function parseQuestionWithSkill(
  question: string,
  options: { skillList?: any[]; mySkillList?: any[] } = {},
): ParseSkillResult {
  const skillList = options.skillList || [];
  const mySkillList = options.mySkillList || [];
  const skillMatch = question?.match?.(/^\/([^\s]+)\s+([\s\S]*)/);
  if (skillMatch) {
    const skillName = skillMatch[1];
    const targetSkill =
      skillList.find((s: any) => s.skill_name === skillName) ||
      mySkillList.find((s: any) => s.skill_name === skillName);
    if (targetSkill) {
      return {
        question: skillMatch[2],
        skill: {
          display_name: targetSkill.display_name,
          skill_name: targetSkill.skill_name,
        },
      };
    }
    return {
      question: skillMatch[2],
      skill: { display_name: skillName, skill_name: skillName },
    };
  }
  return {
    question: question || "",
    skill: { skill_name: "", display_name: "" },
  };
}