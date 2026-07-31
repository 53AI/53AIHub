import { Button, Space } from "antd";
import { Dropdown, Search, SvgIcon } from "@km/shared-components-react";
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
    <div className="flex items-center justify-between">
      {/* Tab 切换 */}
      <div className="flex flex-none items-center gap-1 bg-[#F5F5F5] p-1 rounded-xl">
        {tabs.map((item) => (
          <div
            key={item.value}
            className={`px-4 py-2 text-sm cursor-pointer transition-colors ${
              activeTab === item.value
                ? "text-[#1D1E1F] font-medium bg-white rounded-md"
                : "text-[#9A9A9A] hover:text-[#666]"
            }`}
            onClick={() => onTabChange(item.value)}
          >
            {item.label}
          </div>
        ))}
      </div>

      {/* 搜索和操作按钮 */}
      <Space>
        <Search
          mode="expanded"
          placeholder={t("mine.search_document")}
          value={keyword}
          onDebouncedChange={onKeywordChange}
          className="max-w-[200px] rounded-lg"
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
              >
                {t("mine.import")}
              </Button>
            </Dropdown>
            <Dropdown
              menu={{ items: uploadActions.createMenuItems }}
              placement="bottomRight"
            >
              <Button type="primary" icon={<SvgIcon name="plus" size={16} />}>
                {t("action.create")}
              </Button>
            </Dropdown>
          </>
        )}
      </Space>
    </div>
  );
}

export default MineHeader;
