/**
 * 在已有名称列表中生成不重复的名称（文件夹/文件名）
 */

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 在已有节点列表中生成唯一文件夹名（格式：基础名 或 基础名(2)、基础名(3)...）
 */
export const generateUniqueFolderName = (
  baseName: string,
  nodes: Array<{ name: string }>
): string => {
  if (nodes.length === 0) return baseName
  const existingNames = nodes.map((item) => item.name)
  if (!existingNames.includes(baseName)) return baseName
  const pattern = new RegExp(`^${escapeRegExp(baseName)}\\((\\d+)\\)$`)
  const numbers: number[] = []
  existingNames.forEach((name) => {
    const match = name.match(pattern)
    if (match) numbers.push(parseInt(match[1], 10))
  })
  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1
  return `${baseName}(${nextNumber})`
}

/**
 * 在已有节点列表中生成唯一文件名（会忽略 .md 后缀比较）
 */
export const generateUniqueFileName = (
  baseName: string,
  nodes: Array<{ name: string }>
): string => {
  const existingNames = nodes.map((item) => item.name.replace(/\.md$/, ''))
  if (!existingNames.includes(baseName)) return baseName
  const pattern = new RegExp(`^${escapeRegExp(baseName)}\\((\\d+)\\)$`)
  const numbers: number[] = []
  existingNames.forEach((name) => {
    const match = name.match(pattern)
    if (match) numbers.push(parseInt(match[1], 10))
  })
  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1
  return `${baseName}(${nextNumber})`
}
