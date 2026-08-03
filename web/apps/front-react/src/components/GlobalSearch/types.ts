import type { TimeRangeValue, DocTypeValue } from "@/api/modules/global-search/types";

/** 筛选参数（用于传递给搜索 hook） */
export interface FilterParams {
  spaceIds: string[];
  libraryIds: string[];
  creatorIds: number[];
  fileTypes: string[];
  createdTimeFrom?: number;
  createdTimeTo?: number;
  updatedTimeFrom?: number;
  updatedTimeTo?: number;
}

/** 筛选状态（Filter 组件内部使用的完整状态） */
export interface FilterState {
  selectedSpaces: { id: string; name: string; icon: string }[];
  selectedLibraries: { id: string; name: string; icon: string; space_id: string }[];
  selectedCreators: { user_id: number; nickname: string; avatar?: string }[];
  selectedCreatedTime: TimeRangeValue;
  selectedUpdatedTime: TimeRangeValue;
  selectedDocType: DocTypeValue;
}