import { useMemo } from "react";
import { getOpenClawCompatibleAgentMetadata, useAgentFormStore } from "@km/shared-business/agent-create";
import { AGENT_TYPES } from "@/constants/platform/config";
import ChatContainer from "@/views/chat/ChatContainer";

interface OpenClawEmbeddedChatWorkspaceProps {
  className?: string;
}

function resolveOpenClawVariantLogo(agentType: string) {
  return agentType === AGENT_TYPES.OPENCLAW ? "/images/vibe/openclaw.svg" : `/images/vibe/${agentType}.png`;
}

export function OpenClawEmbeddedChatWorkspace({ className }: OpenClawEmbeddedChatWorkspaceProps) {
  const agentId = useAgentFormStore((state) => state.agent_id);
  const formData = useAgentFormStore((state) => state.form_data);

  const savedAgentId = useMemo(() => {
    if (!agentId || agentId === 0 || agentId === "0") return "";
    return String(agentId);
  }, [agentId]);

  const agentMetadata = useMemo(() => {
    return getOpenClawCompatibleAgentMetadata(formData.custom_config?.agent_type || formData.custom_config?.hostKind);
  }, [formData.custom_config?.agent_type, formData.custom_config?.hostKind]);

  const agentInfo = useMemo(() => {
    if (!savedAgentId) return undefined;
    return {
      agent_id: savedAgentId,
      bot_id: formData.bot_id,
      logo: formData.logo || resolveOpenClawVariantLogo(agentMetadata.agentType),
      name: formData.name || agentMetadata.label,
      description: formData.description,
      channel_type: formData.channel_type || agentMetadata.channelType,
      custom_config_obj: formData.custom_config || {},
      settings_obj: formData.settings || {},
      use_cases: formData.use_cases || [],
      user_group_ids: formData.user_group_ids || [],
      owner_id: 1,
    };
  }, [agentMetadata, formData, savedAgentId]);

  if (!savedAgentId) {
    return (
      <div className={`flex h-full flex-col bg-white ${className || ""}`}>
        <div className="flex-none h-[60px] border-b px-6 flex items-center text-base font-medium text-[#1F2123]">
          预览与调试
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="text-base font-medium text-[#2F3136]">请先保存后调试</div>
          <div className="mt-2 text-sm leading-6 text-[#8B95A5]">
            保存智能体后，会在此处加载 {agentMetadata.label} 会话、历史记录与连接状态。
          </div>
        </div>
      </div>
    );
  }

  return (
    <ChatContainer
      className={className}
      agentId={savedAgentId}
      currentAgentOverride={agentInfo}
      embeddedOpenClawPreview
      disableOpenClawUrlSync
      skipOpenClawFrontStoreMirror
    />
  );
}

export default OpenClawEmbeddedChatWorkspace;
