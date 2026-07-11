/**
 * 图片检测器
 * 检测 public/images/ 和 packages/shared-public/images/ 中未被引用的图片
 */
import { getAllFiles, readSourceFiles, getRelativePath } from './utils.mjs';
import path from 'path';
import { existsSync } from 'fs';

/**
 * 获取所有图片文件
 * @param {string[]} imageDirs 图片目录列表
 * @returns {Array<{ path: string, relativePath: string, name: string }>}
 */
export function getAllImages(imageDirs) {
  const images = [];
  const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

  for (const dir of imageDirs) {
    const files = getAllFiles(dir, extensions);
    for (const file of files) {
      images.push({
        path: file,
        relativePath: getRelativePath(file),
        name: path.basename(file)
      });
    }
  }

  return images;
}

/**
 * 从源码中提取引用的图片路径
 * 匹配模式：
 * - getPublicPath("/images/xxx")
 * - getAssetUrl("/images/xxx")
 * - "/images/xxx.png"
 * - '/images/xxx.png'
 * @param {Map<string, string>} sourceFiles 源码文件映射
 * @returns {{ static: Set<string>, dynamic: Array<{ file: string, line: number, snippet: string }> }}
 */
export function extractUsedImages(sourceFiles) {
  const staticRefs = new Set();
  const dynamicRefs = [];

  // 静态引用模式："/images/xxx.png"
  const staticPattern = /["'](\/images\/[^"']+\.(png|jpg|jpeg|gif|webp|svg))["']/g;

  for (const [filePath, content] of sourceFiles) {
    // 静态引用
    let match;
    while ((match = staticPattern.exec(content)) !== null) {
      staticRefs.add(match[1]);
    }

    // 检测动态引用
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('/images/') && (line.includes('${') || line.includes('`'))) {
        dynamicRefs.push({
          file: getRelativePath(filePath),
          line: i + 1,
          snippet: line.trim().substring(0, 100)
        });
      }
    }
  }

  return { static: staticRefs, dynamic: dynamicRefs };
}

/**
 * 检测未使用的图片
 * @param {string} projectRoot 项目根目录
 * @param {string[]} sourceDirs 源码目录列表
 * @param {Object} imageConfig 图片目录配置
 * @returns {{ unused: Array, dynamic: Array, total: number, unusedCount: number }}
 */
export function detectUnusedImages(projectRoot, sourceDirs, imageConfig = {}) {
  const {
    frontReactPublic = 'apps/front-react/public/images',
    consoleReactPublic = 'apps/console-react/public/images',
    sharedPublic = 'packages/shared-public/images'
  } = imageConfig;

  // 获取所有图片
  const imageDirs = [
    path.join(projectRoot, frontReactPublic),
    path.join(projectRoot, consoleReactPublic),
    path.join(projectRoot, sharedPublic)
  ].filter(dir => {
    // 只处理存在的目录
    try {
      return existsSync(dir);
    } catch {
      return false;
    }
  });

  const allImages = getAllImages(imageDirs);

  // 读取源码
  const sourceFiles = readSourceFiles(sourceDirs);

  // 提取引用
  const { static: staticRefs, dynamic: dynamicRefs } = extractUsedImages(sourceFiles);

  // 判断图片是否被引用
  const unused = allImages.filter(img => {
    // 检查图片文件名是否在任何引用中出现
    return ![...staticRefs].some(ref => ref.includes(img.name));
  });

  return {
    unused: unused.map(img => ({
      path: img.relativePath,
      name: img.name
    })),
    dynamic: dynamicRefs,
    total: allImages.length,
    unusedCount: unused.length
  };
}

export default {
  getAllImages,
  extractUsedImages,
  detectUnusedImages
};
