import { useEffect, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { t } from "@/locales";
import { PageLayoutTabs } from "@/components/PageLayout";
import { LazyPage } from "@/components/LazyPage";
import { useEnv } from "@/hooks/useEnv";

type TabKey =
  | "info"
  | "template-style"
  | "navigation"
  | "domain"
  | "statistics";

export function ConfigPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>("info");
  const { isOpLocalEnv, isPrivatePremEnv } = useEnv();

  // Initialize tab from URL query
  useEffect(() => {
    const tab = searchParams.get("tab") as TabKey;
    if (
      tab &&
      ["info", "template-style", "navigation", "domain", "statistics"].includes(
        tab,
      )
    ) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Handle tab change
  const handleTabChange = (key: string) => {
    setActiveTab(key as TabKey);
    navigate({ search: `?tab=${key}` }, { replace: true });
  };

  const tabs = useMemo(
    () => [
      {
        key: "info",
        label: t("module.website_info"),
        children: (
          <LazyPage
            loader={() => import("@/views/info").then((m) => m.InfoPage)}
          />
        ),
      },
      {
        key: "template-style",
        label: t("module.template_style"),
        children: (
          <LazyPage
            loader={() =>
              import("@/views/template-style").then((m) => m.TemplateStylePage)
            }
          />
        ),
      },
      {
        key: "navigation",
        label: t("navigation.title"),
        children: (
          <LazyPage
            loader={() =>
              import("@/views/navigation").then((m) => m.NavigationPage)
            }
          />
        ),
      },
      {
        key: "domain",
        label: t("module.domain"),
        children: (
          <LazyPage
            loader={() => import("@/views/domain").then((m) => m.DomainPage)}
          />
        ),
        visible: !isOpLocalEnv && !isPrivatePremEnv,
      },
      {
        key: "statistics",
        label: t("module.statistics"),
        children: (
          <LazyPage
            loader={() =>
              import("@/views/statistics").then((m) => m.StatisticsPage)
            }
          />
        ),
      },
    ],
    [isOpLocalEnv, isPrivatePremEnv],
  );

  return (
    <PageLayoutTabs
      header={t("action.setting")}
      tabs={tabs}
      activeKey={activeTab}
      onTabChange={handleTabChange}
      syncUrl={false}
    />
  );
}

export default ConfigPage;
