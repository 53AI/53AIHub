import { useMemo, useCallback } from "react";
import {
  ChatView as ChatViewBase
} from "@km/shared-business/chat";
import type { IAgentInfo } from "@km/shared-business/chat";
import { isOpenClawCompatibleAgentType } from "@km/shared-business/agent-create";
import AuthTagGroup from "../../components/AuthTagGroup";
import { checkPermission as checkUserPermission } from "../../utils/permission";
import { agentUploadApi } from "../../adapters/upload";
import { api_host } from '../../config/api';

interface ChatViewProps {
  agentId?: string;
  agentInfo?: IAgentInfo;
}

function useUrlParams() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      agentIdFromUrl: params.get("agent_id") || "0",
      initialConversationId: params.get("conversation_id") || "",
      timeout: params.get("timeout") ? Number(params.get("timeout")) : 0,
      mode: params.get("mode") || "",
      type: params.get("type") || "",
    };
  }, []);
}

function ChatViewInner({ agentId: agentIdProp, agentInfo: agentInfoProp }: ChatViewProps) {
  const { initialConversationId, timeout, mode, type } = useUrlParams();

  // 判断是否是 SSO 登录（URL 有 username 参数）
  const isSsoLogin = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return !!params.get("username");
  }, []);

  // Use prop-provided agentId first, fallback to URL param
  const agentId = agentIdProp || agentInfoProp?.agent_id || "0";

  const customConfigObj = agentInfoProp?.custom_config_obj || {};
  const settingsObj = agentInfoProp?.settings_obj || {};

  // 判断是否为 Openclaw 智能体（URL 参数或智能体属性）
  const isOpenclaw = isOpenClawCompatibleAgentType(type) || isOpenClawCompatibleAgentType(customConfigObj.agent_type);

  const fileUploadEnabled = !!(settingsObj.file_parse?.enable || settingsObj.image_parse?.enable);

  const uploadRequest = useCallback(async (file: File) => {
    const res = await agentUploadApi.upload(file, "my_uploads");
    return {
      id: res.data.id,
      url: res.data.preview_key ? `${api_host}/api/preview/${res.data.preview_key}` : "",
      name: res.data.file_name,
      size: res.data.size,
      mime_type: res.data.mime_type,
      preview_key: res.data.preview_key,
    };
  }, []);

  const acceptTypes = useMemo(() => {
    let accept = "";
    if (settingsObj.file_parse?.enable) {
      accept += ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.html,.json,.xml,.md";
    }
    if (settingsObj.image_parse?.enable) {
      accept += ",image/*";
    }
    return accept || "*/*";
  }, [settingsObj]);

  // 权限检查回调
  const handleCheckPermission = (userGroupIds?: number[]): boolean => {
    // 开放登录跳过权限检查
    if (!isSsoLogin) return true;
    return checkUserPermission({
      groupIds: userGroupIds || [],
    });
  };
  // Chat Mode
  return (
    <ChatViewBase
      agentId={agentId}
      agentInfo={agentInfoProp}
      initialConversationId={initialConversationId}
      syncToUrl={false}
      history={{ enabled: !isOpenclaw }}
      newConversation={{ enabled: !isOpenclaw }}
      fileUpload={{
        enabled: fileUploadEnabled,
        request: uploadRequest,
        acceptTypes: acceptTypes,
        enableDrag: fileUploadEnabled,
        enablePaste: fileUploadEnabled,
        allowMultiple: true,
        allowSendWithFiles: ["53ai_agent", "fastgpt_agent"].includes(customConfigObj.agent_type),
      }}
      openclaw={{
        enabled: isOpenclaw,
      }}
      permission={{
        checkAccess: handleCheckPermission,
      }}
      slots={{
        authTags: isSsoLogin ? (userGroupIds) => (
          <AuthTagGroup value={userGroupIds} label="使用范围" />
        ) : () => (<div className=""></div>),
      }}
    />
  );
}

export function ChatView(props: ChatViewProps) {
  return <ChatViewInner {...props} />;
}

export default ChatView;
