# 53AIHub 平台前端项目资源

基于大语言模型的 AI 知识管理平台，支持智能问答、知识库管理、Agent 配置等功能。

## 仓库结构

```
53AIHub/
├── api/                    # 后端服务（Go）
│   ├── static/
│   │   ├── console/       # 管理后台前端产物
│   │   └── front/         # 用户前台前端产物
│   └── ...
├── web/                    # 前端 Monorepo（当前目录）
│   ├── apps/
│   │   ├── front-react/        # 用户前台
│   │   ├── console-react/      # 管理后台
│   │   └── agent-plugin/       # Agent 插件独立应用
│   ├── packages/               # 共享包
│   └── ...
└── README.md
```

## 前端项目结构

```
web/
├── apps/
│   ├── front-react/        # 用户前台
│   ├── console-react/      # 管理后台
│   └── agent-plugin/       # Agent 插件独立应用
├── packages/
│   ├── hub-ui-x-react/     # 共享聊天 React UI 组件库
│   ├── shared-business/    # 共享业务逻辑层
│   ├── shared-components-react/  # 共享 React 组件
│   ├── shared-api/         # 共享 API 层（请求配置、错误处理、签名等）
│   ├── shared-types/       # 共享 TypeScript 类型定义
│   ├── shared-utils/       # 共享工具函数（缓存、防抖、文件处理等）
│   ├── shared-public/      # 共享静态资源（images、js、UEditor）
│   └── vite-plugins/       # 共享 Vite 插件（merge-public、conditional-compilation）
├── turbo.json              # Turborepo 任务编排配置
├── pnpm-workspace.yaml     # pnpm workspace 配置
└── biome.json              # Biome 代码检查配置
```

## 技术栈

| 类别       | 技术                                      |
| ---------- | ----------------------------------------- |
| 框架       | React 18 + TypeScript                    |
| 构建工具   | Vite 5                                   |
| 包管理     | pnpm 9 + pnpm workspace                  |
| 任务编排   | Turborepo                                 |
| 状态管理   | Zustand                                   |
| UI 组件库  | Ant Design                                |
| CSS 方案   | Tailwind CSS                              |
| 国际化     | i18next + react-i18next                  |
| 代码规范   | Biome (lint + format)                     |
| Git 规范   | Husky + Commitlint + lint-staged          |
| 测试       | Vitest + Testing Library                 |

## 构建依赖关系

### 重要：agent-plugin 构建流程

`agent-plugin` 是独立构建的应用，其产物需要嵌入到 `front-react` 中：

```bash
# 1. 先构建 agent-plugin
pnpm --filter @km/agent-plugin build

# 2. 删除旧目录并复制新产物到 front-react 的 public 目录
rm -rf apps/front-react/public/agentplugin
cp -r apps/agent-plugin/dist apps/front-react/public/agentplugin

# 3. 再构建 front-react
pnpm --filter @km/front-react build
```

或使用一键构建命令（如已配置）：

```bash
pnpm build:front-react
```

## 环境要求

- **Node.js** >= 18.0.0
- **pnpm** >= 9.15.0

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 构建共享包（首次或依赖变更后）

应用依赖 `@km/shared-utils`、`@km/shared-components-react`、`@km/shared-business`、`@km/hub-ui-x-react` 的构建产物，需先构建：

```bash
# 构建所有共享包（推荐，会按依赖顺序构建）
pnpm build:shared
```

或单独构建：

```bash
pnpm --filter @km/shared-utils build
pnpm --filter @km/shared-components-react build
pnpm --filter @km/shared-business build
pnpm --filter @km/hub-ui-x-react build
```

### 3. 启动开发服务

```bash
pnpm dev:front-react      # 用户前台
pnpm dev:console-react    # 管理后台
pnpm --filter @km/agent-plugin dev  # Agent 插件独立开发

# 同时启动所有应用
pnpm dev
```

### 4. 构建应用

```bash
pnpm build:front-react    # 构建用户前台
pnpm build:console-react  # 构建管理后台
```


### 5. 构建产物部署

前端构建完成后，产物需部署到后端静态资源目录：

```
api/static/console/   ← console-react 构建产物
api/static/front/     ← front-react 构建产物
```

一键部署脚本（在前端根目录执行）：

```bash
# 构建并复制到后端静态目录
pnpm build:console-react && cp -r apps/console-react/dist ../api/static/console
pnpm build:front-react && cp -r apps/front-react/dist ../api/static/front
```

