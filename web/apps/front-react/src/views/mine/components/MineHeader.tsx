import { Button } from "antd";
import { Dropdown, Search, SvgIcon, Tabs } from "@km/shared-components-react";
import { t } from "@/locales";
import type { MenuProps } from "antd";
import type { MineTabKey } from "../types";

export interface TabItem {
  label: string;
  value: MineTabKey;
}

export interface MineHeaderProps {
  tabs: TabItem[];
  activeTab: MineTabKey;
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  onTabChange: (tab: MineTabKey) => void;
  uploadActions?: {
    importMenuItems: MenuProps["items"];
    createMenuItems: MenuProps["items"];
  };
}

/**
 * 我的页面头部组件
 * 包含 Tab 切换、搜索框、操作按钮
 */
export function MineHeader({
  tabs,
  activeTab,
  keyword,
  onKeywordChange,
  onTabChange,
  uploadActions,
}: MineHeaderProps) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      {/* Tab 切换 */}
      <Tabs
        variant="segmented"
        className="flex-none"
        items={tabs.map((item) => ({ key: item.value, label: item.label }))}
        activeKey={activeTab}
        onChange={(key) => onTabChange(key as MineTabKey)}
      />

      {/* 搜索和操作按钮 */}
      <div className="flex items-center gap-2 min-w-0">
        <Search
          mode="expanded"
          placeholder={t("mine.search_document")}
          value={keyword}
          onDebouncedChange={onKeywordChange}
          className="flex-1 min-w-0 md:flex-none md:max-w-[200px] rounded-lg"
        />

        {/* 上传 Tab 操作 */}
        {activeTab === "upload" && uploadActions && (
          <>
            <Dropdown
              menu={{ items: uploadActions.importMenuItems }}
              placement="bottomRight"
            >
              <Button
                color="primary"
                variant="filled"
                icon={<SvgIcon name="download" size={16} />}
                className="flex-none"
              >
                {t("mine.import")}
              </Button>
            </Dropdown>
            <Dropdown
              menu={{ items: uploadActions.createMenuItems }}
              placement="bottomRight"
            >
              <Button
                type="primary"
                icon={<SvgIcon name="plus" size={16} />}
                className="flex-none"
              >
                {t("action.create")}
              </Button>
            </Dropdown>
          </>
        )}
      </div>
    </div>
  );
}

export default MineHeader;
