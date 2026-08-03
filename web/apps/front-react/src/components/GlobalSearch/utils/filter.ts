import type { TimeRangeValue, DocTypeValue } from "@/api/modules/global-search/types";
import type { FilterState, FilterParams } from "../types";

/** 时间范围转换为毫秒时间戳（负数表示相对时间） */
export function timeRangeToTimestamp(value: TimeRangeValue): number | undefined {
  if (value === "all") return undefined;

  const dayMap: Record<string, number> = {
    "7d": 7,
    "30d": 30,
    "180d": 180,
    "365d": 365,
  };

  const days = dayMap[value];
  if (!days) return undefined;

  // 返回负数表示相对时间（如 -604800000 = 最近7天）
  return -days * 24 * 60 * 60 * 1000;
}

/** 默认筛选状态 */
export const DEFAULT_FILTER_STATE: FilterState = {
  selectedSpaces: [],
  selectedLibraries: [],
  selectedCreators: [],
  selectedCreatedTime: "all",
  selectedUpdatedTime: "all",
  selectedDocType: "all",
};

/** 将 FilterState 转换为 FilterParams（用于 API 调用） */
export function filterStateToParams(state: FilterState): FilterParams {
  return {
    spaceIds: state.selectedSpaces.map((s) => s.id),
    libraryIds: state.selectedLibraries.map((l) => l.id),
    creatorIds: state.selectedCreators.map((c) => c.user_id),
    fileTypes: state.selectedDocType === "all" ? [] : [state.selectedDocType],
    createdTimeFrom: timeRangeToTimestamp(state.selectedCreatedTime),
    updatedTimeFrom: timeRangeToTimestamp(state.selectedUpdatedTime),
  };
}

/** 判断是否有筛选条件 */
export function hasFilterConditions(params: FilterParams): boolean {
  return (
    params.spaceIds.length > 0 ||
    params.libraryIds.length > 0 ||
    params.creatorIds.length > 0 ||
    params.fileTypes.length > 0 ||
    params.createdTimeFrom !== undefined ||
    params.updatedTimeFrom !== undefined
  );
}