# 模块开发模板

> 本文档是新建模块或重构模块的参考模板，基于 Toolbox 模块重构实践总结。

---

## 一、快速开始

### 1.1 创建新模块

```bash
# 1. 创建模块目录
mkdir -p apps/console-react/src/views/my-module/{types,api,components,__tests__}

# 2. 复制模板文件
cp -r apps/console-react/src/views/toolbox-refactored/* apps/console-react/src/views/my-module/

# 3. 重命名文件（将 toolbox 相关命名改为 my-module）
# - toolboxApi.ts → myModuleApi.ts
# - useToolboxStore → useMyModuleStore
# - ToolboxRefactoredPage → MyModulePage
```

### 1.2 重构现有模块

```bash
# 1. 创建重构目录（保持原模块不变）
cp -r apps/console-react/src/views/old-module apps/console-react/src/views/old-module-refactored

# 2. 按本模板结构重组文件
# 3. 逐步迁移，验证通过后替换原模块
```

---

## 二、目录结构规范

### 2.1 标准结构

```
module-name/
├── index.tsx                    # 主入口组件（200-350 行）
├── store.ts                     # Zustand 状态管理（可选）
├── constants.ts                 # 常量定义
├── README.md                    # 模块文档
│
├── types/                       # 类型定义
│   └── index.ts                 # 集中类型管理
│
├── api/                         # API 层
│   └── moduleApi.ts             # API 封装（支持 mock）
│
├── components/                  # 子组件（仅在必要时）
│   ├── ComponentA.tsx
│   └── ComponentB.tsx
│
├── create/                      # 创建/编辑页面（如需要）
│   ├── index.tsx                # 创建页主组件
│   └── components/              # 创建页子组件
│
├── hooks/                       # 自定义 Hooks（仅在必要时）
│   └── useModuleLogic.ts
│
└── __tests__/                   # 测试文件
    ├── TESTING_GUIDE.md         # 测试指南
    ├── index.ts                 # 测试工具导出
    ├── factories/               # 测试数据工厂
    ├── mocks/                   # MSW Mock
    ├── types/                   # 类型测试
    ├── api/                     # API 测试
    ├── components/              # 组件测试
    ├── integration/             # 集成测试
    ├── error-handling/          # 错误处理测试
    ├── performance/             # 性能测试
    └── a11y/                    # 可访问性测试
```

### 2.2 目录创建条件

| 目录 | 创建条件 | 说明 |
|------|---------|------|
| `types/` | 必须 | 类型定义集中管理 |
| `api/` | 有 API 调用时必须 | 封装 API，支持 mock |
| `store.ts` | 状态 > 5 个时推荐 | Zustand 统一管理 |
| `components/` | 有复用子组件时 | 避免过度拆分 |
| `hooks/` | 有复杂业务逻辑时 | 优先考虑 store |
| `create/` | 有创建/编辑页面时 | CRUD 模块常见 |
| `__tests__/` | 必须 | 测试覆盖 |

---

## 三、核心文件模板

### 3.1 类型定义 (`types/index.ts`)

```tsx
/**
 * 模块类型定义
 * 集中管理所有类型，便于复用和测试
 */

/**
 * 数据项（根据实际 API 响应定义）
 */
export interface DataItem {
  id: string
  name: string
  description?: string
  // ... 其他字段
}

/**
 * 分组选项
 */
export interface GroupOption {
  group_id: number
  group_name: string
  children: DataItem[]
}

/**
 * API 请求参数
 */
export interface ListParams {
  group_id?: number[]
  keyword?: string
  page?: number
  page_size?: number
}

/**
 * API 响应
 */
export interface ListResponse {
  list: DataItem[]
  total: number
}

/**
 * 表单数据（创建/编辑）
 */
export interface FormData {
  id?: string
  name: string
  // ... 其他字段
}
```

### 3.2 API 封装 (`api/moduleApi.ts`)

```tsx
/**
 * 模块 API 封装
 * 提供可测试的 API 层，支持依赖注入
 */
import { moduleApi } from '@/api/modules/module'
import type { DataItem, ListParams, ListResponse, FormData } from '../types'

/**
 * API 接口定义（便于 mock）
 */
export interface ModuleApiInterface {
  list: (params: ListParams) => Promise<DataItem[]>
  detail: (id: string) => Promise<DataItem>
  save: (data: FormData) => Promise<DataItem>
  delete: (id: string) => Promise<void>
}

/**
 * 默认 API 实现
 */
export const moduleApi: ModuleApiInterface = {
  async list(params: ListParams): Promise<DataItem[]> {
    const result = await moduleApi.list({ params })
    return result as DataItem[]
  },

  async detail(id: string): Promise<DataItem> {
    const result = await moduleApi.detail(id)
    return result as DataItem
  },

  async save(data: FormData): Promise<DataItem> {
    const result = await moduleApi.save({ data })
    return result as DataItem
  },

  async delete(id: string): Promise<void> {
    await moduleApi.delete({ data: { id } })
  },
}

/**
 * 创建可注入的 API 实例（用于测试）
 */
export function createModuleApi(
  overrides: Partial<ModuleApiInterface> = {}
): ModuleApiInterface {
  return {
    ...moduleApi,
    ...overrides,
  }
}
```

