# Agent Plugin

嵌入式 H5 智能体聊天应用。第三方网站通过 URL（`?token=xxx`）或 JS SDK（iframe）嵌入，为外部访客 / SSO 用户提供智能体对话能力。

- 访问地址：`https://<host>/agentplugin?token=<fixed_token>`
- 后台入口（生成 fixed_token）：`apps/console-react/src/views/agent/create-v2/IntegrateTab.tsx`
- SDK 文档：[`src/sdk/README.md`](src/sdk/README.md)

## 快速开始

```bash
pnpm dev          # 开发服务器（0.0.0.0:3001）
pnpm build        # 构建主应用
pnpm build:sdk    # 构建 SDK（dist-sdk/agent-plugin-sdk.iife.js）
pnpm build:all    # 主应用 + SDK
pnpm typecheck    # 类型检查
```

开发访问：`http://localhost:3001/agentplugin?token=<fixed_token>`

## 部署到 front-react（测试服）

编译产物需同步到 `apps/front-react/public`，由 front-react 统一托管：

| 产物 | 目标位置 |
|------|----------|
| `dist/`（主包，base `/agentplugin`） | `apps/front-react/public/agentplugin/` |
| `dist-sdk/agent-plugin-sdk.iife.js`（SDK） | `apps/front-react/public/agent-plugin-sdk.iife.js`（public 根目录） |

```bash
# 仓库根目录执行。必须先删旧目录再拷贝：产物带 content hash，
# 直接覆盖会导致旧 hash 文件无限堆积
cd apps/agent-plugin && pnpm build:all   # 或分步 build / build:sdk
cd <仓库根>
rm -rf apps/front-react/public/agentplugin
cp -r apps/agent-plugin/dist apps/front-react/public/agentplugin
cp apps/agent-plugin/dist-sdk/agent-plugin-sdk.iife.js apps/front-react/public/agent-plugin-sdk.iife.js
```

- SDK 的 `.map` 文件不同步（线上无需 sourcemap）
- front-react **dev 模式**下 public 直接服务，同步后立即生效；生产部署需重新构建 front-react
- 同步后校验：两侧文件数一致，`public/agentplugin/index.html` 引用的 hash 与 `dist/index.html` 一致
- 已提供 skill：`agent-plugin-deploy`（构建 + 同步 + 校验一步到位）

## 目录结构

```
src/
├── adapters/          # API 适配器（实现 @km/shared-business 接口）
│   ├── agent.ts       #   IAgentApi：智能体信息（getH5Info）
│   ├── conversation.ts#   IConversationApi：会话 CRUD + 流式 completions
│   ├── upload.ts      #   IUploadApi：文件上传
│   ├── workflow.ts    #   IWorkflowApi：工作流运行
│   └── index.ts       #   聚合为 IChatAdapters
├── components/
│   ├── AgentNotFound.tsx  # 错误态（智能体不存在/登录失败）
│   └── AuthTagGroup.tsx   # 使用范围 + scopes 权限范围标签
├── config/api.ts      # api_host / auth_key（window 全局 > VITE_ 环境变量 > 默认值）
├── locales/index.ts   # 应用语言包（KeyRow 五列：key/zh-cn/zh-tw/en/ja）
├── i18n.ts            # tApp（纯函数）/ useAppTranslation（响应式）
├── sdk/               # 嵌入式 JS SDK（独立构建，详见 sdk/README.md）
├── stores/user.ts     # 用户态：token 按 agentId 分储、H5/SSO 登录、用户信息
├── utils/
│   ├── request.ts     # axios 实例（自动附加 Bearer token）
│   ├── permission.ts  # 权限检查（scopes API / 旧分组逻辑）
│   └── fingerprint.ts # 设备指纹（FingerprintJS）
├── views/chat/        # 聊天视图（组装 ChatViewBase 配置）
├── App.tsx            # 启动状态机
└── main.tsx
```

## 启动流程（App.tsx 状态机）

```
loading → agent_check → h5_login → ready / error
```

1. URL 必须携带 `token`（H5 固定令牌），否则报「缺少必要参数」
2. `POST /api/agents/h5/info` 获取智能体信息（名称/logo/描述，同时设置页面 title 和 favicon）
3. 登录（二选一）：
   - URL 带 `username` → **SSO 免登**（`POST /api/auth/sso_login`，sign/timestamp/username 三件套），成功后调用 `GET /api/users/me` 拉取用户信息（`group_ids` / `is_internal`）
   - 无 `username` → **访客登录**（`POST /api/agents/h5/login`，`fixed_token` + 设备指纹 `fingerprint_code`）；已有有效 token 时直接复用（`GET /api/users/me` 校验）
4. `ready` 后渲染 `ChatConfigProvider + ChatView`

access_token 按 agentId 分开存储（`agentplugin_access_token`），互不串联。

## 架构规范

### 适配器模式（核心）

所有数据访问通过实现 `@km/shared-business` 的接口完成，视图层不直接写请求：

```tsx
// App.tsx
<ChatConfigProvider adapters={adapters}>
  <ChatView agentId={...} agentInfo={...} />
</ChatConfigProvider>
```

- 业务接口 `/api/...`，AI 接口 `/v1/...`（completions / workflow）
- 后端字段 snake_case；JSON 字符串字段经 `formatAgentData` 解析，解析结果挂 `_obj` 后缀（`settings_obj` / `custom_config_obj` / `scopes`）
- 响应格式 `{ code, data, message }`，`code === 0` 为成功
- 流式响应：`responseType: "stream"` + `onDownloadProgress`，请求体附加 `source: "h5"`
- `uploadApi` 不走 adapters，由 `views/chat` 通过 `fileUpload.request` 显式注入

