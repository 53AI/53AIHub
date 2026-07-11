import { useEffect, useState, useMemo } from "react";
import { t } from "@/locales";
import { useSearchParams } from "react-router-dom";
import { PageLayoutTabs } from "@/components/PageLayout";
import { PlatformModel } from "./Model";
import { PlatformAgent } from "./Agent";
import { PlatformWebSearch } from "./WebSearch";
import { PlatformFileParser } from "./FileParser";
import { PaymentPage } from "../payment";
import { VERSION_MODULE } from "@/constants/enterprise";
import { useVersion } from "@/hooks";
import { useEnterpriseStore } from "@/stores";
import { includeKm } from "@/utils/config";

const VALID_TAB_NAMES = [
  "model",
  "agent",
  "online",
  "viewer",
  "parse",
] as const;

export function PlatformPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("model");
  const enterpriseStore = useEnterpriseStore();

  const { canUse: canUseAgent } = useVersion({ module: VERSION_MODULE.AGENT });
  const { canUse: canUseKnowledgeBase } = useVersion({ module: VERSION_MODULE.KNOWLEDGE_BASE });
  const { canUse: canUseRegisteredUser } = useVersion({ module: VERSION_MODULE.REGISTERED_USER });

  // Handle tab change
  const handleTabChange = (key: string) => {
    setActiveTab(key);
    setSearchParams({ tab: key });
  };

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && VALID_TAB_NAMES.includes(tab as any)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Tab items
  const tabs = useMemo(() => {
    const items = [
      {
        key: "model",
        label: t("module.large_model"),
        children: <PlatformModel />,
      },
    ];

    if (canUseAgent) {
      items.push({
        key: "agent",
        label: t("module.agent"),
        children: <PlatformAgent />,
      });
    }

    // Include KM tabs based on environment
    if (includeKm && canUseKnowledgeBase) {
      items.push(
        {
          key: "online",
          label: t("module.online_search"),
          children: <PlatformWebSearch />,
        },

        {
          key: "parse",
          label: t("module.document_parse"),
          children: <PlatformFileParser />,
        },
      );
    }

    // Payment tab
    if (
      canUseRegisteredUser &&
      !enterpriseStore.info.is_enterprise
    ) {
      items.push({
        key: "payment",
        label: t("module.payment"),
        children: <PaymentPage />,
      });
    }

    return items;
  }, [enterpriseStore.info.is_enterprise, canUseAgent, canUseKnowledgeBase, canUseRegisteredUser]);

  return (
    <PageLayoutTabs
      header={t("module.platform_center")}
      tabs={tabs}
      activeKey={activeTab}
      onTabChange={handleTabChange}
      syncUrl={false}
    />
  );
}

export default PlatformPage;