### 3.3 Zustand Store (`store.ts`)

```tsx
/**
 * 模块状态管理
 * 使用 Zustand 统一管理状态
 */
import { create } from 'zustand'
import { moduleApi } from './api/moduleApi'
import { ALL_GROUP_ID } from './constants'
import type { DataItem, GroupOption } from './types'

interface ModuleState {
  // 数据状态
  list: DataItem[]
  groupOptions: GroupOption[]

  // 筛选状态
  selectedGroups: (string | number)[]
  keyword: string

  // UI 状态
  loading: boolean
  saving: boolean

  // Actions
  loadData: () => Promise<void>
  setSelectedGroups: (groups: (string | number)[]) => void
  setKeyword: (keyword: string) => void
  setLoading: (loading: boolean) => void
  refresh: () => Promise<void>
}

export const useModuleStore = create<ModuleState>((set, get) => ({
  // 初始状态
  list: [],
  groupOptions: [],
  selectedGroups: [ALL_GROUP_ID],
  keyword: '',
  loading: false,
  saving: false,

  // Actions
  loadData: async () => {
    set({ loading: true })
    try {
      const { selectedGroups, keyword } = get()
      const data = await moduleApi.list({
        group_id: selectedGroups.filter(id => id !== ALL_GROUP_ID) as number[],
        keyword: keyword || undefined,
      })
      set({ list: data })
    } finally {
      set({ loading: false })
    }
  },

  setSelectedGroups: (groups) => set({ selectedGroups: groups }),
  setKeyword: (keyword) => set({ keyword }),
  setLoading: (loading) => set({ loading }),

  refresh: async () => {
    await get().loadData()
  },
}))
```

### 3.4 常量定义 (`constants.ts`)

```tsx
/**
 * 模块常量定义
 * 集中管理所有魔法值
 */

/** 全部分组 ID */
export const ALL_GROUP_ID = '-1'

/** 模块对应的分组类型 */
export const GROUP_TYPE_MODULE = 1

/** 默认分页大小 */
export const DEFAULT_PAGE_SIZE = 20

/** 排序方向 */
export const SORT_ORDER = {
  ASC: 'asc',
  DESC: 'desc',
} as const
```

### 3.5 主组件 (`index.tsx`)

```tsx
/**
 * 模块主页面
 */
import { useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Spin, Empty, Modal, message } from 'antd'

import Header from '@/components/Header'
import { t } from '@/locales'

import { useModuleStore } from './store'
import { moduleApi } from './api/moduleApi'
import { ALL_GROUP_ID } from './constants'
import type { DataItem } from './types'

export function ModulePage() {
  const navigate = useNavigate()

  // 从 Store 获取状态和方法
  const {
    list,
    loading,
    keyword,
    selectedGroups,
    loadData,
    setKeyword,
    setSelectedGroups,
  } = useModuleStore()

  // 初始化加载
  useEffect(() => {
    loadData()
  }, [loadData])

  // 处理关键词变更
  const handleKeywordChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setKeyword(e.target.value)
    },
    [setKeyword],
  )

  // 处理添加
  const handleAdd = useCallback(() => {
    navigate('/module/create')
  }, [navigate])

  // 处理编辑
  const handleEdit = useCallback(
    (item: DataItem) => {
      navigate(`/module/create?id=${item.id}`)
    },
    [navigate],
  )

  // 处理删除
  const handleDelete = useCallback(
    (item: DataItem) => {
      Modal.confirm({
        title: t('action_delete_tip'),
        content: t('action_delete_confirm'),
        onOk: async () => {
          await moduleApi.delete(item.id)
          message.success(t('action_delete_success'))
          loadData()
        },
      })
    },
    [loadData],
  )

  return (
    <div className="px-[60px] py-8 h-full flex flex-col">
      <Header title={t('module.title')} />

      {/* 筛选区域 */}
      <div className="mt-5 flex items-center justify-between px-2">
        <Input
          allowClear
          placeholder={t('module.search_placeholder')}
          style={{ width: 268 }}
          value={keyword}
          onChange={handleKeywordChange}
        />
        <Button type="primary" onClick={handleAdd}>
          {t('action_add')}
        </Button>
      </div>

      {/* 列表区域 */}
      <div className="mt-6 flex-1 px-2 overflow-y-auto">
        <Spin spinning={loading}>
          {list.length === 0 && !loading ? (
            <Empty description={t('no_data')} className="mt-10" />
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {list.map((item) => (
                <div
                  key={item.id}
                  className="p-4 bg-white border rounded hover:shadow-md cursor-pointer"
                  onClick={() => handleEdit(item)}
                >
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-sm text-gray-500">{item.description}</div>
                </div>
              ))}
            </div>
          )}
        </Spin>
      </div>
    </div>
  )
}

export default ModulePage
```

