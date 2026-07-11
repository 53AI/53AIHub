# Agent Plugin SDK

嵌入式 JS SDK，允许第三方网站通过 `<script>` 标签引入 Agent Chat 功能。

## 安装

```html
<script src="agent-plugin-sdk.iife.js"></script>
```

## 使用方式

### 方式一：编程式初始化

```html
<script src="https://chat.example.com/agent-plugin-sdk.iife.js"></script>
<script>
  AgentPluginSDK.init({
    token: 'your-h5-token-here',
    name: 'AI 助手',
    logo: 'https://cdn.example.com/avatar.png'
  });
</script>
```

### 方式二：声明式初始化

```html
<script>
  window.__AGENT_PLUGIN_SDK_CONFIG__ = {
    token: 'your-h5-token-here',
    name: 'AI 助手'
  };
</script>
<script src="https://chat.example.com/agent-plugin-sdk.iife.js"></script>
```

> **注意**：`agentUrl` 自动从 `<script src>` 推断，无需手动配置。

### 方式三：SSO 免登

通过 SSO 参数实现免登录，用户无需手动输入账号密码即可直接进入聊天。

```html
<script src="https://chat.example.com/agent-plugin-sdk.iife.js"></script>
<script>
  AgentPluginSDK.init({
    token: 'your-h5-token-here',
    sso: {
      sign: 'xxxxxx',           // SSO 签名
      timestamp: '1700000000',  // 时间戳
      username: 'user1'         // 用户名
    }
  });
</script>
```

也可以直接通过 URL 参数传递 SSO 信息（无需 SDK，适用于直接跳转场景）：

```
https://chat.example.com/?token=your-h5-token-here&embed=true&sso_sign=xxx&sso_timestamp=xxx&sso_username=xxx
```

## 配置选项

| 选项 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `agentUrl` | `string` | 否 | 自动推断 | Agent Plugin 应用 URL（自动从 script src 推断） |
| `token` | `string` | 是 | - | H5 固定 Token（从控制台获取） |
| `name` | `string` | 否 | `'Agent Chat'` | 智能体名称 |
| `logo` | `string` | 否 | 内置图标 | 智能体 Logo 图片 URL |
| `position` | `string` | 否 | `'bottom-right'` | 按钮位置：`'bottom-right'` 或 `'bottom-left'` |
| `width` | `string` | 否 | `'400px'` | 面板宽度 |
| `height` | `string` | 否 | `'600px'` | 面板高度 |
| `autoOpen` | `boolean` | 否 | `false` | 是否自动打开面板 |
| `persistState` | `boolean` | 否 | `true` | 是否持久化面板状态 |
| `offset` | `object` | 否 | `{ bottom: '24px', right: '24px' }` | 边距偏移 |
| `theme` | `object` | 否 | `{ primaryColor: '#2563EB' }` | 主题配置 |
| `sso` | `object` | 否 | - | SSO 免登参数 |

### 主题配置

```typescript
theme: {
  primaryColor?: string;    // 主色调，默认 #2563EB
  backgroundColor?: string; // 背景色，默认 #ffffff
}
```

### SSO 配置

```typescript
sso: {
  sign: string;       // SSO 签名（必填）
  timestamp: string;  // 时间戳（必填）
  username: string;   // 用户名（必填）
}
```

**SSO 登录流程：**
1. SDK 将 SSO 参数附加到 iframe URL（`sso_sign`、`sso_timestamp`、`sso_username`）
2. agent-plugin 应用检测到 URL 中的 SSO 参数后，调用 `POST /api/auth/sso_login` 接口
3. 接口验证签名通过后返回 `access_token`，自动完成登录
4. SSO 登录失败时回退到普通登录页面

**URL 参数说明：**

| URL 参数 | 说明 |
|----------|------|
| `sso_sign` | SSO 签名 |
| `sso_timestamp` | SSO 时间戳 |
| `sso_username` | SSO 用户名 |

## API

### `AgentPluginSDK.init(config)`

初始化 SDK，返回 SDK 实例。

```javascript
const sdk = AgentPluginSDK.init({
  token: 'your-h5-token-here',
  name: 'AI 助手'
});
```

### 实例方法

#### `sdk.open()`

打开面板。

```javascript
sdk.open();
```

#### `sdk.close()`

关闭面板。

```javascript
sdk.close();
```

#### `sdk.toggle()`

切换面板状态。

```javascript
sdk.toggle();
```

#### `sdk.destroy()`

销毁 SDK 实例，移除 DOM 元素。

```javascript
sdk.destroy();
```

#### `sdk.getState()`

获取当前状态。

```javascript
const state = sdk.getState();
// { isOpen: boolean, isReady: boolean }
```

### 静态属性

#### `AgentPluginSDK.version`

SDK 版本号。

```javascript
console.log(AgentPluginSDK.version); // '1.0.0'
```

## 构建命令

```bash
# 构建 SDK
pnpm build:sdk

# 构建主应用 + SDK
pnpm build:all
```

## 构建产物

- `dist-sdk/agent-plugin-sdk.iife.js` - SDK 文件
- `dist-sdk/agent-plugin-sdk.iife.js.map` - Source Map

## 架构设计

### 样式隔离

SDK 使用 Shadow DOM 实现样式隔离，确保宿主页面的 CSS 不会影响 SDK 的样式，反之亦然。

### iframe 通信

SDK 与 iframe 之间通过 `postMessage` 进行跨域通信：

**SDK → iframe 消息：**
- `INIT`: 初始化配置
- `SET_TOKEN`: 设置认证 Token
- `OPEN` / `CLOSE`: 面板状态变化

**iframe → SDK 消息：**
- `READY`: iframe 加载完成
- `RESIZE`: 请求调整大小
- `NEW_MESSAGE`: 新消息通知
- `AUTH_REQUIRED`: 需要认证
- `CLOSE_REQUEST`: 请求关闭面板（点击关闭按钮）

### 嵌入模式

当 agent-plugin 应用以 iframe 模式运行时（URL 含 `embed=true`）：
- 显示顶部 header，右侧带关闭按钮
- 隐藏使用指引和语言切换按钮
- 点击关闭按钮时通知 SDK 关闭面板
- 登录页面右上角显示关闭按钮

## 测试

1. 构建 SDK：`pnpm build:sdk`
2. 启动主应用：`pnpm dev`
3. 打开 `test-sdk.html` 测试页面
4. 点击 "Initialize SDK" 按钮初始化

## 注意事项

1. **跨域问题**：确保 `agentUrl` 的服务器配置了正确的 CORS 头，允许 iframe 嵌入
2. **认证**：认证 Token 在 iframe 内管理，不会暴露给宿主页面
3. **安全性**：SDK 会验证 `postMessage` 的来源，只接受来自配置的 `agentUrl` 的消息
4. **SSO 签名**：SSO 签名由后端生成，确保签名有效期内使用。签名过期或无效时将回退到登录页面

## 许可证

MIT
