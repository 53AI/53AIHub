# @km/front-react

React 版本的知识管理前端应用，从 Vue 3 项目完整迁移。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript |
| 状态管理 | Zustand (替代 Pinia) |
| 路由 | React Router v6 (替代 Vue Router) |
| UI 组件 | Ant Design 5.x (替代 Element Plus) |
| 样式 | Tailwind CSS + CSS Modules |
| 构建工具 | Vite 5.x |
| 国际化 | i18next (替代 vue-i18n) |
| HTTP 客户端 | Axios |

## 快速开始

```bash
# 安装依赖 (在 monorepo 根目录)
pnpm install

# 启动开发服务器
cd apps/front-react
pnpm dev

# 构建生产版本
pnpm build

# 预览生产版本
pnpm preview

# 代码检查
pnpm lint

# 运行测试
pnpm test
```

## 项目结构

```
apps/front-react/
├── public/                 # 静态资源
├── src/
│   ├── api/               # API 接口层
│   │   ├── index.ts       # Axios 实例配置
│   │   └── modules/       # API 模块
│   │       ├── agents/    # 智能体 API
│   │       ├── chat.ts    # 聊天 API
│   │       ├── files/     # 文件 API
│   │       ├── libraries/ # 知识库 API
│   │       └── user/      # 用户 API
│   │
│   ├── components/        # 公共组件
│   │   ├── Chat/          # 聊天组件
│   │   │   ├── Sender.tsx # 消息发送
│   │   │   └── Message.tsx# 消息展示
│   │   ├── FileSearch/    # 文件搜索
│   │   ├── LoginModal/    # 登录弹窗
│   │   ├── ExpireModal/   # 过期提醒
│   │   └── ProfilePopover/# 用户信息
│   │
│   ├── constants/         # 常量定义
│   │   ├── events.ts      # 事件常量
│   │   ├── navigation.ts  # 导航常量
│   │   └── storage.ts     # 存储常量
│   │
│   ├── hooks/             # 自定义 Hooks
│   │   ├── useBasicLayout.ts # 响应式布局
│   │   ├── useChat.ts     # 聊天功能
│   │   ├── useEnv.ts      # 环境检测
│   │   ├── useFile.ts     # 文件操作
│   │   └── useMobile.ts   # 短信验证
│   │
│   ├── locales/           # 国际化
│   │   └── index.ts       # i18next 配置
│   │
│   ├── router/            # 路由配置
│   │   └── index.tsx      # React Router
│   │
│   ├── stores/            # Zustand 状态管理
│   │   ├── index.ts
│   │   └── modules/
│   │       ├── agent.ts   # 智能体状态
│   │       ├── conversation.ts # 对话状态
│   │       ├── enterprise.ts # 企业状态
│   │       ├── navigation.ts # 导航状态
│   │       ├── shortcuts.ts # 快捷方式
│   │       ├── space.ts   # 空间状态
│   │       └── user.ts    # 用户状态
│   │
│   ├── styles/            # 全局样式
│   │   ├── index.css      # 入口样式
│   │   └── variables.css  # CSS 变量
│   │
│   ├── types/             # 类型定义
│   │   └── index.ts
│   │
│   ├── utils/             # 工具函数
│   │   ├── index.ts       # 通用工具
│   │   ├── permission.ts  # 权限工具
│   │   └── router.ts      # 路由工具
│   │
│   ├── views/             # 页面组件
│   │   ├── layout.tsx     # 主布局
│   │   ├── agent/         # 智能体
│   │   ├── chat/          # 聊天
│   │   ├── custom/        # 自定义页面
│   │   ├── exception/     # 异常页面
│   │   ├── guide/         # 引导页
│   │   ├── index/         # 首页
│   │   ├── knowledge/     # 知识库
│   │   ├── library/       # 文档库
│   │   ├── mine/          # 个人中心
│   │   ├── order/         # 订单
│   │   ├── profile/       # 个人信息
│   │   ├── prompt/        # 提示词
│   │   ├── share/         # 分享
│   │   ├── space/         # 空间
│   │   └── toolkit/       # AI工具
│   │
│   ├── App.tsx            # 根组件
│   ├── main.tsx           # 入口文件
│   └── global.d.ts        # 全局类型
│
├── .env                   # 环境变量
├── index.html             # HTML 模板
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

## 核心功能

### 1. 状态管理 (Zustand)

```typescript
// 使用示例
import { useUserStore } from '@/stores/modules/user'

function Component() {
  const { info, is_login, login, logout } = useUserStore()

  // 状态和操作都可以直接解构使用
}
```

### 2. 路由配置

```typescript
// 支持动态路由和权限守卫
const routes = [
  {
    path: '/library/:id',
    element: <PermissionGuard auth><LibraryView /></PermissionGuard>
  }
]
```

### 3. API 请求

```typescript
// 统一的请求封装
import request from '@/api'

// 或使用模块化 API
import userApi from '@/api/modules/user'
const result = await userApi.me()
```

### 4. 自定义 Hooks

```typescript
// 聊天功能
const { messages, sendMessage, streaming } = useChat({ agentId })

// 文件上传
const { uploadFile, uploading, uploadProgress } = useFile({ libraryId })

// 响应式布局
const { isMdScreen, isInMobile } = useBasicLayout()
```

## 从 Vue 迁移指南

### 状态管理转换

```typescript
// Vue (Pinia)
export const useUserStore = defineStore('user', {
  state: () => ({ user: null }),
  actions: {
    async login(data) { ... }
  }
})

// React (Zustand)
export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  login: async (data) => { ... }
}))
```

### 组件转换

```typescript
// Vue
<template>
  <el-button @click="handleClick">{{ title }}</el-button>
</template>
<script setup>
import { ref } from 'vue'
const title = ref('Click')
</script>

// React
import { useState } from 'react'
import { Button } from 'antd'

export function Component() {
  const [title] = useState('Click')
  return <Button onClick={handleClick}>{title}</Button>
}
```

### 路由转换

```typescript
// Vue Router
{
  path: '/chat',
  component: () => import('@/views/chat/index.vue'),
  meta: { auth: true }
}

// React Router
{
  path: '/chat',
  element: <PermissionGuard auth><ChatView /></PermissionGuard>
}
```

## 环境变量

```env
VITE_PLATFORM=km
VITE_INCLUDE_KM=true
VITE_PRIVATE_PREM=false
VITE_GLOB_API_HOST=https://api.example.com
VITE_GLOB_ADMIN_URL=https://admin.example.com
```

## 开发规范

### 组件命名
- 组件文件使用 PascalCase: `LoginModal.tsx`
- 组件函数使用 PascalCase: `export function LoginModal() {}`

### 样式规范
- 优先使用 Tailwind CSS 类
- 复杂样式使用独立 CSS 文件
- CSS 变量定义在 `styles/variables.css`

### API 规范
- API 模块放在 `api/modules/` 目录
- 每个模块导出默认对象包含所有方法
- 使用 TypeScript 定义请求和响应类型

## 依赖说明

### 共享包
- `@km/shared-utils` - 共享工具函数
- `@km/shared-components-react` - 共享 React 组件

## 浏览器支持

- Chrome >= 90
- Firefox >= 88
- Safari >= 14
- Edge >= 90

## License

MIT
