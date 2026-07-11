import service from "../../config";
import { handleError } from "../../error-handler";
import { transformRecordingList, formatFileSize, formatDurationWithUnit } from "./transform";
import type {
  RecordingConfig,
  UpdateRecordingConfigRequest,
  ParserPlatformsData,
  RecordingListRequest,
  RecordingListData,
  RecordingStatsRequest,
  RecordingStats,
} from "./type";
import type { RecordingListDataDisplay, RecordingStatsDisplay } from "./type";

const recordingApi = {
  /**
   * 获取录音配置
   */
  getConfig(): Promise<RecordingConfig> {
    return service
      .get("/api/admin/recordings/config")
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 更新录音配置
   */
  updateConfig(data: UpdateRecordingConfigRequest): Promise<{ ok: boolean }> {
    return service
      .put("/api/admin/recordings/config", data)
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 获取解析平台列表
   */
  getParserPlatforms(): Promise<ParserPlatformsData> {
    return service
      .get("/api/admin/recordings/parser-platforms")
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 获取录音列表
   */
  getRecordings(
    params: RecordingListRequest = {}
  ): Promise<RecordingListDataDisplay> {
    return service
      .get("/api/admin/recordings", { params })
      .then((res: any) => {
        const data = res.data as RecordingListData;
        return {
          items: transformRecordingList(data.items),
          total: data.total,
          offset: data.offset,
          limit: data.limit,
        };
      })
      .catch(handleError);
  },

  /**
   * 获取录音统计
   */
  getStats(params: RecordingStatsRequest = {}): Promise<RecordingStatsDisplay> {
    return service
      .get("/api/admin/recordings/stats", { params })
      .then((res: any) => {
        const data = res.data as RecordingStats;
        return {
          total_count: data.total_count,
          total_file_size: formatFileSize(data.total_file_size),
          total_duration: formatDurationWithUnit(data.total_duration),
        };
      })
      .catch(handleError);
  },
};

export default recordingApi;