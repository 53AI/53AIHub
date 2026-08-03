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
  ParsingCountData,
  RecordingSummaryTemplate,
  SummaryTemplateRequest,
  RecordingFileSummary,
  RecordingFileGroup,
  CreateRecordingFileGroupRequest,
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

  /**
   * 获取解析进度统计
   */
  getParsingCount(params?: { user_ids?: string }): Promise<ParsingCountData> {
    return service
      .get("/api/admin/recordings/parsing-count", { params })
      .then((res: any) => res.data)
      .catch(handleError);
  },

  // ============== 总结模板 CRUD ==============

  /**
   * 获取总结模板列表
   */
  getTemplates(params?: { group_id?: number }): Promise<RecordingSummaryTemplate[]> {
    return service
      .get("/api/admin/recordings/templates", { params })
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 创建总结模板
   */
  createTemplate(data: SummaryTemplateRequest): Promise<RecordingSummaryTemplate> {
    return service
      .post("/api/admin/recordings/templates", data)
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 更新总结模板
   */
  updateTemplate(templateId: string, data: SummaryTemplateRequest): Promise<{ ok: boolean }> {
    return service
      .put(`/api/admin/recordings/templates/${templateId}`, data)
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 删除总结模板
   */
  deleteTemplate(templateId: string): Promise<{ ok: boolean }> {
    return service
      .delete(`/api/admin/recordings/templates/${templateId}`)
      .then((res: any) => res.data)
      .catch(handleError);
  },

  // ============== 文件总结管理 ==============

  /**
   * 后台生成文件总结
   */
  createSummary(fileId: string, templateId: string): Promise<RecordingFileSummary> {
    return service
      .post(`/api/admin/recordings/files/${fileId}/summarize`, null, {
        params: { template_id: templateId },
      })
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 后台获取文件总结列表
   */
  getSummaries(fileId: string): Promise<RecordingFileSummary[]> {
    return service
      .get(`/api/admin/recordings/files/${fileId}/summaries`)
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 后台删除文件总结
   */
  deleteSummary(summaryId: string): Promise<{ ok: boolean }> {
    return service
      .delete(`/api/admin/recordings/summaries/${summaryId}`)
      .then((res: any) => res.data)
      .catch(handleError);
  },

  // ============== 录音文件分组 CRUD ==============

  /**
   * 获取录音文件分组列表
   */
  getGroups(): Promise<RecordingFileGroup[]> {
    return service
      .get("/api/admin/recordings/groups")
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 创建录音文件分组
   */
  createGroup(data: CreateRecordingFileGroupRequest): Promise<RecordingFileGroup> {
    return service
      .post("/api/admin/recordings/groups", data)
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 更新录音文件分组
   */
  updateGroup(groupId: number, data: CreateRecordingFileGroupRequest): Promise<{ ok: boolean }> {
    return service
      .put(`/api/admin/recordings/groups/${groupId}`, data)
      .then((res: any) => res.data)
      .catch(handleError);
  },

  /**
   * 删除录音文件分组
   */
  deleteGroup(groupId: number): Promise<{ ok: boolean }> {
    return service
      .delete(`/api/admin/recordings/groups/${groupId}`)
      .then((res: any) => res.data)
      .catch(handleError);
  }
};

export default recordingApi;