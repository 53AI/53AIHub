import { Suspense, lazy, useMemo, useState, useRef } from "react";
import { Spin } from "antd";
import { CommentOutlined } from "@ant-design/icons";
import { PageLayoutContent, PageLayoutTabs } from "@/components/PageLayout";
import { t } from "@/locales";
import { useSearchParams, useNavigate } from "react-router-dom";
import type { AgentInfo } from "@/api/modules/agents/index";
import "./index.scss";

const Setting = lazy(() => import("./search/index"));
const Feedback = lazy(() => import("./feedback/Feedback"));
const Statistic = lazy(() => import("./record/Record"));

type TabPaneName = "setting" | "statistic" | "feedback" | "";

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [agentSearch, setAgentSearch] = useState<AgentInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const settingRef = useRef<any>(null);

  const activeTab = (searchParams.get("tab") as TabPaneName) || "setting";

  const handleBack = () => {
    navigate("/knowledge?tab=assistant");
  };

  const handleTabChange = (key: string) => {
    navigate(`?tab=${key}`, { replace: true });
  };

  const onAgentChange = (agent: AgentInfo) => {
    setAgentSearch(agent);
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
              onAgentChange={onAgentChange}
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
            <Statistic agentId={agentSearch?.agent_id} />
          </Suspense>
        ),
      },
      {
        key: "feedback",
        label: t("agent.app_feedback"),
        children: (
          <Suspense fallback={<Spin />}>
            <Feedback agentId={agentSearch?.agent_id} />
          </Suspense>
        ),
      },
    ],
    [agentSearch?.agent_id],
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
        <div className="flex items-center gap-4 mb-4 px-4 pt-4">
          <div className="size-[60px] bg-[#5899FC] flex items-center justify-center rounded-lg">
            <CommentOutlined style={{ color: "white", fontSize: 32 }} />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl text-primary">{t("module.search")}</h2>
            <p className="text-sm text-placeholder">{t("module.search_desc")}</p>
          </div>
        </div>
        <PageLayoutTabs
          className="flex-1 min-h-0"
          tabs={tabs}
          activeKey={activeTab}
          onTabChange={handleTabChange}
          embedded
          tabsClassName="[&_.ant-tabs-nav]:px-4"
        />
      </Spin>
    </PageLayoutContent>
  );
}
