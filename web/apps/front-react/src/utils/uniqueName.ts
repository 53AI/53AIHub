/**
 * 在 caller 已归一化的"显示名"空间里生成唯一名称：
 * - 若 baseName 不在 existingNames 中，直接返回 baseName
 * - 若重复，扫 existingNames 中匹配 `^baseName(N)$` 的最大 N，返回 `baseName(N+1)`
 *
 * caller 负责把扩展名（如 .md、realExt）从 baseName 与 existingNames 同步剥离，
 * 这样同一文件的不同场景（创建文件夹 / 创建 md / 重命名）复用同一份逻辑。
 */
export function generateUniqueName(
  baseName: string,
  existingNames: string[],
): string {
  if (!existingNames.includes(baseName)) return baseName;

  const pattern = new RegExp(
    `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\((\\d+)\\)$`,
  );
  const numbers: number[] = [];
  for (const name of existingNames) {
    const match = name.match(pattern);
    if (match) numbers.push(parseInt(match[1], 10));
  }
  const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
  return `${baseName}(${maxNumber + 1})`;
}
