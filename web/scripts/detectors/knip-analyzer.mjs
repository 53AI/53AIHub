/**
 * knip 分析器包装
 * 执行 knip 并解析结果
 */
import { execSync } from 'child_process';
import path from 'path';

/**
 * 运行 knip 分析指定项目
 * @param {string} projectDir 项目目录
 * @param {string} configFile 配置文件路径
 * @returns {Object} knip 分析结果
 */
export function runKnipAnalysis(projectDir, configFile = 'knip.jsonc') {
  const configPath = path.join(projectDir, configFile);

  try {
    // 运行 knip 并捕获 JSON 输出
    const output = execSync(
      `npx knip --config ${configPath} --reporter json --no-exit-code`,
      {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    return parseKnipOutput(output);
  } catch (error) {
    // knip 可能返回非零退出码，但仍有有效输出
    if (error.stdout) {
      return parseKnipOutput(error.stdout);
    }

    return {
      unusedFiles: [],
      unusedExports: [],
      unusedDependencies: [],
      unusedDevDependencies: []
    };
  }
}

/**
 * 解析 knip JSON 输出
 * knip 输出格式: { issues: [{ file, files, exports, dependencies, devDependencies, ... }] }
 * @param {string} output knip JSON 输出
 * @returns {Object} 结构化结果
 */
function parseKnipOutput(output) {
  try {
    const data = JSON.parse(output);

    // knip 返回 { issues: [...] } 格式
    const issues = data.issues || [];

    const result = {
      unusedFiles: [],
      unusedExports: [],
      unusedDependencies: [],
      unusedDevDependencies: []
    };

    for (const issue of issues) {
      // 提取未使用的文件
      if (issue.files && issue.files.length > 0) {
        for (const f of issue.files) {
          result.unusedFiles.push({ path: f.name || f });
        }
      }

      // 提取未使用的导出
      if (issue.exports && issue.exports.length > 0) {
        for (const e of issue.exports) {
          result.unusedExports.push({
            file: issue.file,
            name: e.name || e,
            type: e.type || 'export'
          });
        }
      }

      // 提取未使用的依赖
      if (issue.dependencies && issue.dependencies.length > 0) {
        for (const d of issue.dependencies) {
          result.unusedDependencies.push({
            name: d.name || d,
            type: 'dependencies'
          });
        }
      }

      // 提取未使用的开发依赖
      if (issue.devDependencies && issue.devDependencies.length > 0) {
        for (const d of issue.devDependencies) {
          result.unusedDevDependencies.push({
            name: d.name || d,
            type: 'devDependencies'
          });
        }
      }
    }

    // 去重
    result.unusedFiles = [...new Map(result.unusedFiles.map(f => [f.path, f])).values()];
    result.unusedExports = [...new Map(result.unusedExports.map(e => [`${e.file}:${e.name}`, e])).values()];
    result.unusedDependencies = [...new Map(result.unusedDependencies.map(d => [d.name, d])).values()];
    result.unusedDevDependencies = [...new Map(result.unusedDevDependencies.map(d => [d.name, d])).values()];

    return result;
  } catch {
    return {
      unusedFiles: [],
      unusedExports: [],
      unusedDependencies: [],
      unusedDevDependencies: []
    };
  }
}

/**
 * 分析多个项目
 * @param {string} projectRoot 项目根目录
 * @param {string[]} projects 项目目录列表
 * @returns {Map<string, Object>} 项目名 -> 分析结果
 */
export function analyzeProjects(projectRoot, projects) {
  const results = new Map();

  for (const project of projects) {
    const projectDir = path.join(projectRoot, project);
    const result = runKnipAnalysis(projectDir);
    results.set(project, result);
  }

  return results;
}

export default {
  runKnipAnalysis,
  analyzeProjects
};