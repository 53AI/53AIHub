import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { t } from "@/locales";
import { PageLayoutTabs } from "@/components/PageLayout";
import { LazyPage } from "@/components/LazyPage";
import { useEnterpriseStore } from "@/stores";
import { useVersion } from "@/hooks";
import { VERSION_MODULE } from "@/constants/enterprise";
import { UserRegisterList } from "./index";

type TabKey = "register" | "subscription" | "order";

export function UserRegisterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>("register");
  const enterpriseStore = useEnterpriseStore();
  const { canUse: canUseAgent } = useVersion({ module: VERSION_MODULE.AGENT });

  const showSubscriptionTabs = useMemo(
    () =>
      enterpriseStore.info?.is_independent || enterpriseStore.info?.is_industry,
    [enterpriseStore.info],
  );

  const showOrderTab = canUseAgent;

  useEffect(() => {
    const tab = searchParams.get("tab") as TabKey;
    const validTabs: TabKey[] = ["register", "subscription", "order"];
    if (tab && validTabs.includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (key: string) => {
    setActiveTab(key as TabKey);
    setSearchParams({ tab: key });
  };

  const tabs = useMemo(() => {
    const tabList = [
      {
        key: "register",
        label: t("register_user.title"),
        children: <UserRegisterList />,
      },
    ];

    if (showSubscriptionTabs) {
      tabList.push({
        key: "subscription",
        label: t("module.subscription"),
        children: (
          <LazyPage
            loader={() =>
              import("@/views/subscription").then((m) => m.SubscriptionPage)
            }
          />
        ),
      });

      if (showOrderTab) {
        tabList.push({
          key: "order",
          label: t("module.operation_order"),
          children: (
            <LazyPage
              loader={() => import("@/views/order").then((m) => m.OrderPage)}
            />
          ),
        });
      }
    }

    return tabList;
  }, [showSubscriptionTabs, showOrderTab]);

  return (
    <PageLayoutTabs
      header={t("register_user.title")}
      tabs={tabs}
      activeKey={activeTab}
      onTabChange={handleTabChange}
      syncUrl={false}
    />
  );
}

export default UserRegisterPage;
