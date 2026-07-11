/**
 * WorkAiSenderExtras — agent_usage === 4 (WORK_AI) 时,
 * 渲染在 Sender 下方独立区域(ChatView.senderBelowExtras slot)。
 *
 * 设计要点:
 * - 不要用 senderLeftExtras(slot 会覆盖 Sender 内部 toolbar 的 @/技能/附件 icon)。
 * - ChatView 父级已加空态判断:仅 welcomeIndexLayout + messageList 空 + 非流式时渲染,
 *   对齐原版 IndexChat.tsx line 1828。
 * - 内容与原版 line 1831-1961 一致:技能 chips + 更多按钮 + 我的技能弹窗。
 *   示例问题卡片由 ChatView.welcomeIndexLayout 接管(数据源 agentInfo.settings_obj.suggested_questions)。
 */
import { SvgIcon } from "@km/shared-components-react";
import { DownOutlined } from "@ant-design/icons";
import { Empty } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { checkVersion } from "@/utils/version";
import { VERSION_MODULE } from "@/constants/enterprise";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";
import { useState } from "react";

export interface WorkAiSenderExtrasProps {
  onSelectSkill: (skill: { display_name: string; skill_name?: string; icon?: string }) => void;
  onOpenSkillLibrary?: () => void;
  hasKnowledgeBase: boolean;
  /** 技能列表（包含 bind_type 字段用于区分内置/用户技能） */
  skillList?: Array<{
    display_name: string;
    skill_name?: string;
    icon?: string;
    id?: string | number;
    bind_type?: 'builtin' | 'user';
  }>;
}

/**
 * Work-ai 模式下的 extras — 与 IndexChat 一样:技能 chips + 「更多」按钮 + 我的技能弹窗。
 * 这是轻量级 UI,只显示主功能(技能选择),复杂的示例问题与建议问题不在 sender extras 内。
 */
export function WorkAiSenderExtras(props: WorkAiSenderExtrasProps) {
  const { onSelectSkill, onOpenSkillLibrary, hasKnowledgeBase, skillList: propSkillList } = props;
  const userStore = useUserStore();
  const [showMySkills, setShowMySkills] = useState(false);

  // 是否在 work-ai 模式(双重保险:agent_usage===4 + hasKnowledgeBase 或 workbench/recording)
  const inWorkAi =
    userStore.is_login &&
    userStore.info.is_internal &&
    (hasKnowledgeBase || checkVersion(VERSION_MODULE.WORKBENCH) || checkVersion(VERSION_MODULE.RECORDING));

  if (!inWorkAi) return null;

  // 使用传入的 skillList
  const allSkills = propSkillList || [];

  // 内置技能（bind_type === 'builtin'）展示为 chips
  const builtinSkills = allSkills.filter((s: any) => s.bind_type === 'builtin' && s.admin_status === 'enabled');

  // 用户技能（bind_type === 'user'）展示在"我的技能"弹窗
  const userSkills = allSkills.filter((s: any) => s.bind_type === 'user');

  return (
    <div className="pt-2 relative">
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {builtinSkills.map((skill: any) => (
          <div
            key={skill.id}
            role="button"
            tabIndex={0}
            className="max-w-[132px] h-10 px-4 rounded-full border border-[#E6E8EB] flex items-center gap-1.5 cursor-pointer hover:bg-[#F2F3F5] transition-all"
            onClick={() => onSelectSkill({ display_name: skill.display_name, skill_name: skill.skill_name, icon: skill.icon })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectSkill({ display_name: skill.display_name, skill_name: skill.skill_name, icon: skill.icon });
              }
            }}
          >
            <span className="text-sm truncate">{skill.display_name}</span>
          </div>
        ))}
        <div
          role="button"
          tabIndex={0}
          className="h-10 px-4 rounded-full border border-[#E6E8EB] flex items-center gap-1 cursor-pointer hover:bg-[#F2F3F5] transition-all"
          onClick={() => setShowMySkills(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setShowMySkills(true);
            }
          }}
        >
          <span className="text-sm">{t("work_ai.more")}</span>
          <DownOutlined style={{ fontSize: "14px" }} />
        </div>
      </div>

      {showMySkills && (
        <div className="absolute -top-[44px] left-0 right-0 mb-2 bg-[#F9FAFCFF] rounded-b-xl border border-[#E6E8EB] shadow-lg z-10">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-[#9CA3AF]">我的技能</span>
            <div className="flex items-center gap-4">
              {onOpenSkillLibrary && (
                <div
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-1 text-sm text-[#9CA3AF] hover:text-[#2563EB] transition-colors cursor-pointer"
                  onClick={onOpenSkillLibrary}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenSkillLibrary();
                    }
                  }}
                >
                  <SvgIcon name="skills" size={14} />
                  前往技能库
                </div>
              )}
              <div
                role="button"
                tabIndex={0}
                className="size-5 flex items-center justify-center cursor-pointer hover:bg-[#F5F5F7] rounded"
                onClick={() => setShowMySkills(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setShowMySkills(false);
                  }
                }}
              >
                <SvgIcon name="close" size={14} color="#9CA3AF" />
              </div>
            </div>
          </div>
          {userSkills.length > 0 ? (
            <div className="pl-2 pr-4 pb-4 grid grid-cols-6 gap-3">
              {userSkills.map((skill: any) => (
                <div
                  key={skill.id}
                  role="button"
                  tabIndex={0}
                  className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                    skill.admin_status === "enabled"
                      ? "cursor-pointer hover:bg-[#F5F5F7]"
                      : "cursor-not-allowed opacity-50"
                  }`}
                  onClick={() => {
                    onSelectSkill({
                      display_name: skill.display_name,
                      skill_name: skill.skill_name,
                      icon: skill.icon,
                    });
                    setShowMySkills(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectSkill({
                        display_name: skill.display_name,
                        skill_name: skill.skill_name,
                        icon: skill.icon,
                      });
                      setShowMySkills(false);
                    }
                  }}
                >
                  <div className="size-8 bg-[#F0F2F5] rounded flex items-center justify-center shrink-0">
                      <SvgIcon name="skill" size={18} color="#2563EB" />
                  </div>
                  <span className="text-sm truncate">{skill.display_name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full text-center text-sm py-4">
              <Empty
                description="没有更多技能"
                image={getPublicPath("/images/chat/completion_empty.png")}
                imageStyle={{ height: 80 }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WorkAiSenderExtras;
