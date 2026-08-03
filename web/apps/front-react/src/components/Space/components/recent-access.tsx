import { useState, useEffect, useMemo } from "react";
import { Spin, Empty } from "antd";
import { getPublicPath } from "@/utils/config";
import recentUsedApi from "@/api/modules/recent-used";
import type { RecentUsedItem } from "@/api/modules/recent-used/types";
import { formatFileInfo } from "@/api/modules/files/transform";
import type { SpaceItem } from "@/api/modules/spaces";
import type { LibraryItem } from "@/api/modules/libraries";
import type { FileItem } from "@/api/modules/files/types";
import { SelectionGroup } from "./selection-group";

interface RecentAccessProps {
  selectedSpaces: SpaceItem[];
  selectedLibraries: LibraryItem[];
  selectedFiles: FileItem[];
  allowSelectLibrary: boolean;
  allowSelectSpace: boolean;
  /** 刷新触发器，改变此值会重新加载数据 */
  refreshTrigger?: number;
  onToggleSpace: (item: SpaceItem, e?: React.MouseEvent) => void;
  onToggleLibrary: (item: LibraryItem, e?: React.MouseEvent) => void;
  onToggleFile: (item: FileItem) => void;
}

export function RecentAccess({
  selectedSpaces,
  selectedLibraries,
  selectedFiles,
  allowSelectLibrary,
  allowSelectSpace,
  refreshTrigger = 0,
  onToggleSpace,
  onToggleLibrary,
  onToggleFile,
}: RecentAccessProps) {
  const [loading, setLoading] = useState(false);
  const [recentItems, setRecentItems] = useState<RecentUsedItem[]>([]);

  useEffect(() => {
    setLoading(true);
    recentUsedApi.list()
      .then(setRecentItems)
      .catch(() => setRecentItems([]))
      .finally(() => setLoading(false));
  }, [refreshTrigger]);

  // 按 resource_type 分组：0=空间, 1=知识库, 2=文件
  const { recentSpaces, recentLibraries, recentFiles } = useMemo(() => {
    const spaces = recentItems.filter((item) => item.resource_type === 0);
    const libraries = recentItems.filter((item) => item.resource_type === 1);
    const files = recentItems.filter((item) => item.resource_type === 2);
    return { recentSpaces: spaces, recentLibraries: libraries, recentFiles: files };
  }, [recentItems]);

  // 转换为选择项格式
  const spaceItems = recentSpaces.map((item) => ({
    id: item.resource_id,
    name: item.name,
    icon: item.icon || "",
  }));

  const libraryItems = recentLibraries.map((item) => ({
    id: item.resource_id,
    name: item.name,
    icon: item.icon || "",
    space_name: item.space_name,
  }));

  const fileItems = recentFiles.map((item) => {
    const { icon, fname } = formatFileInfo(item.path, false);
    return {
      id: item.resource_id,
      name: fname,
      icon,
      space_name: item.space_name,
      library_id: item.library_id,
    };
  });

  return (
    <Spin spinning={loading}>
      <div className="h-[500px] overflow-y-auto border px-2 py-1 rounded-xl space-y-3">
        <SelectionGroup
          title="空间"
          items={spaceItems}
          selectedIds={selectedSpaces.map((s) => s.id)}
          allowSelect={allowSelectSpace}
          onToggle={(item, e) => onToggleSpace({ id: item.id, name: item.name, icon: item.icon || "" } as SpaceItem, e)}
        />

        <SelectionGroup
          title="知识库"
          items={libraryItems}
          selectedIds={selectedLibraries.map((l) => l.id)}
          allowSelect={allowSelectLibrary}
          getSubtitle={(item) => item.space_name}
          onToggle={(item, e) => onToggleLibrary({ id: item.id, name: item.name, icon: item.icon || "" } as LibraryItem, e)}
        />

        <SelectionGroup
          title="知识"
          items={fileItems}
          selectedIds={selectedFiles.map((f) => f.id)}
          getSubtitle={(item) => item.space_name}
          onToggle={(item) => onToggleFile({
            id: item.id,
            name: item.name,
            icon: item.icon || "",
            library_id: item.library_id,
          } as FileItem)}
        />

        {/* 空状态 */}
        {!loading && recentItems.length === 0 && (
          <Empty
            image={getPublicPath("/images/empty.png")}
            description="暂无最近访问记录"
            className="py-20"
          />
        )}
      </div>
    </Spin>
  );
}
