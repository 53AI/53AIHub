import type { RecordingMemoryEntitySchemas, RecordingMemoryEntityType } from '@/api/modules/recording/types'

/** 按类型取 schema 条目（后端返回数组，改成线性查找） */
export const findSchemaType = (
  type: RecordingMemoryEntityType | string,
  schema: RecordingMemoryEntitySchemas | null,
) => schema?.find((s) => s.type === type)

/** 自由文本属性 → 没有枚举候选（values 数组为空），直接展示原值 */
export function isEnumAttribute(
  values: Array<{ label: string; value: string }> | undefined,
): values is Array<{ label: string; value: string }> {
  return !!values && values.length > 0
}

// source_file 可能是后端返回的完整路径(包含目录前缀),时间线展示只取 basename。
// 出现双重后缀时(如 "xxx.m4a.md")沿用 share/recording.tsx 的 stripLastExtension 处理:
// 仅当去掉最后一个后缀后剩余部分仍包含「.」时,才认定是双重后缀,剥掉一层;
// 否则原样返回,保留真实扩展名。
export function formatSourceFile(path: string | undefined) {
  if (!path) return ''
  const segments = path.split(/[\\/]/).filter(Boolean)
  const basename = segments.length ? segments[segments.length - 1] : path
  const lastDot = basename.lastIndexOf('.')
  if (lastDot <= 0) return basename
  if (basename.slice(0, lastDot).includes('.')) {
    return basename.slice(0, lastDot)
  }
  return basename
}

/** 事实条目上的类型 chip 文本:取自 schema 的中文 label,未知类型直接回退到原始 key。 */
export const factEntityTypeLabel = (
  type: RecordingMemoryEntityType | string,
  schema: RecordingMemoryEntitySchemas | null,
) => findSchemaType(type, schema)?.label ?? type
