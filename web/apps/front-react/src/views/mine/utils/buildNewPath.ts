export interface BuildNewPathSource {
  name: string
  isfolder: boolean
  file_ext?: string
}

/**
 * 根据 sourceItem 和目标目录路径，生成移动后的完整新路径。
 * - 文件夹：`<target>/<name>`
 * - 文件：`<target>/<name>[.<ext>]`
 * - 目标为根目录 '/' 时不重复拼接斜杠
 */
export function buildNewPath(source: BuildNewPathSource, targetFolderPath: string): string {
  const normalizedTarget = targetFolderPath === '/' ? '' : targetFolderPath.replace(/\/$/, '')
  const baseName = source.name

  if (source.isfolder) {
    return `${normalizedTarget}/${baseName}`
  }

  const rawExt = (source.file_ext || '').replace(/^\./, '')
  const ext = rawExt ? `.${rawExt}` : ''
  return `${normalizedTarget}/${baseName}${ext}`
}