---

## 四、路由配置

### 4.1 添加路由

```tsx
// src/router/index.tsx
import { ModulePage } from "@/views/my-module/index"
import { ModuleCreatePage } from "@/views/my-module/create/index"

// 在 Routes 中添加
<Route path="my-module" element={<ModulePage />} />
<Route path="my-module/create" element={<ModuleCreatePage />} />
```

### 4.2 添加菜单

```tsx
// src/router/menu-config.ts
{
  path: '/my-module',
  name: 'MyModule',
  title: 'module.title',
  icon: 'module_icon',
  visible: (ctx: VisibilityContext) => checkVersion(VERSION_MODULE.MY_MODULE),
}
```

---

## 五、测试配置

### 5.1 测试数据工厂 (`__tests__/factories/index.ts`)

```tsx
/**
 * 测试数据工厂
 */
import type { DataItem, GroupOption } from '../../types'

let idCounter = 0

export function resetIdCounter(): void {
  idCounter = 0
}

function nextId(): string {
  return `test-${++idCounter}`
}

export const factories = {
  dataItem: (overrides: Partial<DataItem> = {}): DataItem => ({
    id: nextId(),
    name: 'Test Item',
    description: 'Test Description',
    ...overrides,
  }),

  dataItemList: (count: number, overrides: Partial<DataItem> = {}): DataItem[] =>
    Array.from({ length: count }, () => factories.dataItem(overrides)),

  groupOption: (overrides: Partial<GroupOption> = {}): GroupOption => ({
    group_id: 1,
    group_name: 'Test Group',
    children: [],
    ...overrides,
  }),
}

export const scenarios = {
  empty: () => ({ items: [], groups: [] }),
  minimal: () => ({
    items: [factories.dataItem()],
    groups: [factories.groupOption()],
  }),
  standard: () => ({
    items: factories.dataItemList(10),
    groups: [factories.groupOption(), factories.groupOption({ group_id: 2 })],
  }),
}
```

### 5.2 MSW Handlers (`__tests__/mocks/handlers.ts`)

```tsx
import { http, HttpResponse } from 'msw'
import { factories } from '../factories'

let dataStore = {
  items: factories.dataItemList(5),
}

export function resetDataStore(): void {
  dataStore = { items: factories.dataItemList(5) }
}

export const moduleHandlers = [
  http.get('/api/module/list', () => {
    return HttpResponse.json(dataStore.items)
  }),

  http.post('/api/module/save', async ({ request }) => {
    const body = await request.json()
    const newItem = factories.dataItem(body as Partial<DataItem>)
    dataStore.items.push(newItem)
    return HttpResponse.json(newItem)
  }),

  http.delete('/api/module/delete', async ({ request }) => {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    dataStore.items = dataStore.items.filter(item => item.id !== id)
    return HttpResponse.json({ success: true })
  }),
]

export const errorHandlers = {
  networkError: http.get('/api/module/list', () => HttpResponse.error()),
  serverError: http.get('/api/module/list', () =>
    HttpResponse.json({ error: 'Server Error' }, { status: 500 })
  ),
}
```

---

## 六、开发检查清单

### 6.1 代码质量

- [ ] 主组件行数 < 350 行
- [ ] 无 `any` 类型
- [ ] 无魔法值（使用 constants.ts）
- [ ] 类型定义集中在 `types/index.ts`
- [ ] API 调用封装在 `api/` 目录
- [ ] 组件有 JSDoc 注释

### 6.2 状态管理

- [ ] 相关状态使用 Zustand 统一管理
- [ ] Store 有清晰的类型定义
- [ ] Store 支持测试重置

### 6.3 测试

- [ ] 单元测试覆盖核心逻辑
- [ ] 集成测试覆盖主要流程
- [ ] 错误处理测试覆盖异常场景
- [ ] 测试全部通过

### 6.4 文档

- [ ] 有 README.md 说明模块职责
- [ ] 复杂逻辑有注释说明
- [ ] 公共 API 有 JSDoc 注释

---

## 七、重构对比示例

以 Toolbox 模块为例：

| 指标 | 原版 | 重构版 |
|------|------|--------|
| 列表页行数 | 424 行 | ~300 行 |
| 创建页行数 | 417 行 | ~350 行 |
| 状态管理 | 14+ useState | Zustand store |
| 测试覆盖 | 0 | 50+ 个测试 |
| 类型安全 | 部分 any | 完全类型安全 |
| API 可测试 | 不可 mock | 支持依赖注入 |

---

## 八、相关文档

- [测试完整指南](./__tests__/TESTING_GUIDE.md) - 测试策略和最佳实践
- [项目重构规范](../../docs/REFACTOR_GUIDE.md) - 通用重构规范
- [CLAUDE.md](../../../.claude/CLAUDE.md) - 项目开发约束
