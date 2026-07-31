/**
 * OpenClaw / 历史 / 流式响应中的输出文件传输对象归一化。
 *
 * 单一解码入口：把后端在 snake_case 与 camelCase 之间漂移的 wire-format
 * （file_id/fileId, file_name/fileName, mime_type/mimeType, artifact_id/artifactId,
 * upload_file_id/uploadFileId, download_url/downloadUrl, preview_url/previewUrl,
 * signed_download_url/signedDownloadUrl, file_size/fileSize/size 等）统一归一化
 * 为标准 `OutputFile`。下游 chat 模块统一消费 `OutputFile`，不再散落兼容探测。
 *
 * 仅做字段归一化；不做业务校验（如 chunk_type / message_id 的合法性）。调用方
 * 负责把得到的 `OutputFile` 与对应消息绑定并下发到渲染层。
 */
import type { OutputFile } from '../types/message';

/** 传输层原始对象：snake_case 或 camelCase 任意组合 */
type TransportFile = Record<string, unknown>;

/** 字符串字段归一化：snake 优先 → camel 兜底 → undefined */
function pickString(record: TransportFile, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** 数字字段归一化 */
function pickNumber(record: TransportFile, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

/** 字符串 ID 字段（允许字符串或数字） */
function pickId(record: TransportFile, ...keys: string[]): string | number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** 布尔字段归一化 */
function pickBoolean(record: TransportFile, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

/**
 * 解码单个传输文件为标准 OutputFile。
 *
 * 返回 `null` 当且仅当传输对象无效（null/undefined/非对象）且无任何可派生 ID。
 * 业务层应将 `null` 视为丢弃。
 */
export function decodeOutputFile(transport: unknown): OutputFile | null {
  if (!transport || typeof transport !== 'object') return null;
  const record = transport as TransportFile;

  const id = pickId(record, 'id', 'file_id', 'fileId', 'artifact_id', 'artifactId', 'upload_file_id', 'uploadFileId', 'url');
  if (id === undefined) return null;

  const name = pickString(record, 'name', 'file_name', 'fileName', 'filename');
  const previewUrl = pickString(record, 'preview_url', 'previewUrl');
  const downloadUrl = pickString(record, 'download_url', 'downloadUrl');
  const signedDownloadUrl = pickString(record, 'signed_download_url', 'signedDownloadUrl');
  const rawUrl = pickString(record, 'url', 'href');
  const url = previewUrl ?? (rawUrl?.startsWith('data:') ? rawUrl : undefined);

  return {
    id,
    name,
    file_name: name,
    url: rawUrl,
    preview_url: previewUrl,
    preview_key: pickString(record, 'preview_key', 'previewKey'),
    download_url: downloadUrl,
    signed_download_url: signedDownloadUrl,
    artifact_id: pickId(record, 'artifact_id', 'artifactId'),
    upload_file_id: pickId(record, 'upload_file_id', 'uploadFileId'),
    mime_type: pickString(record, 'mime_type', 'mimeType'),
    size: pickNumber(record, 'size', 'file_size', 'fileSize'),
    kind: pickString(record, 'kind'),
    message_id: pickId(record, 'message_id', 'messageId'),
    source_kind: pickString(record, 'source_kind', 'sourceKind'),
    base64: pickString(record, 'base64'),
    content: pickString(record, 'content'),
    file_path: pickString(record, 'file_path', 'filePath'),
    is_favorite: pickBoolean(record, 'is_favorite', 'isFavorite'),
  };
}

/**
 * 解码一组传输文件。跳过无效项（null / 非对象 / 缺 id）。
 */
export function decodeOutputFiles(transport: unknown): OutputFile[] {
  if (!Array.isArray(transport)) return [];
  const out: OutputFile[] = [];
  for (const item of transport) {
    const f = decodeOutputFile(item);
    if (f) out.push(f);
  }
  return out;
}
