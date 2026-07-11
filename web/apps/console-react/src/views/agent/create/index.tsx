import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Spin } from "antd";
import { t } from "@/locales";
import { PageLayoutContent } from "@/components/PageLayout";
import { useAgentFormStore } from "./store";
import {
  AgentDrawer,
  AgentDrawerRef,
  AgentGuide,
  AgentPreview,
  AgentPreviewRef,
} from "./components";
import { AgentForm } from "./platform";
import {
  getAgentByAgentType,
  AgentType,
  AGENT_TYPES,
} from "@/constants/platform/config";
import { eventBus } from "@km/shared-utils";
import { SvgIcon } from "@km/shared-components-react";
import { attachDefaultImg } from "@/directive/default-img";
import ChannelConfigContext from "./context/ChannelConfigContext";

export function AgentCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 从 store 读取状态（单一数据源）
  const agentType = useAgentFormStore((state) => state.agent_type);
  const saving = useAgentFormStore((state) => state.saving);
  const loading = useAgentFormStore((state) => state.loading);
  const initializing = useAgentFormStore((state) => state.initializing);
  const formData = useAgentFormStore((state) => state.form_data);

  const infoDrawerRef = useRef<AgentDrawerRef>(null);
  const previewDrawerRef = useRef<AgentPreviewRef>(null);
  const agentFormRef = useRef<any>(null);
  const channelConfig = useRef<Record<string, any>>({});

  const [title, setTitle] = useState<string>("");

  // 保存
  const onSave = async () => {
    const store = useAgentFormStore.getState();
    if (store.saving) return;

    await infoDrawerRef.current?.handleSave();

    const compRef = agentFormRef.current;
    let savedAgentId = "";

    if (compRef?.save) {
      useAgentFormStore.setState({ saving: true });
      const { data = {} } = await compRef.save().catch(() => {
        useAgentFormStore.setState({ saving: false });
      });
      savedAgentId = data.agent_id;
    } else if (compRef?.validateForm) {
      const valid = await compRef.validateForm();
      if (!valid) return Promise.reject();
      await store.saveAgentData().catch(() => {
        useAgentFormStore.setState({ saving: false });
      });
      savedAgentId = String(useAgentFormStore.getState().agent_id);
    }

    const currentState = useAgentFormStore.getState();
    if (currentState.is_new) {
      eventBus.emit("agent-create");
      if (savedAgentId) {
        navigate(
          {
            pathname: "/agent/create",
            search: `?type=${currentState.agent_type}&agent_id=${savedAgentId}`,
          },
          { replace: true },
        );
      }
    } else {
      eventBus.emit("agent-update");
    }

    useAgentFormStore.setState({ saving: false });
  };

  // 更新标题
  const handleAgentChange = useCallback(() => {
    setTitle(useAgentFormStore.getState().form_data.name);
  }, []);

  // 预览
  const handlePreview = () => {
    previewDrawerRef.current?.open();
  };

  // 取消编辑
  const handleCancel = () => {
    const store = useAgentFormStore.getState();
    useAgentFormStore.setState({
      form_data: { ...store.form_data, name: title },
    });
  };

  // 初始化：创建新智能体
  const initCreate = useCallback(() => {
    const agentType = (searchParams.get("type") as string) || "prompt";
    setTitle(t(searchParams.get("title") || "") || "");

    // 设置 channelConfig
    if (agentType !== AGENT_TYPES.PROMPT) {
      const config = getAgentByAgentType(agentType as AgentType);
      channelConfig.current.name = config.channelName;
      channelConfig.current.channel_type = config.channelType;
    }

    infoDrawerRef.current?.open({
      agent_type: agentType as AgentType,
      group_id: +(searchParams.get("group_id") || "0") || undefined,
      data: {
        channel_config: {
          channel_type: Number(searchParams.get("channel_type") || "0"),
        },
      },
    });

    eventBus.on("agent-change", handleAgentChange);
  }, [searchParams, handleAgentChange]);

  // 初始化：编辑已有智能体
  const initEdit = useCallback(async () => {
    const urlAgentId = Number(searchParams.get("agent_id") || "0");

    // 重置状态
    useAgentFormStore.getState().resetState();
    useAgentFormStore.setState({
      initializing: true,
      agent_id: urlAgentId,
      is_new: false,
    });

    // 加载数据（loadDetailData 会更新 agent_type）
    await useAgentFormStore.getState().loadGroupOptions();
    await useAgentFormStore.getState().loadDetailData();

    // 获取更新后的 agent_type
    const updatedAgentType = useAgentFormStore.getState().agent_type;

    // 设置 channelConfig
    if (updatedAgentType !== AGENT_TYPES.PROMPT) {
      const config = getAgentByAgentType(updatedAgentType as AgentType);
      channelConfig.current.name = config.channelName;
      channelConfig.current.channel_type = config.channelType;
    }

    // 设置标题
    setTitle(useAgentFormStore.getState().form_data.name);

    useAgentFormStore.setState({ initializing: false });

    // 打开 drawer（cache 模式，不重置状态）
    infoDrawerRef.current?.open({
      data: { channel_config: channelConfig.current },
      cache: true,
    });

    eventBus.on("agent-change", handleAgentChange);
  }, [searchParams, handleAgentChange]);

  useEffect(() => {
    const isNew = searchParams.get("is_new") === "true";
    useAgentFormStore.setState({ is_new: isNew });

    if (isNew) {
      initCreate();
    } else {
      initEdit();
    }

    return () => {
      eventBus.off("agent-change", handleAgentChange);
      // 仅在不保存时重置状态，防止保存过程中状态丢失
      const store = useAgentFormStore.getState();
      if (!store.saving) {
        store.resetState();
      }
    };
  }, [searchParams, initCreate, initEdit, handleAgentChange]);

  const logoRef = useRef<HTMLImageElement>(null);
  const handleLogoRef = useCallback((el: HTMLImageElement | null) => {
    if (el) {
      logoRef.current = el;
      attachDefaultImg(el);
    }
  }, []);

  return (
    <ChannelConfigContext.Provider value={channelConfig.current}>
      <PageLayoutContent
        header={{
          title: title || formData.name,
          back: true,
          titlePrefix: formData.logo ? (
            <img
              ref={handleLogoRef}
              src={formData.logo}
              className="w-8 rounded"
              alt=""
            />
          ) : (
            <div className="size-8 rounded" />
          ),
        }}
        contentClassName="flex-1 flex overflow-hidden"
        scrollable={false}
        footer={
          <Button type="primary" loading={saving} onClick={onSave}>
            {t("action_save")}
          </Button>
        }
      >
        <Spin
          spinning={loading}
          classNames={{
            root: "w-full h-full flex overflow-hidden",
            container: "w-full h-full flex overflow-hidden",
          }}
        >
          <div className="w-1/2 p-6 border-r overflow-y-auto">
            <div className="font-bold mb-3">{t("connected_platform")}</div>
            <div className="p-5 bg-[#F7F8FA] rounded">
              <AgentDrawer
                ref={infoDrawerRef}
                onSuccess={() => eventBus.emit("agent-change")}
                onCancel={handleCancel}
              />
            </div>
            <div className="font-bold mt-6 mb-3">{t("usage_guide_desc")}</div>
            <AgentGuide />
          </div>
          <div className="w-1/2 p-6 overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <span className="font-bold">{t("app_config")}</span>
              <Button type="link" className="group" onClick={handlePreview}>
                <SvgIcon
                  name="debug"
                  width="14"
                  className="mr-1 group-hover:opacity-40"
                />
                {t("debug_preview")}
              </Button>
            </div>
            <div id="app-config-full-screen-hook" className="w-full max-h-full">
              <div className="w-full bg-[#F7F8FA]">
                {initializing ? (
                  <div className="flex items-center justify-center h-64">
                    <Spin />
                  </div>
                ) : (
                  <AgentForm
                    ref={agentFormRef}
                    className="flex-1 p-5"
                    agentType={agentType}
                  />
                )}
              </div>
            </div>
          </div>
        </Spin>

        <AgentPreview ref={previewDrawerRef} />
      </PageLayoutContent>
    </ChannelConfigContext.Provider>
  );
}

export default AgentCreatePage;
