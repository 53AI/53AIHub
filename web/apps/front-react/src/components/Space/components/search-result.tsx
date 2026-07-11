import { Spin, Empty } from "antd";
import type { SpaceItem } from "@/api/modules/spaces";
import type { LibraryItem } from "@/api/modules/libraries";
import type { FileItem } from "@/api/modules/files/types";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";
import { formatFileInfo } from "@/api/modules/files/transform";
import { SelectionGroup } from "./selection-group";

// 搜索结果项类型
export interface FileSearchResultItem {
  file_id: number;
  library_id: number;
  library_name: string;
  space_id: number;
  space_name: string;
  path: string;
  file_name?: string;
  base_name?: string;
  highlight: string;
  type: number;
  score: number;
  creator_id?: number;
  creator_name?: string;
  is_deleted?: boolean;
  latest_file_body_update_time?: number;
}

interface SearchResultProps {
  // 搜索结果数据
  searchSpaces: SpaceItem[];
  searchLibraries: LibraryItem[];
  searchFiles: FileSearchResultItem[];
  searchLoading: boolean;
  searchQuery: string;

  // 已选项
  selectedSpaces: SpaceItem[];
  selectedLibraries: LibraryItem[];
  selectedFiles: FileItem[];

  // 开关
  allowSelectLibrary: boolean;
  allowSelectSpace: boolean;

  // 回调
  onToggleSpace: (item: SpaceItem) => void;
  onToggleLibrary: (item: LibraryItem) => void;
  onToggleSearchFile: (item: FileSearchResultItem) => void;
}

export function SearchResult({
  searchSpaces,
  searchLibraries,
  searchFiles,
  searchLoading,
  searchQuery,
  selectedSpaces,
  selectedLibraries,
  selectedFiles,
  allowSelectLibrary,
  allowSelectSpace,
  onToggleSpace,
  onToggleLibrary,
  onToggleSearchFile,
}: SearchResultProps) {
  // 转换为选择项格式
  const spaceItems = searchSpaces.map((item) => ({
    id: item.id,
    name: item.name,
    icon: item.icon,
  }));

  const libraryItems = searchLibraries.map((item) => ({
    id: item.id,
    name: item.name,
    icon: item.icon,
  }));

  const fileItems = searchFiles.map((item) => {
    // 从 path 提取文件名（如果有 file_name 则使用，否则从 path 提取）
    const fileName = item.file_name || item.path.split('/').pop() || '';
    const { icon: fileIcon, fname } = formatFileInfo(fileName, false);
    return {
      id: item.file_id,
      name: fname,
      icon: fileIcon,
      highlight: item.highlight,
      space_name: item.space_name,
      raw: item,
    };
  });

  return (
    <div className="h-[500px] overflow-y-auto border rounded py-1 px-2">
      <Spin spinning={searchLoading}>
        <div className="h-[500px]">
        <SelectionGroup
          title={`空间 (${searchSpaces.length})`}
          items={spaceItems}
          selectedIds={selectedSpaces.map((s) => s.id)}
          allowSelect={allowSelectSpace}
          onToggle={(item) => onToggleSpace(searchSpaces.find((s) => s.id === item.id)!)}
        />

        <SelectionGroup
          title={`知识库 (${searchLibraries.length})`}
          items={libraryItems}
          selectedIds={selectedLibraries.map((l) => l.id)}
          allowSelect={allowSelectLibrary}
          onToggle={(item) => onToggleLibrary(searchLibraries.find((l) => l.id === item.id)!)}
        />

        <SelectionGroup
          title={`知识 (${searchFiles.length})`}
          items={fileItems}
          selectedIds={selectedFiles.map((f) => f.id)}
          allowSelect={true}
          getSubtitle={(item) => item.space_name}
          onToggle={(item) => onToggleSearchFile(item.raw)}
        />

        {/* 空状态 */}
        {!searchLoading &&
          searchSpaces.length === 0 &&
          (!allowSelectLibrary || searchLibraries.length === 0) &&
          searchFiles.length === 0 &&
          searchQuery && (
            <div className="mt-20">
              <Empty
                image={getPublicPath("/images/empty.png")}
                description={t("common.no_data")}
              />
            </div>
          )}
        </div>
      </Spin>
    </div>
  );
}
