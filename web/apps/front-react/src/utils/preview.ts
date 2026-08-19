/**
 * 上传文件预览地址
 *
 * 后端把上传产物的可访问地址收敛到 `/api/preview/{preview_key}`：匿名可访问、不带 token，
 * 与需要登录态的 `/api/files/{id}/preview?token=` 是两条路。项目里此前近十处手写拼接，
 * 各自对空 key / 非目标类型的兜底不一致，统一收口到这里。
 *
 * 返回 undefined 而不是空串，是为了让调用方能直接用 `url && <Player/>` 决定隐藏 UI，
 * 不会把 `.../api/preview/` 这种半截地址塞进 <audio> / <img>。
 */
import { api_host } from './config'

/** 拼预览地址所需的最小文件元信息（各接口返回的 upload_file / file 结构都满足） */
export interface PreviewFileMeta {
  preview_key?: string
  mime_type?: string
}

/** preview_key → 完整预览地址；key 缺省或空白返回 undefined */
export function buildPreviewUrl(previewKey?: string | null): string | undefined {
  const key = previewKey?.trim()
  return key ? `${api_host}/api/preview/${key}` : undefined
}


export function buildLibraryPreviewUrl(fileid: string, fileName: string): string {
  return `${api_host}/api/files/${fileid}/preview/knowledge_file_${fileid}_${fileName}`
}
