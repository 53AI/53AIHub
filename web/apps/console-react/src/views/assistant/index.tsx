import { useEffect, useState, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { PlusOutlined, MoreOutlined } from "@ant-design/icons";
import { Modal, message, Spin, Switch } from "antd";
import { Dropdown } from "@km/shared-components-react";
import agentsApi from "@/api/modules/agents/index";
import settingApi from "@/api/modules/setting";
import { AGENT_USAGES } from "@/constants/agent";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import type { AgentInfo } from "@/api/modules/agents/index";
import { getPublicPath } from "@/utils/config";
import RelateAgentsDialog, {
    RelateAgentsDialogRef,
} from "@/views/agent/create/components/config/RelateAgentsDialog";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { VERSION_MODULE } from "@/constants/enterprise";
import { useVersion } from "@/hooks";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";

const DOCUMENT_APPLICATION = "document_application";

export function AssistantPage() {
  const navigate = useNavigate();
  const enterpriseStore = useEnterpriseStore();
  const { canUse: canUseKnowledgeBase } = useVersion({
    module: VERSION_MODULE.KNOWLEDGE_BASE,
  });

  const [chatAgent, setChatAgent] = useState<AgentInfo | null>(null);
  const [mapAgent, setMapAgent] = useState<AgentInfo | null>(null);
  const [customApps, setCustomApps] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const relateAgentsDialogRef = useRef<RelateAgentsDialogRef>(null);

  const loadList = async () => {
    setIsLoading(true);
    try {
      const result = await agentsApi.list({
        agent_usages: `${AGENT_USAGES.KM_FILE_CHAT},${AGENT_USAGES.KM_MAP}`,
      });
      const agentChat = result.agents.find(
        (agent: any) => agent.agent_usage === AGENT_USAGES.KM_FILE_CHAT,
      );
      const agentMap = result.agents.find(
        (agent: any) => agent.agent_usage === AGENT_USAGES.KM_MAP,
      );
      setChatAgent(agentChat ? transformAgentInfo(agentChat) : null);
      setMapAgent(agentMap ? transformAgentInfo(agentMap) : null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAgentAppList = async () => {
    setIsLoading(true);
    try {
      const result = await settingApi.documentApp.list(DOCUMENT_APPLICATION);
      if (result.data && result.data.length > 0) {
        setCustomApps(
          result.data.map((item: any) => {
            return {
              ...JSON.parse(item.value),
              setting_id: item.setting_id,
            };
          }),
        );
      } else {
        setCustomApps([]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleChatEnableChange = async (value: boolean) => {
    if (chatAgent?.agent_id) {
      try {
        await agentsApi.status(chatAgent.agent_id, { enable: value });
        message.success(
          value ? t("action_enable_success") : t("action_disable_success"),
        );
        // Reload to ensure state is synced with server
        loadList();
      } catch (error) {
        console.error("Failed to update chat agent status:", error);
      }
    }
  };

  const handleMapEnableChange = async (value: boolean) => {
    if (mapAgent?.agent_id) {
      try {
        await agentsApi.status(mapAgent.agent_id, { enable: value });
        message.success(
          value ? t("action_enable_success") : t("action_disable_success"),
        );
        // Reload to ensure state is synced with server
        loadList();
      } catch (error) {
        console.error("Failed to update map agent status:", error);
      }
    }
  };

  const handleOpenAddDialog = () => {
    relateAgentsDialogRef.current?.open(customApps);
  };

  const handleSelect = async (item: any) => {
    navigate(`/assistant/app-setting?id=${item.agent_id}&add=true`);
  };

  const handleCommand = (
    command: string,
    agent: { agent_id: number; setting_id: number },
  ) => {
    if (command === "edit") {
      navigate(
        `/assistant/app-setting?id=${agent.agent_id}&setting_id=${agent.setting_id}`,
      );
    } else if (command === "delete") {
      Modal.confirm({
        title: t("app_delete_confirm"),
        content: t("tip"),
        okText: t("action_confirm"),
        cancelText: t("action_cancel"),
        onOk: async () => {
          await settingApi.documentApp.delete(agent.setting_id);
          message.success(t("action_delete_success"));
          loadAgentAppList();
        },
      });
    }
  };

  useEffect(() => {
    loadList();
    loadAgentAppList();
  }, []);

  return (
    <Spin
      spinning={isLoading}
      classNames={{
        root: "h-full",
        container: "h-full",
      }}
    >
      <div className="h-full bg-white py-5 px-2 overflow-auto">
        <div className="text-base text-primary">{t("module.system")}</div>
        <div className="grid grid-cols-3 gap-6 mt-3">
          {/* {!["5bmQZn"].includes(enterpriseStore.info?.eid) &&
            canUseKnowledgeBase && (
              <Link
                to="/search"
                className="border rounded-lg px-4 py-6 hover:shadow block text-inherit"
              >
                <div className="flex items-center justify-between gap-2.5 h-8">
                  <div className="size-6 bg-[#5899FC] flex items-center justify-center rounded">
                    <CommentOutlined style={{ color: "white", fontSize: 16 }} />
                  </div>
                  <div className="flex-1 text-sm font-medium text-primary">
                    {t("module.search")}
                  </div>
                </div>
                <p className="text-xs text-placeholder mt-3">
                  {t("module.search_desc")}
                </p>
              </Link>
            )} */}

          <Link
            to="/assistant/chat"
            className="border rounded-lg px-4 py-6 hover:shadow block text-inherit"
          >
            <div className="flex items-center justify-between gap-2.5 h-8">
              <img
                className="size-6"
                src={getPublicPath("/images/document-app/chat.png")}
                alt="chat"
              />
              <div className="flex-1 text-sm font-medium text-primary">
                {t("module.document_assistant")}
              </div>
              {chatAgent && (
                <div onClick={(e) => e.preventDefault()}>
                  <Switch
                    checked={chatAgent.enable}
                    onChange={handleChatEnableChange}
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-placeholder mt-3">
              {t("module.document_assistant_desc")}
            </p>
          </Link>

          <Link
            to="/assistant/map"
            className="border rounded-lg px-4 py-6 block text-inherit"
          >
            <div className="flex items-center justify-between gap-2.5 h-8">
              <img
                className="size-6"
                src={getPublicPath("/images/document-app/map.png")}
                alt="map"
              />
              <div className="flex-1 text-sm font-medium text-primary">
                {t("module.document_map")}
              </div>
              {mapAgent && (
                <div onClick={(e) => e.preventDefault()}>
                  <Switch
                    checked={mapAgent.enable}
                    onChange={handleMapEnableChange}
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-placeholder mt-3">
              {t("module.document_map_desc")}
            </p>
          </Link>
        </div>

        <div className="mt-6 text-base text-primary">{t("module.custom")}</div>
        <div className="grid grid-cols-3 gap-6 mt-3">
          <div
            className="min-h-[126px] border border-[#E8EEFA] bg-[#F7FAFF] rounded-lg px-4 py-6 flex items-center justify-center cursor-pointer hover:shadow"
            onClick={handleOpenAddDialog}
          >
            <div className="size-10 rounded flex bg-[#E6EEFF] items-center justify-center text-primary">
              <PlusOutlined style={{ fontSize: 16, color: "#2563EB" }} />
            </div>
            <div className="ml-2 text-sm font-medium text-primary text-brand">
              {t("module.add_application")}
            </div>
          </div>

          {customApps.map((agent) => (
            <div
              key={agent.agent_id}
              className="border rounded-lg p-4 relative hover:shadow group cursor-pointer"
            >
              <div className="absolute top-0 right-0 px-2 py-1 bg-gray-100 text-xs text-hint rounded-bl-lg flex items-center gap-1">
                <SvgIcon
                  name={agent?.agent_mode === "chat" ? "agent" : "app-one"}
                  width={16}
                  height={16}
                />
                {agent?.agent_mode === "chat"
                  ? t("agent_type_chat_v2")
                  : t("agent_type_completion_v2")}
              </div>
              <div className="flex items-start justify-between gap-3 mt-2">
                <div className="flex items-center gap-2.5">
                  <img
                    className="size-6"
                    src={
                      agent.logo ||
                      getPublicPath("/images/agent/default-logo.png")
                    }
                    alt="logo"
                  />
                  <div className="flex-1 text-sm font-medium text-primary truncate">
                    {agent.name}
                  </div>
                </div>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: "edit",
                        icon: <SvgIcon name="edit" />,
                        label: t("action_edit"),
                      },
                      {
                        key: "delete",
                        icon: <SvgIcon name="delete" color="#FF4D4F" />,
                        label: (
                          <span className="text-red-500">
                            {t("action_delete")}
                          </span>
                        ),
                      },
                    ],
                    onClick: ({ key }) => handleCommand(key, agent),
                  }}
                  trigger={["click"]}
                >
                  <MoreOutlined
                    className="invisible group-hover:visible cursor-pointer text-gray-400 hover:text-gray-600 rotate-90"
                    onClick={(e) => e.stopPropagation()}
                  />
                </Dropdown>
              </div>
              <p className="text-xs text-placeholder mt-3 line-clamp-2 h-8">
                {agent.description}
              </p>
            </div>
          ))}
        </div>

        <RelateAgentsDialog
          ref={relateAgentsDialogRef}
          onSelect={handleSelect}
        />
      </div>
    </Spin>
  );
}

export default AssistantPage;
