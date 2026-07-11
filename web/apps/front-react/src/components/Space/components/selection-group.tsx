import { Checkbox } from "antd";
import type { SpaceItem } from "@/api/modules/spaces";
import type { LibraryItem } from "@/api/modules/libraries";
import type { FileItem } from "@/api/modules/files/types";
import { getPublicPath, api_host } from "@/utils/config";

// ==================== 类型定义 ====================
const DEFAULT_ICON = getPublicPath("/images/file-default.png");

// 获取完整图标URL，如果不是https开头则加上后台域名
const getIconUrl = (icon?: string): string => {
  if (!icon) return DEFAULT_ICON;
  if (icon.startsWith("https://") || icon.startsWith("http://")) return icon;
  return `${api_host}${icon.startsWith("/") ? "" : "/"}${icon}`;
};

// 基础选择项类型
export interface SelectionItemBase {
  id: string | number;
  name: string;
  icon?: string;
}

// 选择列表项 Props
export interface SelectionListItemProps {
  item: SelectionItemBase;
  title: string;
  selected: boolean;
  subtitle?: string;
  onClick?: (e?: React.MouseEvent) => void;
}

// 分组 Props
export interface SelectionGroupProps<T extends SelectionItemBase> {
  title: string;
  items: T[];
  selectedIds: (string | number)[];
  allowSelect?: boolean;
  getSubtitle?: (item: T) => string | undefined;
  onToggle?: (item: T, e?: React.MouseEvent) => void;
}

// 公共 Props（recent-access 和 search-result 共享）
export interface CommonSelectionProps {
  selectedSpaces: SpaceItem[];
  selectedLibraries: LibraryItem[];
  selectedFiles: FileItem[];
  allowSelectLibrary: boolean;
  allowSelectSpace: boolean;
  onToggleSpace: (item: SpaceItem, e?: React.MouseEvent) => void;
  onToggleLibrary: (item: LibraryItem, e?: React.MouseEvent) => void;
  onToggleFile: (item: FileItem) => void;
}

// ==================== 列表项组件 ====================
export function SelectionListItem({
  item,
  title,
  selected,
  subtitle,
  onClick,
}: SelectionListItemProps) {
  // 知识类型（title 以"知识"开头）直接使用 icon，其它情况需要处理 URL
  const iconSrc = (!title.startsWith('空间') && !title.startsWith('知识库'))
    ? (item.icon || DEFAULT_ICON)
    : getIconUrl(item.icon);

  return (
    <div
      className={`h-9 flex items-center mb-1 px-2 gap-2 rounded cursor-pointer ${selected ? "hover:bg-[#EDF3FF]" : "hover:bg-[#F2F3F5]"}`}
      onClick={onClick}
    >
      <Checkbox checked={selected} />
      <img src={iconSrc} className="size-5" alt="" />
      <span className="flex-1 text-sm truncate">{item.name}</span>
      {subtitle && <span className="text-xs text-[#999] truncate w-1/2">{subtitle}</span>}
    </div>
  );
}

// ==================== 分组组件 ====================
export function SelectionGroup<T extends SelectionItemBase>({
  title,
  items,
  selectedIds,
  allowSelect = true,
  getSubtitle,
  onToggle,
}: SelectionGroupProps<T>) {
  if (!allowSelect || items.length === 0) return null;

  return (
    <div>
      <div className="h-9 px-2 flex items-center text-sm text-secondary">{title}</div>
      {items.map((item) => (
        <SelectionListItem
          key={item.id}
          item={item}
          title={title}
          selected={selectedIds.includes(item.id)}
          subtitle={getSubtitle?.(item)}
          onClick={(e) => onToggle?.(item, e)}
        />
      ))}
    </div>
  );
}
