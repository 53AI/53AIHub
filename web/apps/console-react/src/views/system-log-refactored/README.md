# System Log 模块（重构版）

系统日志管理模块，提供日志查询、筛选、分页等功能。

## 目录结构

```
system-log-refactored/
├── index.tsx              # 主页面组件 (~120 行)
├── store.ts               # Zustand 状态管理
├── constants.ts           # 常量定义
├── types/                 # 类型定义
│   └── index.ts           # 集中类型管理
├── api/                   # API 层
│   └── systemLogApi.ts    # API 封装（支持 mock）
└── __tests__/             # 测试文件
    ├── index.ts           # 测试工具导出
    ├── factories/         # 测试数据工厂
    ├── mocks/             # MSW Mock 配置
    ├── types/             # 类型测试
    ├── api/               # API 测试
    ├── integration/       # 集成测试
    └── error-handling/    # 错误处理测试
```

## 设计原则

### 简洁优先
- 主组件保持 ~120 行，逻辑清晰
- 使用 Zustand 统一状态管理，替代 6 个 useState

### 可测试性
- API 层支持依赖注入，便于 mock
- 组件 Props 类型明确，易于测试
- Zustand store 可在测试中直接重置状态

### 可维护性
- 目录结构清晰，模块边界明确
- 类型定义集中管理，避免 `any`
- 常量集中定义，消除魔法值

## 使用示例

```tsx
// 列表页
import { SystemLogRefactoredPage } from '@/views/system-log-refactored'
<Route path="/system-log" element={<SystemLogRefactoredPage />} />
```

## 状态管理

使用 Zustand 统一管理列表页状态：

```tsx
import { useSystemLogStore } from './store'

// 在组件中使用
const {
  list,
  total,
  actions,
  modules,
  params,
  loading,
  loadList,
  setParams,
  setDateRange,
} = useSystemLogStore()
```

### Store 状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `list` | `SystemLogDisplayItem[]` | 日志列表 |
| `total` | `number` | 总数 |
| `actions` | `ActionItem[]` | 操作类型列表 |
| `modules` | `ModuleItem[]` | 模块列表 |
| `params` | `SystemLogListParams` | 请求参数 |
| `dateRange` | `[number | null, number | null]` | 日期范围 |
| `loading` | `boolean` | 加载状态 |

### Store Actions

| Action | 说明 |
|--------|------|
| `loadList` | 加载日志列表 |
| `loadActions` | 加载操作类型列表 |
| `loadModules` | 加载模块列表 |
| `setParams` | 设置请求参数（会触发重新加载） |
| `setDateRange` | 设置日期范围（会触发重新加载） |
| `resetParams` | 重置所有参数 |
| `refresh` | 刷新数据 |

## API 层

`systemLogApi` 封装所有 API 调用：

```tsx
import { systemLogApi } from './api/systemLogApi'

// 获取列表
const items = await systemLogApi.list({ offset: 0, limit: 10 })

// 获取操作类型
const actions = await systemLogApi.actions()

// 获取模块列表
const modules = await systemLogApi.modules()

// 创建日志
await systemLogApi.create({ action: 1, content: '日志内容' })
```

## 测试

```bash
# 运行模块测试
pnpm vitest run src/views/system-log-refactored

# 测试覆盖
# - types 测试: 6 个
# - api 测试: 8 个
# - 集成测试: 6 个
# - 错误处理测试: 6 个
# 总计: 26 个测试
```

### 测试目录结构

```
__tests__/
├── index.ts                   # 测试工具导出
├── factories/                 # 测试数据工厂
│   └── index.ts              # 统一的测试数据创建函数
├── mocks/                     # MSW Mock 配置
│   ├── handlers.ts           # API Handlers
│   └── server.ts             # Server 配置
├── types/                     # 类型测试
│   └── index.test.ts
├── api/                       # API 测试
│   └── systemLogApi.test.ts
├── integration/               # 集成测试
│   └── SystemLogPage.test.tsx
└── error-handling/            # 错误处理测试
    └── ErrorHandling.test.tsx
```

## 重构对比

| 指标 | 原版 | 重构版 |
|------|------|--------|
| 主组件行数 | 215 行 | ~120 行 |
| 状态管理 | 6 个 useState | Zustand store |
| 测试覆盖 | 0 | 26 个测试 |
| 类型安全 | 部分 any | 完全类型安全 |
| API 可测试 | 不可 mock | 支持依赖注入 |

## 关键改进

1. **状态管理**：6 个 useState → Zustand 统一管理
2. **测试覆盖**：0 → 26 个测试
3. **类型安全**：消除所有 `any`，集中类型定义
4. **代码简洁**：主组件行数减少 44%
5. **可维护性**：常量集中管理，消除魔法值

## 路由配置

更新路由以使用重构版：

```tsx
// src/router/index.tsx
import { SystemLogRefactoredPage } from "@/views/system-log-refactored/index"

// 替换原路由
<Route path="system-log" element={<SystemLogRefactoredPage />} />
```
