import { useMemo, useState } from "react";
import { Empty } from "antd";
import type { Skill } from "@/api/modules/skill/types";
import SkillCard from "./Card";
import SkillEnvVarsDrawer from "./SkillEnvVarsDrawer";
import { t } from "@/locales";

interface SkillListProps {
  list: Skill[];
  loading?: boolean;
  keyword?: string;
  type: "my" | "explore";
  sort?: "created_time" | "updated_time";
  className?: string;
  groupId?: number;
  onAdd?: (id: string) => void;
  /** 分页模式：当前页（1-based）；与 pageSize 配合使用 */
  page?: number;
  /** 分页模式：每页条数。设置后启用切片 */
  pageSize?: number;
  /** 直接添加到指定 agentId，不弹出选择小助理弹窗 */
  addedAgentId?: number | string;
  /** 已添加的技能 ID 列表，用于在弹窗中标记已添加状态 */
  addedSkillIds?: string[];
  /** 使用技能回调（将技能添加到对话框） */
  onUseSkill?: (skill: { id: string; display_name: string; skill_name: string; icon?: string }) => void;
}

const SkillList: React.FC<SkillListProps> = ({
  list,
  loading = false,
  keyword = "",
  type,
  sort = "created_time",
  className,
  groupId,
  onAdd,
  page = 1,
  pageSize,
  addedAgentId,
  addedSkillIds,
  onUseSkill,
}) => {
  const [envDrawerState, setEnvDrawerState] = useState<{
    open: boolean;
    skillId: string;
    skillDisplayName: string;
  }>({ open: false, skillId: "", skillDisplayName: "" });

  const handleOpenEnvDrawer = (skillId: string, skillDisplayName: string) => {
    setEnvDrawerState({ open: true, skillId, skillDisplayName });
  };

  const handleCloseEnvDrawer = () => {
    setEnvDrawerState((prev) => ({ ...prev, open: false }));
  };

  const showList = useMemo(() => {
    let result = [...list];

    // 按排序字段降序排列
    if (sort) {
      result.sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
    }

    if (groupId) {
      result = result.filter(item => {
        return item.group_ids.includes(groupId)
      })
    }

    // 关键词筛选
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      result = result.filter((item) => {
        return (
          item.display_name.toLowerCase().includes(kw) ||
          item.skill_name.toLowerCase().includes(kw) ||
          item.description.toLowerCase().includes(kw)
        );
      });
    }

    // 分页切片（在过滤/排序之后）
    if (pageSize && pageSize > 0) {
      const start = (page - 1) * pageSize;
      result = result.slice(start, start + pageSize);
    }

    return result;
  }, [list, keyword, sort, groupId, page, pageSize]);

  if (loading) {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${className || ""}`}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="bg-white border border-[#ECECEC] rounded-xl p-5 animate-pulse"
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 bg-gray-200 rounded-lg shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="h-5 bg-gray-200 rounded w-1/2" />
                  <div className="h-5 bg-gray-200 rounded w-16" />
                </div>
                <div className="h-3 bg-gray-200 rounded w-1/3" />
              </div>
            </div>
            <div className="flex-1 mb-5">
              <div className="h-4 bg-gray-200 rounded w-full mb-2" />
              <div className="h-4 bg-gray-200 rounded w-3/4" />
            </div>
            <div className="flex items-center gap-2 border-t border-gray-50 pt-4">
              <div className="h-8 bg-gray-200 rounded flex-1" />
              <div className="h-8 bg-gray-200 rounded w-8" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (showList.length === 0) {
    return (
      <div className="col-span-full flex flex-col items-center justify-center max-h-[600px] h-[63vh]">
        <Empty
          description={t("common.no_data")}
          image={window.$getPublicPath("/images/chat/completion_empty.png")}
        />
      </div>
    );
  }

  return (
    <>
      <div
        className={`grid grid-cols-3 gap-4 ${className || ""}`}
      >
        {showList.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            type={type}
            groupId={groupId}
            onAdd={onAdd}
            addedAgentId={addedAgentId}
            addedSkillIds={addedSkillIds}
            onUseSkill={onUseSkill}
            onOpenEnvSettings={() => handleOpenEnvDrawer(skill.id, skill.display_name)}
          />
        ))}
      </div>

      <SkillEnvVarsDrawer
        open={envDrawerState.open}
        skillId={envDrawerState.skillId}
        skillDisplayName={envDrawerState.skillDisplayName}
        onClose={handleCloseEnvDrawer}
      />
    </>
  );
}

export default SkillList;
