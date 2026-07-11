import React, { useState } from "react";
import { Spin } from "antd";
import { PageLayoutTabs } from "@/components/PageLayout";
import type { AgentInfo } from "@/api/modules/agents/index";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";

// 懒加载子页面
const Setting = React.lazy(() => import("./Setting"));
const Statistic = React.lazy(() => import("./Statistic"));
const Feedback = React.lazy(() => import("./Feedback"));

const WorkAIPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState("setting");
  const [agentChat, setAgentChat] = useState<AgentInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleAgentChange = (agent: AgentInfo) => {
    setAgentChat(agent);
  };

  const handleLoading = (loading: boolean) => {
    setIsLoading(loading);
  };

  const tabs = [
    {
      key: "setting",
      label: t("agent.app_setting"),
      children: (
        <React.Suspense fallback={<Spin />}>
          <Setting
            onAgentChange={handleAgentChange}
            onLoading={handleLoading}
          />
        </React.Suspense>
      ),
    },
    {
      key: "statistic",
      label: t("agent.app_statistic"),
      children: (
        <React.Suspense fallback={<Spin />}>
          <Statistic agentId={agentChat?.agent_id} />
        </React.Suspense>
      ),
    },
    {
      key: "feedback",
      label: t("agent.app_feedback"),
      children: (
        <React.Suspense fallback={<Spin />}>
          <Feedback agentId={agentChat?.agent_id} />
        </React.Suspense>
      ),
    },
  ];

  return (
    <PageLayoutTabs
      header={{
        title: t("module.work_ai"),
        description: t("work_ai.description"),
        icon: {
          src: getPublicPath("/images/work-ai.png"),
          customStyle: {
            background: "linear-gradient(135deg, #61A3FF 0%, #2563EB 100%)",
          },
        },
      }}
      tabs={tabs}
      activeKey={activeTab}
      onTabChange={setActiveTab}
    />
  );
};

export default WorkAIPage;
