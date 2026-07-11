import { useState, Suspense, lazy, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Spin, Switch } from "antd";
import { PageLayoutContent, PageLayoutTabs } from "@/components/PageLayout";
import { t } from "@/locales";
import type { AgentInfo } from "@/api/modules/agents/index";
import { getPublicPath } from "@/utils/config";

const Setting = lazy(() => import("./Setting"));
const Feedback = lazy(() => import("./Feedback"));
const Statistic = lazy(() => import("./Statistic"));

export function AssistantMapPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("setting");
  const [agentMap, setAgentMap] = useState<AgentInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const settingRef = useRef<any>(null);

  const handleBack = () => {
    navigate("/knowledge?tab=assistant");
  };

  const handleStatusChange = (enable: boolean) => {
    settingRef.current?.handleStatusChange(enable);
  };

  const handleAgentChange = (agent: AgentInfo) => {
    setAgentMap(agent);
  };

  const handleLoading = (loading: boolean) => {
    setIsLoading(loading);
  };

  const tabs = useMemo(
    () => [
      {
        key: "setting",
        label: t("agent.app_setting"),
        children: (
          <Suspense fallback={<Spin />}>
            <Setting
              ref={settingRef}
              onAgentChange={handleAgentChange}
              onLoading={handleLoading}
            />
          </Suspense>
        ),
      },
      {
        key: "statistic",
        label: t("agent.app_statistic"),
        children: (
          <Suspense fallback={<Spin />}>
            <Statistic agentId={agentMap?.agent_id} />
          </Suspense>
        ),
      },
      {
        key: "feedback",
        label: t("agent.app_feedback"),
        children: (
          <Suspense fallback={<Spin />}>
            <Feedback agentId={agentMap?.agent_id} />
          </Suspense>
        ),
      },
    ],
    [agentMap?.agent_id],
  );

  return (
    <PageLayoutContent
      header={{
        title: t("module.knowledge_space"),
        back: true,
        onBack: handleBack,
      }}
      scrollable={false}
    >
      <Spin
        spinning={isLoading}
        classNames={{
          root: "h-full",
          container: "h-full flex flex-col",
        }}
      >
        <div className="flex items-center justify-between gap-4 mb-4 px-4 pt-4">
          <img
            className="flex-none size-[60px]"
            src={getPublicPath("/images/document-app/map.png")}
            alt=""
          />
          <div className="flex-1">
            <h2 className="text-2xl text-primary m-0">
              {t("module.document_map")}
            </h2>
            <p className="text-sm text-placeholder m-0 mt-2">
              {t("module.document_map_desc")}
            </p>
          </div>
          {activeTab === "setting" && agentMap && (
            <div className="flex items-center gap-1">
              <Switch checked={agentMap.enable} onChange={handleStatusChange} />
              <span className="text-sm text-brand">
                {agentMap.enable ? t("action_enable") : t("action_disable")}
              </span>
            </div>
          )}
        </div>
        <PageLayoutTabs
          className="flex-1 min-h-0"
          tabs={tabs}
          activeKey={activeTab}
          onTabChange={setActiveTab}
          embedded
          tabsClassName="[&_.ant-tabs-nav]:px-4"
        />
      </Spin>
    </PageLayoutContent>
  );
}
