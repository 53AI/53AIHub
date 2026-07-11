import { Tabs } from "antd";
import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "./PageHeader";
import type { PageLayoutTabsProps } from "./types";

export function PageLayoutTabs({
  header,
  tabs,
  activeKey: controlledActiveKey,
  onTabChange,
  syncUrl = true,
  urlParamName = "tab",
  className = "",
  tabsClassName = "",
  footer,
  embedded = false,
}: PageLayoutTabsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [internalActiveKey, setInternalActiveKey] = useState<string>(
    tabs[0]?.key || "",
  );

  // 过滤可见的 tabs
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => tab.visible !== false),
    [tabs],
  );

  // 受控/非受控模式
  const activeKey = controlledActiveKey ?? internalActiveKey;

  // 从 URL 初始化
  useEffect(() => {
    if (syncUrl) {
      const urlTab = searchParams.get(urlParamName);
      if (urlTab && visibleTabs.some((t) => t.key === urlTab)) {
        setInternalActiveKey(urlTab);
      }
    }
  }, [searchParams, urlParamName, visibleTabs]);

  const handleTabChange = (key: string) => {
    setInternalActiveKey(key);
    onTabChange?.(key);

    if (syncUrl) {
      setSearchParams({ [urlParamName]: key });
    }
  };

  const tabItems = visibleTabs.map((tab) => ({
    key: tab.key,
    label: tab.label,
    children: tab.children,
  }));

  // 嵌套模式：只渲染内容区
  if (embedded) {
    return (
      <div className={`h-full flex flex-col ${className}`}>
        {header && <PageHeader config={header} className="mb-4" />}
        <Tabs
          activeKey={activeKey}
          items={tabItems}
          onChange={handleTabChange}
          className={`flex-1 overflow-hidden [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-tabpane]:overflow-y-auto ${tabsClassName}`}
        />
        {footer && <div className="flex-none border-t px-4 py-5">{footer}</div>}
      </div>
    );
  }

  // 独立模式：完整的外层容器
  return (
    <div className={`px-[60px] py-8 h-full flex flex-col ${className}`}>
      {header && <PageHeader config={header} />}
      <div className="mt-2 flex-1 flex flex-col bg-white overflow-hidden">
        <Tabs
          activeKey={activeKey}
          items={tabItems}
          onChange={handleTabChange}
          className={`flex-1 overflow-hidden [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-tabpane]:overflow-y-auto ${tabsClassName}`}
        />
        {footer && <div className="flex-none border-t px-4 py-5">{footer}</div>}
      </div>
    </div>
  );
}
