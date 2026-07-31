import request from '../../index'
import { handleError } from '../../errorHandler'
import type {
  WikiIndexResponse,
  WikiLogListParams,
  WikiLogListResponse,
  WikiPageDetail,
  WikiPageListParams,
  WikiPageListResponse,
  WikiPageUpdateParams,
  WikiPageUpdateResponse,
  WikiPageVersion,
  WikiProgressResponse,
  WikiStatsResponse,
  WikiVersionPublishParams,
  WikiVersionPublishResponse,
  WikiVersionsListParams,
  WikiVersionsListResponse,
} from './types'

/**
 * Wiki 知识库接口
 *
 * 路由：`/api/spaces/{space_id}/wiki/...`
 * - GET /wiki/index       索引页（标签统计 + index_markdown + 最近页面）
 * - GET /wiki/pages       页面列表
 * - GET /wiki/logs        日志
 * - GET /wiki/pages/{slug} 页面详情
 * - GET /wiki/progress    空间文件处理进度
 */
export const wikiApi = {
  /** 索引页：标签统计 / index_markdown / 最近 index+summary 页面 */
  index(space_id: string): Promise<WikiIndexResponse> {
    return request
      .get(`/api/spaces/${space_id}/wiki/index`)
      .then((res) => res.data)
      .catch(handleError)
  },

  /** 页面列表 */
  pages(space_id: string, params?: WikiPageListParams): Promise<WikiPageListResponse> {
    return request
      .get(`/api/spaces/${space_id}/wiki/pages`, { params })
      .then((res) => res.data)
      .catch(handleError)
  },

  /** 全局页面搜索（跨空间） */
  search(params: { keyword: string; limit?: number }): Promise<WikiPageListResponse> {
    return request
      .get(`/api/wiki/pages`, { params })
      .then((res) => res.data)
      .catch(handleError)
  },

  /** 日志列表 */
  logs(space_id: string, params?: WikiLogListParams): Promise<WikiLogListResponse> {
    return request
      .get(`/api/spaces/${space_id}/wiki/logs`, { params })
      .then((res) => res.data)
      .catch(handleError)
  },

  /** 页面详情（slug 需自行 encodeURIComponent） */
  page(space_id: string, slug: string): Promise<WikiPageDetail> {
    return request
      .get(`/api/spaces/${space_id}/wiki/pages/${encodeURIComponent(slug)}`)
      .then((res) => res.data)
      .catch(handleError)
  },

  /** 更新页面 */
  updatePage(page_id: string, params: WikiPageUpdateParams): Promise<WikiPageUpdateResponse> {
    return request
      .put(`/api/wiki/pages/${page_id}`, params)
      .then((res) => res.data)
      .catch(handleError)
  },

  /** 删除页面 */
  deletePage(page_id: string): Promise<void> {
    return request
      .delete(`/api/wiki/pages/${page_id}`)
      .then(() => undefined)
      .catch(handleError)
  },

  /** 空间文件处理进度 */
  progress(space_id: string): Promise<WikiProgressResponse> {
    return request
      .get(`/api/spaces/${space_id}/wiki/progress`)
      .then((res) => res.data)
      .catch(handleError)
  },

  /** 空间 wiki 统计（摘要/实体/概念数量、本月新增、累计编译） */
  stats(space_id: string): Promise<WikiStatsResponse> {
    return request
      .get(`/api/spaces/${space_id}/wiki/stats`)
      .then((res) => res.data)
      .catch(handleError)
  },

  /**
   * 页面版本管理
   *
   * 路由：`/api/wiki/pages/{page_id}/versions[/:version_no[/publish]]`
   * - GET    /versions              版本列表
   * - GET    /versions/:version_no  版本详情（含 body）
   * - POST   /versions/:version_no/publish 发布版本（幂等）
   */
  versions: {
    /** 版本列表（按 version_no 倒序） */
    list(page_id: string, params?: WikiVersionsListParams): Promise<WikiPageVersion[]> {
      return request
        .get(`/api/wiki/pages/${page_id}/versions`, { params })
        .then((res) => res.data?.items || res.data || [])
        .catch(handleError)
    },

    /** 版本详情（含完整 body） */
    detail(page_id: string, version_no: number): Promise<WikiPageVersion> {
      return request
        .get(`/api/wiki/pages/${page_id}/versions/${version_no}`)
        .then((res) => res.data)
        .catch(handleError)
    },

    /** 发布版本（幂等，重复发布不报错） */
    publish(page_id: string, version_no: number, params?: WikiVersionPublishParams): Promise<WikiVersionPublishResponse> {
      return request
        .post(`/api/wiki/pages/${page_id}/versions/${version_no}/publish`, params)
        .then((res) => res.data)
        .catch(handleError)
    },

    /** 更新版本标签 */
    updateVersionTag(page_id: string, version_no: number, version_tag: string): Promise<WikiPageVersion> {
      return request
        .put(`/api/wiki/pages/${page_id}/versions/${version_no}/version-tag`, { version_tag })
        .then((res) => res.data)
        .catch(handleError)
    },
  },
}

export default wikiApi

// 重新导出常用类型，方便外部一行 import
export type {
  WikiIndexResponse,
  WikiLogItem,
  WikiLogMeta,
  WikiLogListParams,
  WikiLogListResponse,
  WikiLibrary,
  WikiPageDetail,
  WikiPageItem,
  WikiPageLink,
  WikiPageListParams,
  WikiPageListResponse,
  WikiPageSource,
  WikiPageSortBy,
  WikiPageType,
  WikiPageTypeCounts,
  WikiPageUpdateParams,
  WikiPageUpdateResponse,
  WikiPageVersion,
  WikiPageVisibility,
  WikiProgressItem,
  WikiProgressResponse,
  WikiProgressStatus,
  WikiPublishKind,
  WikiSortOrder,
  WikiStatsResponse,
  WikiVersionPublishParams,
  WikiVersionPublishResponse,
  WikiVersionsListParams,
  WikiVersionsListResponse,
} from './types'