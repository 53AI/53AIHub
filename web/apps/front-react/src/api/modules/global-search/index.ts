import request from '../../index';
import { handleError } from '../../errorHandler';
import type {
  QuickTagsParams,
  QuickTagsResponse,
  GlobalSearchParams,
  GlobalSearchResponse,
  SpaceSearchParams,
  GlobalSearchSpace,
  LibrarySearchParams,
  GlobalSearchLibrary,
} from './types';

export const globalSearchApi = {
  /**
   * 获取空间和知识库下拉列表
   * @param params.mode - recent_access（默认）或 recent_update
   */
  quickTags(params: QuickTagsParams = {}): Promise<QuickTagsResponse> {
    return request
      .get('/api/global-search/quick-tags', { params })
      .then((res) => res.data)
      .catch(handleError);
  },

  /**
   * 搜索知识文档
   * @param params - 搜索参数
   */
  search(params: GlobalSearchParams): Promise<GlobalSearchResponse> {
    return request
      .post('/api/global-search/search', params)
      .then((res) => res.data)
      .catch(handleError);
  },

  /**
   * 空间搜索（模糊匹配用户有权限的空间）
   * @param params.keyword - 搜索关键词
   * @param params.creator_ids - 创建者筛选
   * @param params.created_time_from - 创建时间起点（时间戳）
   * @param params.updated_time_from - 更新时间起点（时间戳）
   */
  spaces(params: SpaceSearchParams): Promise<GlobalSearchSpace[]> {
    return request
      .get('/api/global-search/spaces', { params })
      .then((res) => res.data.results)
      .catch(handleError);
  },

  /**
   * 知识库搜索（模糊匹配用户有权限的知识库）
   * @param params.keyword - 搜索关键词
   * @param params.space_id - 可选，限定空间
   * @param params.creator_ids - 创建者筛选
   * @param params.created_time_from - 创建时间起点（时间戳）
   * @param params.updated_time_from - 更新时间起点（时间戳）
   */
  libraries(params: LibrarySearchParams): Promise<GlobalSearchLibrary[]> {
    return request
      .get('/api/global-search/libraries', { params })
      .then((res) => res.data.results)
      .catch(handleError);
  },
};

export default globalSearchApi;