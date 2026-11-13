import { useState, useEffect, useMemo } from "react";
import { RightOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { SafeImage } from "@km/shared-components-react";

import {
  directUseItems,
} from "./components/integrate/config";
import { LinkAndQrContent } from "./components/integrate/LinkAndQrContent";
import { WebEmbedContent } from "./components/integrate/WebEmbedContent";
import { ApiContent } from "./components/integrate/api";
import { BotAccessContent } from "./components/integrate/BotAccessContent";
import { useAgentFormStore } from "@km/shared-business/agent-create";
import agentsApi from "@/api/modules/agents";

interface AgentIntegrateTabProps {
  agentId?: string | number;
  agentType?: string;
}

// 仅小助理（workbench）和 AI搜问（knowledge）开放"接入"入口
// web、链接隐藏，只显示 api 与微信机器人接入
const ASSISTANT_LIKE_TYPES = ['workbench', 'knowledge'];

export function AgentIntegrateTab({ agentId, agentType }: AgentIntegrateTabProps) {
  const formData = useAgentFormStore((state) => state.form_data);
  const currentAgentId = agentId || formData.agent_id;
  const agentName = formData.name;
  const agentLogo = formData.logo;
  const resolvedAgentType = agentType || formData.agent_type || '';
  const isAssistantLike = ASSISTANT_LIKE_TYPES.includes(resolvedAgentType);

  // 默认激活项：助理型直接落到 API；其他维持原状
  const [activeTab, setActiveTab] = useState(isAssistantLike ? "api" : "web");
  const [fixedToken, setFixedToken] = useState<string>("");

  // Fetch or create fixed token at tab level to avoid duplicate requests
  useEffect(() => {
    if (!currentAgentId) return;

    const fetchOrGenerateToken = async () => {
      try {
        const existingToken = await agentsApi.h5.getToken(currentAgentId);
        if (existingToken?.fixed_token) {
          setFixedToken(existingToken.fixed_token);
        } else {
          const res = await agentsApi.h5.generateToken(currentAgentId);
          setFixedToken(res.fixed_token);
        }
      } catch {
        // Token fetch will be retried in child components if needed
      }
    };

    fetchOrGenerateToken();
  }, [currentAgentId]);

  // 助理型（workbench/knowledge）侧栏隐藏 web / 链接，只展示 API 与微信机器人；其他类型全部展示
  const visibleItems = useMemo(() => {
    if (!isAssistantLike) return directUseItems;
    return directUseItems.filter(item => ['api', 'wx_bot'].includes(item.id));
  }, [isAssistantLike]);

  const renderSidebarItem = (item: any) => {
    const isActive = activeTab === item.id;
    return (
      <div
        key={item.id}
        onClick={() => setActiveTab(item.id)}
        className={`flex items-center gap-3 px-4 py-5 mb-3 cursor-pointer rounded-lg border transition-all ${isActive ? "border-[#2563EB] bg-[#FAFCFF]" : "border hover:bg-gray-50"}`}
      >
        {typeof item.icon === "string" ? (
          <SafeImage src={item.icon} alt="" className="size-10"/>
        ) : (
          <div className="size-10 flex items-center justify-center">{item.icon}</div>
        )}
        <div className="flex-1 min-w-0 pr-2">
          <div className="text-base font-medium text-primary truncate">
            {item.title}
          </div>
          <div className="text-xs text-placeholder mt-1 truncate">
            {item.desc}
          </div>
        </div>
        <RightOutlined
          className={`${isActive ? "text-blue-500" : "text-gray-300"} text-xs ml-auto flex-shrink-0 transition-colors`}
        />
      </div>
    );
  };

  return (
    <div className="h-full flex gap-5 bg-[#f8f9fa] px-6 py-5">
      {/* Sidebar */}
      <div className="w-[400px] flex-shrink-0 bg-white rounded-xl border border-gray-200 p-5 overflow-y-auto">
        <div className="mb-6">
          <div className="text-base text-primary mb-3 px-1">{t('integrate.direct_use')}</div>
          {visibleItems.map(renderSidebarItem)}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {!isAssistantLike && activeTab === "web" && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <WebEmbedContent agentId={currentAgentId} agentName={agentName} agentLogo={agentLogo} title={t('integrate.standard_embed')} fixedToken={fixedToken} />
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6 mt-5">
              <WebEmbedContent agentId={currentAgentId} agentName={agentName} agentLogo={agentLogo} title={t('integrate.sso_embed')} sso fixedToken={fixedToken} />
            </div>
          </>
        )}
        {!isAssistantLike && activeTab === "link" && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <LinkAndQrContent agentId={currentAgentId} fixedToken={fixedToken} />
          </div>
        )}
        {activeTab === "api" && (
          <ApiContent agentId={currentAgentId} agentType={resolvedAgentType} />
        )}
        {activeTab === "wx_bot" && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <BotAccessContent agentId={currentAgentId} />
          </div>
        )}
        {!isAssistantLike && activeTab !== "link" && activeTab !== "web" && activeTab !== "api" && activeTab !== "wx_bot" && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <div className="text-4xl mb-4 text-gray-200">
                {directUseItems.find((i) => i.id === activeTab)?.icon}
              </div>
              <div>
                [{directUseItems.find((i) => i.id === activeTab)?.title}] {t('integrate.developing')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentIntegrateTab;
