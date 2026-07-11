/**
 * 通用工具函数
 */
import fs from 'fs';
import path from 'path';

/**
 * 递归获取目录下所有文件
 * @param {string} dir 目录路径
 * @param {string[]} extensions 文件扩展名过滤，如 ['.ts', '.tsx']
 * @returns {string[]} 文件完整路径列表
 */
export function getAllFiles(dir, extensions = []) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      files.push(...getAllFiles(fullPath, extensions));
    } else if (item.isFile()) {
      if (extensions.length === 0 || extensions.some(ext => item.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * 读取文件内容
 * @param {string} filePath 文件路径
 * @returns {string} 文件内容
 */
export function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * 获取项目根目录
 * @returns {string} 项目根目录绝对路径
 */
export function getProjectRoot() {
  // scripts 目录在项目根目录下，所以向上两级
  const cwd = process.cwd();
  // 如果在项目根目录执行
  if (fs.existsSync(path.join(cwd, 'package.json')) && fs.existsSync(path.join(cwd, 'apps'))) {
    return cwd;
  }
  // 如果在 scripts 目录执行
  return path.resolve(cwd, '..', '..');
}

/**
 * 获取相对路径（相对于项目根目录）
 * @param {string} filePath 绝对路径
 * @returns {string} 相对路径
 */
export function getRelativePath(filePath) {
  return path.relative(getProjectRoot(), filePath);
}

/**
 * 批量读取源码文件内容
 * @param {string[]} dirs 目录列表
 * @param {string[]} extensions 扩展名过滤
 * @returns {Map<string, string>} 文件路径 -> 内容映射
 */
export function readSourceFiles(dirs, extensions = ['.ts', '.tsx', '.js', '.jsx']) {
  const contents = new Map();

  for (const dir of dirs) {
    const files = getAllFiles(dir, extensions);
    for (const file of files) {
      const content = readFileContent(file);
      if (content) {
        contents.set(file, content);
      }
    }
  }

  return contents;
}

/**
 * 格式化日期
 * @param {Date} date 日期对象
 * @returns {string} YYYY-MM-DD 格式
 */
export function formatDate(date = new Date()) {
  return date.toISOString().split('T')[0];
}