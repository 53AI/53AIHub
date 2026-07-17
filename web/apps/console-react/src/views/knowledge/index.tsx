import { useEffect, useState } from "react";
import { t } from "@/locales";
import { useSearchParams } from "react-router-dom";
import { PageLayoutTabs } from "@/components/PageLayout";
import { SpacePage } from "@/views/space";
import { KnowledgeCleaningPolicy } from "./cleaning-pipeline";
import { KnowledgeModel } from "./model";
import { AssistantPage } from "@/views/assistant";
import { getPublicPath } from "@/utils/config";

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("space");

  // Handle tab change
  const handleTabChange = (key: string) => {
    setActiveTab(key);
    setSearchParams({ tab: key });
  };

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const tabs = [
    { key: "space", label: t("module.space"), children: <SpacePage /> },

    {
      key: "cleaning-pipeline",
      label: t("module.cleaning_pipeline"),
      children: <KnowledgeCleaningPolicy />,
    },
    {
      key: "model",
      label: t("module.model_setting"),
      children: <KnowledgeModel activeTab={activeTab} />,
    },
    {
      key: "assistant",
      label: t("module.document_app"),
      children: <AssistantPage />,
    },
  ];

  return (
    <PageLayoutTabs
      header={{
        title: t("module.knowledge"),
        description: t("knowledge.desc"),
        icon: {
          src: getPublicPath("/images/space/knowledge-icon.png"),
          bgColor: "shadow-blue-200/50",
          className: "size-full",
        },
      }}
      tabs={tabs}
      activeKey={activeTab}
      onTabChange={handleTabChange}
    />
  );
}

export default KnowledgePage;
