/**
 * SVG 图标检测器
 * 检测 packages/shared-public/icons/ 中未被引用的 SVG 图标
 */
import { getAllFiles, readSourceFiles } from './utils.mjs';
import path from 'path';

/**
 * 获取所有 SVG 图标名称
 * @param {string} iconsDir 图标目录
 * @returns {Set<string>} 图标名称集合
 */
export function getAllIconNames(iconsDir) {
  const files = getAllFiles(iconsDir, ['.svg']);
  const names = new Set();

  for (const file of files) {
    const basename = path.basename(file, '.svg');
    names.add(basename);
  }

  return names;
}

/**
 * 从源码中提取引用的图标名称
 * 匹配模式：
 * - <SvgIcon name="xxx" />
 * - <SvgIcon name='xxx' />
 * - name="xxx"
 * - name='xxx'
 * - #icon-xxx
 * @param {Map<string, string>} sourceFiles 源码文件映射
 * @returns {Set<string>} 引用的图标名称集合
 */
export function extractUsedIcons(sourceFiles) {
  const usedIcons = new Set();

  // 匹配 SvgIcon name="xxx" 或 name='xxx'
  const nameAttrPattern = /name=["']([^"']+)["']/g;
  // 匹配 #icon-xxx
  const iconRefPattern = /#icon-([a-zA-Z0-9_-]+)/g;

  for (const [filePath, content] of sourceFiles) {
    // 匹配 name 属性
    let match;
    while ((match = nameAttrPattern.exec(content)) !== null) {
      usedIcons.add(match[1]);
    }

    // 匹配 #icon-xxx 引用
    while ((match = iconRefPattern.exec(content)) !== null) {
      usedIcons.add(match[1]);
    }
  }

  return usedIcons;
}

/**
 * 检测未使用的 SVG 图标
 * @param {string} projectRoot 项目根目录
 * @param {string[]} sourceDirs 源码目录列表
 * @returns {{ unused: string[], used: string[], total: number, unusedCount: number }}
 */
export function detectUnusedIcons(projectRoot, sourceDirs) {
  const iconsDir = path.join(projectRoot, 'packages', 'shared-public', 'icons');

  // 获取所有图标
  const allIcons = getAllIconNames(iconsDir);

  // 读取源码
  const sourceFiles = readSourceFiles(sourceDirs);

  // 提取引用
  const usedIcons = extractUsedIcons(sourceFiles);

  // 计算未使用
  const unused = [...allIcons].filter(icon => !usedIcons.has(icon));

  return {
    unused: unused.sort(),
    used: [...usedIcons].sort(),
    total: allIcons.size,
    unusedCount: unused.length
  };
}

export default {
  getAllIconNames,
  extractUsedIcons,
  detectUnusedIcons
};