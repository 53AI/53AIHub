# Lint 配置说明

本项目已配置了完整的代码检查和格式化工具链，包括 commitlint + husky + eslint + stylelint + lint-staged。

## 📦 已安装的工具

### 提交规范

- `@commitlint/cli` - commitlint 命令行工具
- `@commitlint/config-conventional` - 常规提交规范配置
- `husky` - Git hooks 管理工具

### 代码检查

- `eslint` - JavaScript/TypeScript 代码检查
- `eslint-config-airbnb-base` - Airbnb 代码规范（已定制化调整）
- `stylelint` - CSS/SCSS/Vue 样式检查
- `stylelint-config-standard` - 标准样式规范
- `stylelint-config-recommended-vue` - Vue 样式推荐规范

### 自动化工具

- `lint-staged` - 只对 staged 文件进行检查的工具
- `prettier` - 代码格式化工具

## 📄 配置文件

### commitlint.config.js

定义了提交消息的规范，支持以下类型：

- `feat`: 新增功能
- `fix`: 修复缺陷
- `docs`: 文档变更
- `style`: 代码格式修改
- `refactor`: 代码重构
- `perf`: 性能优化
- `test`: 测试相关
- `build`: 构建相关
- `ci`: CI 配置
- `chore`: 杂项
- `revert`: 回滚
- `wip`: 开发中
- `workflow`: 工作流程改进
- `types`: 类型声明修改

### .eslintrc.cjs

ESLint 配置，基于 Airbnb 规范并进行了项目定制化调整：

- 支持 TypeScript 和 Vue 3
- 放宽了部分严格规则以适应项目需求
- 关闭了与 Prettier 冲突的规则

### stylelint.config.js

样式检查配置：

- 支持 Vue 单文件组件
- 兼容 Tailwind CSS
- 排除第三方库文件
- 支持 Vue 的深度选择器语法

### lint-staged.config.js

定义了对不同文件类型的处理：

- JS/TS 文件：ESLint 检查 + Prettier 格式化
- Vue 文件：ESLint + Stylelint 检查 + Prettier 格式化
- CSS 文件：Stylelint 检查 + Prettier 格式化
- JSON/MD 文件：Prettier 格式化

### .husky/pre-commit

提交前自动运行 `lint-staged`

### .husky/commit-msg

提交时检查提交消息格式

## 🚀 使用方法

### 自动执行（推荐）

Git 提交时会自动执行：

1. `pre-commit` hook 运行 `lint-staged` 检查和修复 staged 文件
2. `commit-msg` hook 检查提交消息格式

### 手动执行

```bash
# 检查所有 TypeScript/JavaScript 文件
npm run lint

# 检查所有样式文件
npm run stylelint

# 只检查 staged 文件
npm run lint-staged

# 格式化所有文件
npm run format

# 检查提交消息格式
npm run commitlint
```

### 提交消息示例

```bash
# ✅ 正确格式
git commit -m "feat: 添加用户登录功能"
git commit -m "fix: 修复登录页面样式问题"
git commit -m "docs: 更新 README 文档"

# ❌ 错误格式
git commit -m "add login feature"
git commit -m "fix bug"
git commit -m "update"
```

## 📋 工作流程

1. **开发阶段**：正常编写代码
2. **提交前**：
   - `git add` 暂存要提交的文件
   - `git commit -m "feat: 描述"`
   - 自动运行 `pre-commit` hook：
     - 对 staged 文件执行 ESLint 检查和修复
     - 对 staged 文件执行 Stylelint 检查和修复
     - 对 staged 文件执行 Prettier 格式化
   - 自动运行 `commit-msg` hook：
     - 检查提交消息格式
3. **如果检查通过**：提交成功
4. **如果检查失败**：修复问题后重新提交

## 🔧 自定义配置

如需调整规则，可以修改对应的配置文件：

- ESLint 规则：修改 `.eslintrc.cjs`
- Stylelint 规则：修改 `stylelint.config.js`
- 提交规范：修改 `commitlint.config.js`
- Lint-staged 行为：修改 `lint-staged.config.js`

## 🚫 绕过检查（不推荐）

在紧急情况下可以绕过检查：

```bash
# 绕过所有 hooks
git commit --no-verify -m "emergency fix"
```

**注意：绕过检查可能导致代码质量问题，请谨慎使用。**

## 🔍 常见问题排查

### 1. 提交被拒绝

如果提交被拒绝，请检查：

- 提交消息是否符合规范
- 代码是否通过 lint 检查
- 是否有语法错误

### 2. v-if 指令格式化问题

如果 Vue 文件中的 `v-if` 指令被错误地换行到最左边：

- 确保使用了项目根目录的 `.vscode/settings.json` 配置
- 检查是否安装了推荐的 VSCode 扩展
- 确保 `editor.defaultFormatter` 设置为 `esbenp.prettier-vscode`
- 重启 VSCode 并重新加载项目

### 3. VSCode 配置

为确保格式化正常工作，请：

- 安装推荐的扩展（会自动提示）
- 确保 `settings.json` 中的格式化器设置正确
- 禁用可能冲突的格式化扩展（如 Vetur）

### 4. 格式化不生效

如果自动格式化不生效，请：

- 确保已安装 Prettier 扩展
- 检查 VSCode 设置是否正确
- 重启 VSCode

### 5. Stylelint 报错

如果 CSS 样式检查报错，请：

- 检查 CSS 语法是否正确
- 确认是否使用了不支持的语法
- 查看是否与 Tailwind 冲突

## 🛠️ VSCode 配置说明

项目已配置了 `.vscode/settings.json` 和 `.vscode/extensions.json`：

- `settings.json`: 确保 VSCode 使用正确的格式化器和设置
- `extensions.json`: 推荐安装的扩展列表
- 重要：请确保安装了推荐的扩展，特别是 `esbenp.prettier-vscode`

## 📋 格式化配置

### Prettier 配置 (.prettierrc.js)

- Vue 文件使用 150 字符宽度，防止 `v-if` 等指令被强制换行
- 支持 Tailwind CSS 类名
- 保持一致的代码风格

### ESLint 配置 (.eslintrc.cjs)

- 基于 Airbnb 规范，适应项目需求
- 支持 TypeScript 和 Vue 3
- 与 Prettier 协同工作
