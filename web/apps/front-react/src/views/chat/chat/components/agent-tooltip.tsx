import { useState, useMemo, useRef } from "react";
import { Tooltip, Empty } from "antd";
import { SearchOutlined, CloseOutlined } from "@ant-design/icons";
import { Search } from "@km/shared-components-react";
import { useAgentStore } from "@/stores/modules/agent";
import { useBasicLayout } from "@/hooks/useBasicLayout";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";
import "./agent-tooltip.css";

const DEFAULT_IMG = "/images/default_agent.png";

interface AgentTooltipProps {
  children: React.ReactNode;
  onSelect: (agent: Agent.State) => void;
}

export default function AgentTooltip({
  children,
  onSelect,
}: AgentTooltipProps) {
  const { isSmScreen } = useBasicLayout();
  const tooltipRef = useRef<any>(null);
  const [visible, setVisible] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [groupId, setGroupId] = useState(0);

  // 使用 Zustand selector 订阅状态变化
  const agentList = useAgentStore((state) => state.agentList);
  const categorys = useAgentStore((state) => state.categorys);

  // 对齐 Vue 版本：无"全部"分组，group_id=0 时显示全部
  const showAgentList = useMemo(() => {
    const filterList = agentList.filter(
      (item) => item.user_group_ids.length > 0,
    );
    if (!keyword) {
      return groupId === 0
        ? filterList
        : filterList.filter((item) => item.group_id === groupId);
    }
    const kw = keyword.toLowerCase().trim();
    return filterList.filter((item) => {
      const matchKeyword =
        item.name.toLowerCase().includes(kw) ||
        (item.description && item.description.toLowerCase().includes(kw));
      return (groupId === 0 || item.group_id === groupId) && matchKeyword;
    });
  }, [agentList, keyword, groupId]);

  const handleSelect = (item: Agent.State) => {
    onSelect(item);
    setVisible(false);
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement;
    const fallback = getPublicPath(DEFAULT_IMG);
    if (target.src.endsWith(fallback)) return;
    target.src = fallback;
  };

  const content = (
    <div className="p-5 w-[596px] max-md:w-full">
      <div className="flex items-center justify-between relative">
        <div className="absolute right-0">
          <div
            className="size-5 flex-center rounded cursor-pointer hover:bg-[#E1E2E3]"
            onClick={() => setVisible(false)}
          >
            <CloseOutlined />
          </div>
        </div>
        <h4 className="text-lg text-primary w-full max-md:text-center">
          {t("action.find")}
        </h4>
      </div>
      <Search
        mode="expanded"
        value={keyword}
        onDebouncedChange={setKeyword}
        size="large"
        placeholder={t("action.search") + t("module.agent")}
        className="mt-4"
      />
      {/* 对齐 Vue 版本：使用 el-tabs，直接绑定 group_id，无"全部"分组 */}
      <div className="flex gap-4 mt-4 overflow-x-auto">
        {categorys.map((item) => (
          <div
            key={item.group_id}
            className={`flex-none px-3 py-1 text-sm cursor-pointer rounded-full transition-colors ${
              groupId === item.group_id
                ? "bg-[#1677ff] text-white"
                : "bg-[#F1F2F3] text-primary hover:bg-[#E1E2E3]"
            }`}
            onClick={() => setGroupId(item.group_id)}
          >
            {item.group_name}
          </div>
        ))}
      </div>
      <div className="h-[300px] overflow-y-auto mt-5">
        <div className="grid gap-4 grid-cols-2 max-md:grid-cols-1">
          {showAgentList.map((item) => (
            <div
              key={item.agent_id}
              className="flex items-center p-3 bg-[#F8F9FA] rounded-lg cursor-pointer"
              onClick={() => handleSelect(item)}
            >
              <img
                src={item.logo}
                className="mr-2 size-8 rounded-md"
                alt={item.name}
                onError={handleImageError}
              />
              <div className="flex-1 overflow-hidden">
                <h3 className="text-base font-medium text-primary mb-1">
                  {item.name}
                </h3>
                <p className="text-sm text-secondary truncate">
                  {item.description || t("common.no_description")}
                </p>
              </div>
            </div>
          ))}
        </div>
        {showAgentList.length === 0 && (
          <Empty
            description={t("common.no_data")}
            image={getPublicPath("/images/chat/completion_empty.png")}
          />
        )}
      </div>
    </div>
  );

  return (
    <Tooltip
      ref={tooltipRef}
      open={visible}
      color="white"
      trigger="click"
      onOpenChange={setVisible}
      placement={isSmScreen ? "bottom" : "topLeft"}
      title={content}
      classNames={{
        container: "w-[596px] max-md:w-full",
      }}
    >
      {children}
    </Tooltip>
  );
}