### 权限（对齐 front-react 规范）

**只有 SSO 登录才检查权限，H5 访客直接跳过。**

```tsx
// views/chat/index.tsx
const handleCheckAccess = (resourceId?: string | number) => {
  if (!isSsoLogin) return true;                                  // 访客跳过
  return checkScopePermissionAsync(resourceId || agentId, "agent"); // SSO 走后端
};
```

- SSO 用户：`GET /api/resource-scopes/check?resource_id=&resource_type=agent`，返回 `data === true` 即有权限
- 旧分组兜底：`checkVersionPermission(groupIds)` 前端比对用户 `group_ids`
- 统一入口：`checkPermissionAsync({ resourceId, resourceType, onClick })`

### 权限展示（AuthTagGroup）

- `value`：订阅分组 + 内部用户组（`/api/subscriptions/settings`、`/api/groups/type/current/4`）
- `scopes`：可见范围标签（company → 全部成员 / department / user / group，数据来自 `/api/departments/tree`、`/api/users/internal`）
- `mode="compact"`：溢出折叠为 `+n`（Tooltip 展示完整列表）
- 仅 SSO 登录时在欢迎页渲染（`slots.authTags`）

### 多语言（i18n）

- 语言包：`src/locales/index.ts`，KeyRow 五列 `[key, zh-cn, zh-tw, en, ja]`
- 消费方式：
  - `tApp(key)` — 非 React 模块（stores/utils/adapters）及 provider 外组件
  - `useAppTranslation()` — `ChatConfigProvider` 内组件，语言切换实时重渲染
- 语言优先级：localStorage（`agentplugin-lang`，与 ChatConfigProvider 共用）> 浏览器语言 > zh-cn
- ChatHeader 内置语言切换器（`languageSwitcher` feature，默认开启；embed 模式隐藏）

### 嵌入模式

URL 含 `embed=true` 或运行于 iframe（`window !== window.top`）时：

- 顶部 header 显示关闭按钮，点击通过 `postMessage({ type: 'CLOSE_REQUEST' })` 通知宿主 SDK
- 隐藏使用指引入口和语言切换按钮

## URL 参数

| 参数 | 说明 |
|------|------|
| `token` | **必填**。H5 固定令牌（后台生成） |
| `username` / `sign` / `timestamp` | SSO 免登三件套（有 `username` 即走 SSO） |
| `embed` | `true` 时进入嵌入模式 |
| `agent_id` / `conversation_id` | 指定智能体 / 初始会话 |
| `mode` / `type` / `timeout` | 视图模式 / 智能体类型（如 openclaw）/ 超时（毫秒） |

## 后端接口

| 接口 | 说明 |
|------|------|
| `POST /api/agents/h5/fixed-token` | 后台生成固定令牌（H5 不调用） |
| `POST /api/agents/h5/info` | 凭 fixed_token 获取智能体信息（未登录可用） |
| `POST /api/agents/h5/login` | fixed_token + fingerprint_code 换 access_token，自动创建访客账户 |
| `DELETE /api/agents/h5/token` | 吊销当前登录态 |
| `POST /api/auth/sso_login` | SSO 身份绑定登录 |
| `GET /api/users/me` | 用户信息（`group_ids`、`type === 2` 为内部用户） |
| `GET /api/resource-scopes/check` | 资源权限检测（SSO 内部用户） |
| `GET/POST /api/conversations...` | 会话与消息（按 user_id 自然隔离，无需 visitor_id） |
| `POST /v1/chat/completions` | 流式对话（`source: "h5"`） |
| `POST /v1/workflow/run` | 工作流运行 |

对接要点：

- **指纹稳定性**：同一设备多次访问需返回相同 `fingerprint_code`（FingerprintJS）
- **会话隔离**：后端按 user_id 隔离，前端无需额外传参；不同设备 token 不同，不要复用旧设备 token
- **错误处理**：token 过期/无效返回 401，前端引导重新走登录流程
- **ID 兼容**：`agent_id` 等路径参数兼容 hashID 与数字 ID，后端自动解码

## SDK

第三方网站通过 `<script>` 引入 `agent-plugin-sdk.iife.js`，以 Shadow DOM + iframe 方式嵌入：

- 样式隔离：Shadow DOM
- 通信：postMessage 协议（SDK→iframe：`INIT / SET_TOKEN / OPEN / CLOSE`；iframe→SDK：`READY / RESIZE / NEW_MESSAGE / AUTH_REQUIRED / CLOSE_REQUEST`）
- `agentUrl` 从 `<script src>` 自动推断；支持 `window.__AGENT_PLUGIN_SDK_CONFIG__` 声明式初始化

详见 [`src/sdk/README.md`](src/sdk/README.md)，测试页：`test-sdk.html`。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `VITE_GLOB_API_HOST` | API 地址（可被 `window.api_host` 覆盖） | `window.location.origin` |
| `VITE_GLOB_AUTH_KEY` | 认证 key（可被 `window.auth_key` 覆盖） | `53ai` |

## 开发约定

- 视图层复用 `@km/shared-business/chat` 的 `ChatViewBase`，本应用只做**配置组装**（fileUpload / openclaw / permission / slots）
- 用户可见文案一律走语言包（`src/locales`），禁止硬编码中文；`console.error` 调试日志除外
- SVG 图标来自 `packages/shared-public/icons`（vite-plugin-svg-icons，`<SvgIcon name="..." />`）
- Tailwind 内容扫描覆盖 shared-business / hub-ui-x-react / shared-components-react 源码
