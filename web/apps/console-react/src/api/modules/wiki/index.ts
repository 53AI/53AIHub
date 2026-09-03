import service from '@/api/config';
import { handleError } from '@/api/errorHandler';

import type {
  WikiCategory,
  WikiCategoryDraftResponse,
  WikiCategoryGrowthMode,
  WikiCategoryListRequest,
  WikiCategoryListResponse,
  WikiCategoryUpsertRequest,
  WikiStylePreset,
  WikiTargetType,
} from './types';

/** 空间 Wiki 分类管理接口 | /api/spaces/{space_id}/wiki/categories */
export const wikiCategoriesApi = {
  /** 列表（默认返回 enabled + disabled 全部分类） */
  list(
    space_id: string,
    params?: WikiCategoryListRequest,
  ): Promise<WikiCategoryListResponse> {
    return service
      .get(`/api/spaces/${space_id}/wiki/categories`, { params })
      .then((res) => res.data)
      .catch(handleError);
  },

  get(space_id: string, category_id: string): Promise<WikiCategory> {
    return service
      .get(`/api/spaces/${space_id}/wiki/categories/${category_id}`)
      .then((res) => res.data)
      .catch(handleError);
  },

  create(space_id: string, data: WikiCategoryUpsertRequest): Promise<WikiCategory> {
    return service
      .post(`/api/spaces/${space_id}/wiki/categories`, data)
      .then((res) => res.data)
      .catch(handleError);
  },

  update(
    space_id: string,
    category_id: string,
    data: WikiCategoryUpsertRequest,
  ): Promise<WikiCategory> {
    return service
      .put(`/api/spaces/${space_id}/wiki/categories/${category_id}`, data)
      .then((res) => res.data)
      .catch(handleError);
  },

  remove(space_id: string, category_id: string): Promise<boolean> {
    return service
      .delete(`/api/spaces/${space_id}/wiki/categories/${category_id}`)
      .then((res) => Boolean(res.data))
      .catch(handleError);
  },

  /** 写作风格预设（3 个） */
  stylePresets(space_id: string): Promise<WikiStylePreset[]> {
    return service
      .get(`/api/spaces/${space_id}/wiki/categories/style-presets`)
      .then((res) => res.data)
      .catch(handleError);
  },

  /** 目标实体类型列表（分类可选的「主目标实体」枚举） */
  targetTypes(space_id: string): Promise<WikiTargetType[]> {
    return service
      .get(`/api/spaces/${space_id}/wiki/categories/target-types`)
      .then((res) => res.data)
      .catch(handleError);
  },

  /** AI 生成分类草稿（按生长模式生成，默认固定结构） */
  generateDrafts(
    space_id: string,
    growth_mode: WikiCategoryGrowthMode = "fixed",
  ): Promise<WikiCategoryDraftResponse> {
    return service
      .post(`/api/spaces/${space_id}/wiki/category-drafts`, { growth_mode })
      .then((res) => res.data)
      .catch(handleError);
  },
};

export default wikiCategoriesApi;
export * from './types';