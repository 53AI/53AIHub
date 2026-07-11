import { memo, useState, useRef, useEffect } from "react";
import { DownOutlined } from "@ant-design/icons";
import type { IAgentInfo } from "../../adapters/types";

export interface AgentTooltipProps {
  /** 当前智能体 */
  currentAgent: IAgentInfo;
  /** 可选智能体列表 */
  agents: IAgentInfo[];
  /** 选择回调 */
  onSelect: (agent: IAgentInfo) => void;
  /** 触发器样式 */
  className?: string;
}

const DEFAULT_IMG = "/images/default_agent.png";

function handleImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const target = e.target as HTMLImageElement;
  if (target.src.endsWith(DEFAULT_IMG)) return;
  target.src = DEFAULT_IMG;
}

function AgentTooltipInner({
  currentAgent,
  agents,
  onSelect,
  className = "",
}: AgentTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 过滤掉当前智能体
  const availableAgents = agents.filter(
    (agent) => agent.agent_id !== currentAgent.agent_id
  );

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (agent: IAgentInfo) => {
    onSelect(agent);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className="h-8 px-2 rounded-full flex items-center gap-1.5 bg-[#F1F2F3] cursor-pointer hover:bg-[#E1E2E3]"
        onClick={() => setIsOpen(!isOpen)}
      >
        <img
          className="w-4 h-4 rounded-full"
          src={currentAgent.logo || DEFAULT_IMG}
          alt={currentAgent.name}
          onError={handleImageError}
        />
        <span className="text-sm text-[#1F2123] line-clamp-1 max-w-[120px]">
          {currentAgent.name}
        </span>
        <DownOutlined style={{ color: "#333333", fontSize: "12px" }} />
      </div>

      {isOpen && availableAgents.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-64 max-h-64 overflow-y-auto bg-white rounded-lg shadow-lg border z-20">
          {availableAgents.map((agent) => (
            <div
              key={agent.agent_id}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F5F5F5]"
              onClick={() => handleSelect(agent)}
            >
              <img
                className="w-6 h-6 rounded-full"
                src={agent.logo || DEFAULT_IMG}
                alt={agent.name}
                onError={handleImageError}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#1F2123] truncate">{agent.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {agent.description || ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const AgentTooltip = memo(AgentTooltipInner);
AgentTooltip.displayName = "AgentTooltip";

export default AgentTooltip;