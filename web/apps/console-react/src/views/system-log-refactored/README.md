# System Log 模块（重构版）

系统日志管理模块，提供日志查询、筛选、分页等功能。

## 目录结构

```
system-log-refactored/
├── index.tsx              # 主页面组件 (~120 行)
├── store.ts               # Zustand 状态管理
├── constants.ts           # 常量定义
├── types/                 # 类型定义
│   └── index.ts           # 复用共享 @/api/modules/system-log 类型
└── __tests__/             # 测试文件
    ├── index.ts           # 测试工具导出
    ├── factories/         # 测试数据工厂
    ├── types/             # 类型测试
    ├── integration/       # 集成测试
    └── store.test.ts      # store 测试
```

## 设计原则

### 简洁优先
- 主组件保持 ~120 行，逻辑清晰
- 使用 Zustand 统一状态管理，替代 6 个 useState

### 可测试性
- API 层直接复用共享 `@/api/modules/system-log`，测试 `vi.mock` 该模块即可
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
  loading,
  loadList,
  loadActions,
  loadModules,
} = useSystemLogStore()
```

### Store 状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `list` | `SystemLogDisplayItem[]` | 日志列表 |
| `total` | `number` | 总数 |
| `actions` | `ActionItem[]` | 操作类型列表 |
| `modules` | `ModuleItem[]` | 模块列表 |
| `loading` | `boolean` | 加载状态 |

> 筛选条件（分页 / 操作类型 / 模块 / 日期区间）不存 Store，由 `useListState` hook 做 URL 持久化，见 `index.tsx`。

### Store Actions

| Action | 说明 |
|--------|------|
| `loadList` | 加载日志列表（参数由组件从 URL 状态传入） |
| `loadActions` | 加载操作类型列表 |
| `loadModules` | 加载模块列表 |

## API 层

本模块**不重复封装** API，直接复用共享 `@/api/modules/system-log`（含 `systemLogApi` 与 `transformSystemLogList`）：

```tsx
import { systemLogApi, transformSystemLogList } from '@/api/modules/system-log'

// 获取列表
const response = await systemLogApi.list({ offset: 0, limit: 10 })
const displayList = transformSystemLogList(response.system_logs)

// 获取操作类型
const actions = await systemLogApi.actions()

// 获取模块列表
const modules = await systemLogApi.modules()
```

类型经 `types/index.ts` re-export 共享，`SystemLogListParams` 即共享的 `SystemLogListRequest`。

## 测试

```bash
# 运行模块测试
pnpm vitest run src/views/system-log-refactored

# 测试覆盖
# - types 测试: 6 个
# - store 测试: 18 个
# - 集成测试: 13 个
# 总计: 37 个测试
```

### 测试目录结构

```
__tests__/
├── index.ts                   # 测试工具导出
├── factories/                 # 测试数据工厂
│   └── index.ts              # 统一的测试数据创建函数
├── store.test.ts              # Store 测试
├── types/                     # 类型测试
│   └── index.test.ts
└── integration/               # 集成测试
    └── SystemLogPage.test.tsx
```

## 关键设计

1. **状态管理**：筛选条件 URL 持久化（`useListState`），数据状态用 Zustand 统一管理
2. **测试覆盖**：37 个测试（types / store / 集成）
3. **类型安全**：消除 `any`，类型集中管理
4. **简洁**：主组件 ~120 行，逻辑清晰
5. **可维护性**：常量集中管理，消除魔法值

## 路由配置

更新路由以使用重构版：

```tsx
// src/router/index.tsx
import { SystemLogRefactoredPage } from "@/views/system-log-refactored/index"

// 替换原路由
<Route path="system-log" element={<SystemLogRefactoredPage />} />
```