## 后端构建

前端构建完成后，进入后端目录构建可执行程序：

```bash
cd ../api
```

### Windows 构建

```bash
make build-windows-cgo
```

构建完成后，`api/bin/` 目录下生成可执行文件，双击运行即可。


## 快速部署（完整流程）

从零开始构建完整项目：

```bash
# 1. 进入前端目录
cd web

# 2. 安装依赖
pnpm install

# 3. 构建共享包
pnpm build:shared

# 4. 构建 agent-plugin 并嵌入 front-react
pnpm --filter @km/agent-plugin build
rm -rf apps/front-react/public/agentplugin
cp -r apps/agent-plugin/dist apps/front-react/public/agentplugin

# 5. 构建前端应用
pnpm build:console-react
pnpm build:front-react

# 6. 复制构建产物到后端静态目录（先删除旧目录）
rm -rf ../api/static/console ../api/static/front
cp -r apps/console-react/dist ../api/static/console
cp -r apps/front-react/dist ../api/static/front

# 7. 进入后端目录
cd ../api

# 8. 构建后端（以 Windows 为例）
make build-windows-cgo
```


## 常用命令

| 命令                     | 说明                           |
| ------------------------ | ------------------------------ |
| `pnpm dev`               | 启动所有应用的开发服务         |
| `pnpm dev:front-react`   | 启动用户前台                  |
| `pnpm dev:console-react` | 启动管理后台                  |
| `pnpm build:front-react` | 构建用户前台                  |
| `pnpm build:console-react` | 构建管理后台                |
| `pnpm build:shared`      | 构建所有共享包                 |
| `pnpm lint`              | Biome 代码检查                 |
| `pnpm lint:fix`          | 代码检查并自动修复             |
| `pnpm format`            | 格式化代码                     |
| `pnpm type-check`        | 各包 TypeScript 类型检查       |
| `pnpm clean`             | 清理构建产物                   |
| `pnpm clean:vite`        | 清理 Vite 依赖预构建缓存       |
| `pnpm clean:modules`     | 清理所有 node_modules          |

## 共享依赖版本统一（pnpm overrides）

React 应用与 Vue 应用共用一批依赖，版本在**根目录 `package.json`** 的 **`pnpm.overrides`** 中统一指定，避免版本不一致。

**升级共享依赖时**：

1. 修改根目录 `package.json` 中 `pnpm.overrides` 对应项；
2. 在仓库根执行 `pnpm install`，各应用会同步使用新版本；
3. **若升级后效果未生效**，需删掉 Vite 依赖预构建缓存：
   ```bash
   pnpm clean:vite
   ```

## 多语言文案编辑

多语言源文件为各应用下的 **CSV**（如 `apps/console-react/src/locales/source.csv`、`apps/front-react/src/locales/source.csv`），表头为 `key, zh-cn, zh-tw, en, ja`。编辑时请使用 **UTF-8** 编码保存，避免用 WPS/Excel 默认保存导致 ANSI 乱码。

推荐使用 VS Code / Cursor 扩展 **Edit CSV** 打开上述 CSV，可表格化编辑且默认保持 UTF-8，改完保存后刷新页面即可生效。

## 共享包说明

### `@km/hub-ui-x-react`

共享 React UI 组件库，包含业务通用组件。

### `@km/shared-business`

共享业务逻辑层，包含跨应用的业务处理代码。

### `@km/shared-components-react`

跨 React 应用复用的组件：

- `Pagination` — 分页组件
- `Search` — 搜索组件
- `TablePlus` — 增强表格组件
- `SvgIcon` — 统一 SVG 图标组件

### `@km/shared-utils`

通用工具函数集合：

- 缓存管理、防抖、文件处理
- 事件总线、URL 工具、MD5

### `@km/agent-plugin`

Agent 插件独立应用，构建产物嵌入 `front-react` 中运行。支持：

- 独立开发调试（`pnpm --filter @km/agent-plugin dev`）
- SDK 模式构建（`pnpm --filter @km/agent-plugin build:sdk`）

## Git 提交规范

项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范，提交时会通过 Husky + Commitlint 自动校验。

```
feat: 新功能
fix: 修复 Bug
docs: 文档更新
style: 代码样式调整（不影响逻辑）
refactor: 代码重构
perf: 性能优化
test: 测试相关
chore: 构建/工具链变更
```
