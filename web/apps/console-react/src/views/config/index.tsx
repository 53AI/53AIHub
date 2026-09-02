import { useEffect, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { t } from "@/locales";
import { PageLayoutTabs } from "@/components/PageLayout";
import { LazyPage } from "@/components/LazyPage";

type TabKey =
  | "info"
  | "template-style"
  | "navigation"
  | "statistics";

export function ConfigPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey | "">("");

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
    [],
  );

  // 根据 URL tab 解析当前激活页（只考虑可见页）；不存在或无效时回退到第一个可见页
  useEffect(() => {
    const tabKeys = tabs
      .filter((item) => item.visible !== false)
      .map((item) => item.key);
    const urlTab = searchParams.get("tab") as TabKey;
    if (urlTab && tabKeys.includes(urlTab)) {
      setActiveTab(urlTab);
    } else if (tabKeys.length > 0) {
      setActiveTab(tabKeys[0]);
    }
  }, [searchParams, tabs]);

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
