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
  // 只依赖 tab 参数的值，而不是整个 searchParams。
  // 兄弟 tab 的 useListState 会持续改写共享 query（intl_acc_*/intl_grp_* 等），
  // 若把整个 searchParams 作为依赖，会在切换瞬间被其状态波动带偏，误把激活 tab 弹回上一项。
  const urlTabParam = searchParams.get(urlParamName);

  // 从 URL 同步 tab：仅在 tab 参数真正变化时执行，忽略无关参数改动
  useEffect(() => {
    if (!syncUrl) return;
    if (!urlTabParam || !visibleTabs.some((t) => t.key === urlTabParam)) return;
    setInternalActiveKey((prev) => (prev === urlTabParam ? prev : urlTabParam));
  }, [urlTabParam, syncUrl, visibleTabs]);

  const handleTabChange = (key: string) => {
    setInternalActiveKey(key);
    onTabChange?.(key);

    if (syncUrl) {
      // 保留其他 query 参数，避免清空兄弟 tab 的 listState 参数而触发其反向重同步
      const params = new URLSearchParams(searchParams);
      params.set(urlParamName, key);
      setSearchParams(params);
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
