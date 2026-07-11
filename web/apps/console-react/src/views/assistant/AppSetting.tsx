import { useEffect, useState, useRef, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button, message, Spin, Image } from "antd";
import { PageLayoutContent } from "@/components/PageLayout";
import { t } from "@/locales";
import PromptInput, { PromptInputRef } from "@/components/Prompt/input";
import { groupApi } from "@/api/modules/group";
import { GROUP_TYPE } from "@/constants/group";
import settingApi from "@/api/modules/setting";
import agentApi, { AgentData } from "@/api/modules/agent";
import { BACKEND_AGENT_TYPE } from "@/constants/platform/config";
import { JSONParse } from "@/utils";
import { debounce } from "@km/shared-utils";
import { SvgIcon } from "@km/shared-components-react";

const DOCUMENT_APPLICATION = "document_application";

interface DocumentAppAgent {
  agent_id: number;
  name: string;
  logo: string;
  description: string;
  input_fields: any[];
  output_fields: any[];
  execution_rule: string;
  is_workflow: boolean;
  user_group_ids: number[];
  field_mapping: Record<string, string>;
  agent_mode: string;
  agent_type: string;
}

export function AppSettingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [allAgents, setAllAgents] = useState<AgentData[]>([]);
  const [currentAgent, setCurrentAgent] = useState<DocumentAppAgent>({
    agent_id: 0,
    name: "",
    logo: "",
    description: "",
    input_fields: [],
    output_fields: [],
    execution_rule: "auto",
    is_workflow: false,
    user_group_ids: [],
    field_mapping: {},
    agent_mode: "",
    agent_type: "",
  });
  const [userScopeData, setUserScopeData] = useState<
    { nickname: string; id: number; user_id?: number }[]
  >([]);
  const promptInputRef = useRef<(PromptInputRef | null)[]>([]);

  const variables = useMemo(() => {
    return [
      {
        label: t("document_variable"),
        children: [
          { label: "{#标题#}", value: "{#title#}" },
          { label: "{#摘要#}", value: "{#summary#}" },
          { label: "{#全文#}", value: "{#fullContent#}" },
        ],
      },
    ];
  }, []);

  const handleBack = () => {
    navigate("/knowledge?tab=assistant");
  };

  const handleSelectVariable = (index: number) => {
    promptInputRef.current[index]?.showTooltip?.();
  };

  const loadAgentList = async () => {
    const { agents = [] } = await agentApi.list({
      params: {
        group_id: 0,
        offset: 0,
        limit: 999,
      },
    });
    setAllAgents(agents);
    return agents;
  };

  const transformCurAgent = (agents: AgentData[]): DocumentAppAgent => {
    const id = searchParams.get("id");
    const agent =
      agents?.find((item: any) => String(item.agent_id) === id) || {};
    let input_fields = agent.settings?.input_fields || [];
    let output_fields = agent.settings?.output_fields || [];
    const is_workflow =
      BACKEND_AGENT_TYPE.WORKFLOW === agent.backend_agent_type;
    if (!is_workflow) {
      input_fields = [
        {
          id: "input",
          type: "text",
          label: "输入",
          variable: "input",
          required: true,
        },
      ];
      output_fields = [
        {
          id: "output",
          type: "text",
          label: "输出",
          variable: "input",
        },
      ];
    }
    const newAgent: DocumentAppAgent = {
      agent_id: agent?.agent_id || 0,
      name: agent.name || "",
      logo: agent.logo || "",
      description: agent.description || "",
      input_fields,
      output_fields,
      execution_rule: "auto",
      is_workflow,
      user_group_ids: agent.user_group_ids as number[],
      field_mapping: input_fields.reduce(
        (acc: Record<string, string>, field: any) => {
          acc[field.id] = "";
          return acc;
        },
        {},
      ),
      agent_mode: agent.custom_config?.agent_mode || "",
      agent_type: agent.custom_config?.agent_type || "",
    };
    setCurrentAgent(newAgent);
    return newAgent;
  };

  const getAgentAppDetail = async (): Promise<DocumentAppAgent | null> => {
    const settingId = searchParams.get("setting_id");
    if (!settingId) return null;
    const { data = {} } = await settingApi.documentApp.detail(
      Number(settingId),
    );
    const agentData = JSONParse(data.value, "{}");
    setCurrentAgent(agentData);
    return agentData;
  };

  const fetchUserData = async (id: number) => {
    const { list = [] } = await groupApi.user_list({
      group_id: id,
      offset: 0,
      limit: 999,
    });
    const merged = [...userScopeData, ...list];
    const map = new Map<number, any>();
    for (const item of merged) {
      const key = Number(item.user_id || 0);
      if (!key) continue;
      if (!map.has(key)) map.set(key, item);
    }
    setUserScopeData(Array.from(map.values()));
  };

  const loadInternalGroupsAndUsers = async (userGroupIds: number[]) => {
    if (!userGroupIds.length) return;
    const internalGroups = await groupApi.list({
      params: { group_type: GROUP_TYPE.INTERNAL_USER },
    });
    const internalGroupIdSet = new Set<number>(
      internalGroups.map((g: any) => Number(g.group_id) || 0),
    );
    const targets = userGroupIds.filter((id: number) =>
      internalGroupIdSet.has(id),
    );

    for (const id of targets) {
      await fetchUserData(id);
    }
  };

  const handleSave = debounce(async () => {
    const id = searchParams.get("id");
    if (!id) return;
    const missingField = currentAgent.input_fields.find(
      (field: any) =>
        field.required && !currentAgent.field_mapping[field.id]?.trim(),
    );
    if (missingField) {
      message.error(
        missingField.label === "输入"
          ? t("form.input_placeholder")
          : t("form.input_placeholder") + missingField.label,
      );
      return;
    }
    const data = {
      key: DOCUMENT_APPLICATION,
      value: JSON.stringify(currentAgent),
    };
    const add = searchParams.get("add");
    const settingId = searchParams.get("setting_id");
    if (add === "true") {
      await settingApi.create(data);
      message.success(t("action_add_success"));
      setTimeout(() => {
        navigate("/knowledge?tab=assistant");
      }, 200);
    } else if (settingId) {
      await settingApi.update(Number(settingId), data);
      message.success(t("action_save_success"));
    }
  }, 200);

  const handleEditAgent = () => {
    window.open(
      `${window.location.origin}/console/#/agent/create-v2?type=${currentAgent.agent_type}&agent_id=${currentAgent.agent_id}&is_new=false`,
      "_blank",
    );
  };

  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    const init = async () => {
      setLoading(true);
      try {
        const add = searchParams.get("add");
        if (add === "true") {
          const agents = await loadAgentList();
          const newAgent = transformCurAgent(agents);
          const userGroupIds = Array.isArray(newAgent.user_group_ids)
            ? newAgent.user_group_ids
                .map((gid: any) => Number(gid))
                .filter((gid: number) => gid > 0)
            : [];
          await loadInternalGroupsAndUsers(userGroupIds);
        } else {
          const agentData = await getAgentAppDetail();
          const userGroupIds = Array.isArray(agentData?.user_group_ids)
            ? agentData.user_group_ids
                .map((gid: any) => Number(gid))
                .filter((gid: number) => gid > 0)
            : [];
          await loadInternalGroupsAndUsers(userGroupIds);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <PageLayoutContent
      header={{
        title: t("module.document_app"),
        back: true,
        onBack: handleBack,
      }}
      scrollable={false}
    >
      <Spin
        spinning={loading}
        classNames={{
          root: "h-full",
          container: "h-full flex flex-col",
        }}
      >
        <div className="flex-1 overflow-auto px-10 py-6">
          <div className="max-w-[880px] mx-auto">
            <div
              className="flex items-center gap-3 p-6 box-border rounded-xl overflow-hidden"
              style={{
                background:
                  "linear-gradient(90deg, rgba(243, 249, 254, 1) 0%, rgba(247, 243, 255, 1) 100%)",
              }}
            >
              <Image
                className="flex-none rounded-full overflow-hidden"
                src={currentAgent.logo}
                width={40}
                height={40}
                fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                preview={false}
              />
              <div className="flex-1 flex flex-col gap-1">
                <div className="text-xl font-semibold text-primary flex justify-between items-center">
                  <span className="flex-1">{currentAgent.name}</span>
                  <Button type="link" className="group" onClick={handleEditAgent}>
                    {t("edit_agent")}
                    <SvgIcon
                      name="jump"
                      width="14"
                      className="ml-1 group-hover:opacity-30"
                    />
                  </Button>
                </div>
                <div className="text-sm text-placeholder break-words whitespace-pre-wrap">
                  {currentAgent.description}
                </div>
              </div>
            </div>

            <div className="mt-5 mb-10 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-placeholder mr-4">{t("usage_range")}</span>
                {userScopeData.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {userScopeData.map((item) => (
                      <div
                        key={item.id}
                        className="border border-[#E6E8EB] rounded p-2 flex items-center gap-1"
                      >
                        <span className="text-placeholder">
                          <SvgIcon name="avatar" width="16" />
                        </span>
                        {item.nickname}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>--</div>
                )}
              </div>

              <div className="my-[30px] w-full h-[1px] bg-[#E6E8EB]"></div>

              <div className="flex gap-4">
                <span className="w-16">
                  {t("agent.relate_app.input_mapping")}
                </span>
                <div className="flex-1 border rounded">
                  <div className="py-4 px-5 max-h-[440px] overflow-y-auto">
                    {currentAgent.input_fields.map(
                      (field: any, index: number) => (
                        <div key={field.id} className="mb-6 relative">
                          <div className="flex items-center justify-between mb-2">
                            <span>
                              {field.label}
                              {field.required && (
                                <span className="text-red-500 ml-1">*</span>
                              )}
                            </span>
                            <span
                              className="text-brand cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectVariable(index);
                              }}
                            >
                              {"#"}
                            </span>
                          </div>
                          <div className="h-28 border rounded w-full">
                            <PromptInput
                              ref={(el) =>
                                (promptInputRef.current[index] = el)
                              }
                              placeholder={t(
                                "form.set_variable_placeholder",
                              )}
                              style={{ height: "100%" }}
                              variables={variables}
                              value={
                                currentAgent.field_mapping[field.id] ?? ""
                              }
                              onChange={(val: string) => {
                                setCurrentAgent((prev) => ({
                                  ...prev,
                                  field_mapping: {
                                    ...prev.field_mapping,
                                    [field.id]: val,
                                  },
                                }));
                              }}
                            />
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>

            <Button className="ml-20" type="primary" onClick={handleSave}>
              {t("action.save")}
            </Button>
          </div>
        </div>
      </Spin>
    </PageLayoutContent>
  );
}

export default AppSettingPage;
