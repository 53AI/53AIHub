#!/usr/bin/env node
/**
 * 项目清理报告生成器
 * 整合 knip、SVG、图片检测结果，生成 Markdown 报告
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatDate, getProjectRoot } from './detectors/utils.mjs';
import { detectUnusedIcons } from './detectors/svg-detector.mjs';
import { detectUnusedImages } from './detectors/image-detector.mjs';
import { analyzeProjects } from './detectors/knip-analyzer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 生成 Markdown 报告
 */
function generateReport(data) {
  const { date, knipResults, svgResults, imageResults } = data;

  let md = `# 项目清理报告 (${date})\n\n`;

  // 一、冗余依赖
  md += `## 一、冗余依赖\n\n`;

  let hasUnusedDeps = false;
  for (const [project, result] of knipResults) {
    const deps = [...result.unusedDependencies, ...result.unusedDevDependencies];
    if (deps.length > 0) {
      hasUnusedDeps = true;
      md += `### ${project}\n\n`;
      md += `| 包名 | 类型 | 删除命令 |\n`;
      md += `|------|------|----------|\n`;
      for (const dep of deps) {
        const projectName = project.replace('apps/', '');
        const cmd = `pnpm --filter @km/${projectName} remove ${dep.name}`;
        md += `| ${dep.name} | ${dep.type} | \`${cmd}\` |\n`;
      }
      md += `\n`;
    }
  }

  if (!hasUnusedDeps) {
    md += `_未发现冗余依赖_\n\n`;
  }

  // 二、未使用代码
  md += `## 二、未使用代码\n\n`;

  let hasUnusedCode = false;
  for (const [project, result] of knipResults) {
    const unused = [...result.unusedFiles, ...result.unusedExports];
    if (unused.length > 0) {
      hasUnusedCode = true;
      md += `### ${project}\n\n`;
      md += `| 文件/导出 | 类型 | 删除命令 |\n`;
      md += `|-----------|------|----------|\n`;

      for (const file of result.unusedFiles.slice(0, 20)) {
        md += `| ${file.path} | 文件 | \`rm ${project}/${file.path}\` |\n`;
      }

      for (const exp of result.unusedExports.slice(0, 20)) {
        md += `| ${exp.file}#${exp.name} | 导出 | 需手动删除 |\n`;
      }

      if (result.unusedFiles.length > 20 || result.unusedExports.length > 20) {
        md += `\n_...更多项目省略_\n`;
      }
      md += `\n`;
    }
  }

  if (!hasUnusedCode) {
    md += `_未发现未使用代码_\n\n`;
  }

  // 三、未使用 SVG 图标
  md += `## 三、未使用 SVG 图标\n\n`;
  md += `**图标目录**: \`packages/shared-public/icons/\`\n\n`;
  md += `- 总数: ${svgResults.total}\n`;
  md += `- 未使用: ${svgResults.unusedCount}\n\n`;

  if (svgResults.unusedCount > 0) {
    md += `| 图标名 | 删除命令 |\n`;
    md += `|--------|----------|\n`;
    for (const icon of svgResults.unused.slice(0, 30)) {
      md += `| ${icon}.svg | \`rm packages/shared-public/icons/${icon}.svg\` |\n`;
    }
    if (svgResults.unusedCount > 30) {
      md += `\n_...共 ${svgResults.unusedCount} 个未使用图标_\n`;
    }
    md += `\n`;
  }

  // 四、未使用图片
  md += `## 四、未使用图片\n\n`;
  md += `- 总数: ${imageResults.total}\n`;
  md += `- 未使用: ${imageResults.unusedCount}\n\n`;

  if (imageResults.unusedCount > 0) {
    md += `| 文件路径 | 删除命令 |\n`;
    md += `|----------|----------|\n`;
    for (const img of imageResults.unused.slice(0, 20)) {
      md += `| ${img.path} | \`rm ${img.path}\` |\n`;
    }
    if (imageResults.unusedCount > 20) {
      md += `\n_...共 ${imageResults.unusedCount} 个未使用图片_\n`;
    }
    md += `\n`;
  }

  // 五、需人工复核
  md += `## 五、需人工复核\n\n`;

  // 动态引用图片
  if (imageResults.dynamic && imageResults.dynamic.length > 0) {
    md += `### 动态引用图片\n\n`;
    md += `以下代码使用了动态路径，工具无法自动判断：\n\n`;
    md += `| 文件 | 行号 | 代码片段 |\n`;
    md += `|------|------|----------|\n`;
    for (const ref of imageResults.dynamic) {
      md += `| ${ref.file} | ${ref.line} | \`${ref.snippet}\` |\n`;
    }
    md += `\n`;
  }

  // Workspace 依赖
  md += `### Workspace 依赖\n\n`;
  md += `以下依赖为 monorepo 内部包，需确认跨包引用情况：\n\n`;
  md += `| 包名 | 说明 |\n`;
  md += `|------|------|\n`;
  md += `| @km/shared-* | 共享包，可能被其他 app 引用 |\n`;
  md += `| @km/hub-ui-x-react | UI 组件库，需确认使用情况 |\n\n`;

  // 六、一键清理命令
  md += `## 六、一键清理命令\n\n`;
  md += `### 安全删除（可复制执行）\n\n`;
  md += `\`\`\`bash\n`;

  // 依赖
  for (const [project, result] of knipResults) {
    const projectName = project.replace('apps/', '');
    for (const dep of result.unusedDependencies) {
      md += `pnpm --filter @km/${projectName} remove ${dep.name}\n`;
    }
  }

  // SVG 图标
  for (const icon of svgResults.unused.slice(0, 10)) {
    md += `rm packages/shared-public/icons/${icon}.svg\n`;
  }

  // 图片
  for (const img of imageResults.unused.slice(0, 10)) {
    md += `rm ${img.path}\n`;
  }

  md += `\`\`\`\n\n`;

  // 验证步骤
  md += `### 验证步骤\n\n`;
  md += `\`\`\`bash\n`;
  md += `pnpm build:front-react\n`;
  md += `pnpm build:console-react\n`;
  md += `\`\`\`\n`;

  return md;
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 开始检测...\n');

  const projectRoot = getProjectRoot();
  const date = formatDate();

  // 1. knip 分析
  console.log('📦 分析依赖和代码...');
  const knipResults = analyzeProjects(projectRoot, [
    'apps/front-react',
    'apps/console-react'
  ]);

  // 2. SVG 图标检测
  console.log('🎨 检测 SVG 图标...');
  const svgResults = detectUnusedIcons(projectRoot, [
    path.join(projectRoot, 'apps/front-react/src'),
    path.join(projectRoot, 'apps/console-react/src')
  ]);

  // 3. 图片检测
  console.log('🖼️ 检测图片...');
  const imageResults = detectUnusedImages(projectRoot, [
    path.join(projectRoot, 'apps/front-react/src'),
    path.join(projectRoot, 'apps/console-react/src')
  ], {});

  // 4. 生成报告
  console.log('📝 生成报告...');
  const report = generateReport({
    date,
    knipResults,
    svgResults,
    imageResults
  });

  // 写入文件
  const reportPath = path.join(projectRoot, 'CLEAN-REPORT.md');
  fs.writeFileSync(reportPath, report, 'utf-8');

  console.log(`\n✅ 报告已生成: ${reportPath}`);
  console.log('\n统计:');
  console.log(`  - SVG 图标: ${svgResults.total} 个，未使用 ${svgResults.unusedCount} 个`);
  console.log(`  - 图片: ${imageResults.total} 个，未使用 ${imageResults.unusedCount} 个`);
  if (imageResults.dynamic) {
    console.log(`  - 动态引用: ${imageResults.dynamic.length} 处需人工复核`);
  }
}

main().catch(console.error);
