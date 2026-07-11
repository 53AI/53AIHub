# React 模块重构规范

> 基于 Toolbox 模块重构实践总结，供其他模块参考。

## 一、核心原则

### 1.1 简洁优先

**避免过度拆分**：主组件保持在 200-350 行，不要为了拆分而拆分。

```
✅ 好的做法：
- index.tsx ~300 行，包含完整的页面逻辑
- 使用 Zustand 统一管理状态，替代多个 useState

❌ 避免：
- 每个小功能都拆成独立组件
- 创建过多的 hooks 文件
- 文件数量膨胀
```

### 1.2 状态管理

**使用 Zustand 统一状态**：当组件有 5+ 个相关状态时，考虑使用 Zustand。

```tsx
// ✅ 推荐：Zustand store
export const useToolboxStore = create<ToolboxState>((set, get) => ({
  // 数据状态
  aiLinkList: [],
  groupOptions: [],

  // 筛选状态
  selectedGroups: [ALL_GROUP_ID],
  keyword: '',

  // UI 状态
  loading: false,
  isSort: false,

  // Actions
  loadListData: async () => { /* ... */ },
  setKeyword: (keyword) => set({ keyword }),
}))

// ❌ 避免：分散的 useState
const [list, setList] = useState([])
const [loading, setLoading] = useState(false)
const [keyword, setKeyword] = useState('')
// ... 10+ 个 useState
```

### 1.3 组件复用

**优先复用现有组件**：不要重复造轮子。

```tsx
// ✅ 复用原版组件
import UseGroup from '../../toolbox/create/components/UseGroup'
import SharedAccountTable from '../../toolbox/create/components/SharedAccountTable'

// ❌ 重新实现
const MyUseGroup = () => { /* 重复实现 */ }
```

## 二、目录结构规范

### 2.1 标准结构

```
module-name/
├── index.tsx              # 主入口组件（200-350 行）
├── store.ts               # Zustand 状态管理（如有）
├── constants.ts           # 常量定义
├── README.md              # 模块文档
├── types/
│   └── index.ts           # 类型定义集中管理
├── api/
│   └── moduleApi.ts       # API 封装（支持 mock）
├── components/            # 子组件（仅在必要时）
│   └── ComponentName.tsx
├── hooks/                 # Hooks（仅在必要时）
│   └── useModuleLogic.ts
└── __tests__/
    ├── types.ts           # 测试类型
    ├── api/               # API 测试
    └── integration/       # 集成测试
```

### 2.2 子目录规则

| 目录 | 创建条件 | 示例 |
|------|---------|------|
| `types/` | 类型定义超过 50 行 | 接口、类型别名 |
| `api/` | 有 API 调用 | 封装后端接口 |
| `components/` | 有可复用子组件 | 表格、对话框 |
| `hooks/` | 有复杂业务逻辑 | 数据处理、状态转换 |
| `__tests__/` | 必须有 | 单元测试、集成测试 |

## 三、类型定义规范

### 3.1 集中管理

所有类型定义放在 `types/index.ts`：

```tsx
// types/index.ts

/** AI 链接项 */
export interface AiLinkItem {
  ai_link_id: string
  name: string
  description?: string
  logo?: string
  url?: string
  group_id: number
  sort: number
}

/** 分组选项 */
export interface GroupOption {
  group_id: number
  group_name: string
  children: AiLinkItem[]
}

/** 共享账号项 */
export interface SharedAccountItem {
  account: string
  password: string
  remark?: string
}
```

### 3.2 避免 any

```tsx
// ✅ 使用具体类型
const handleDelete = async (item: AiLinkItem) => { /* ... */ }

// ❌ 使用 any
const handleDelete = async (item: any) => { /* ... */ }
```

### 3.3 导出类型

```tsx
// 导出类型供其他模块使用
export type { AiLinkItem, GroupOption, SharedAccountItem }
```

## 四、API 层规范

### 4.1 封装 API 调用

```tsx
// api/toolboxApi.ts
import aiLinkApi from '@/api/modules/aiLink'
import groupApi from '@/api/modules/group'
import type { AiLinkItem, GroupOption, RawGroupOption } from '../types'
import { GROUP_TYPE_AI_LINK } from '../constants'

/** API 参数类型 */
interface AiLinkListParams {
  group_id?: number[]
  keyword?: string
}

/** API 返回类型 */
interface AiLinkListResponse {
  data: AiLinkItem[]
  total: number
}

/** Toolbox API 接口 */
export interface ToolboxApiInterface {
  list: (params: AiLinkListParams) => Promise<AiLinkItem[]>
  save: (data: Record<string, unknown>) => Promise<AiLinkItem>
  delete: (id: string) => Promise<void>
  loadGroups: (groupType: number) => Promise<RawGroupOption[]>
}

/** 创建 API 实例（支持依赖注入） */
export const createToolboxApi = (overrides?: Partial<ToolboxApiInterface>): ToolboxApiInterface => ({
  list: async (params: AiLinkListParams) => {
    const response = await aiLinkApi.list({ params })
    return response.data || []
  },

  save: async (data) => {
    const response = await aiLinkApi.save({ data })
    return response.data
  },

  delete: async (id) => {
    await aiLinkApi.delete({ params: { ai_link_id: id } })
  },

  loadGroups: async (groupType) => {
    const list = await groupApi.list({ params: { group_type: groupType } })
    return (list || []).map((item) => ({
      group_id: item.group_id,
      group_name: item.group_name,
      sort: item.sort ?? 0,
    }))
  },

  ...overrides,
})

/** 默认 API 实例 */
export const toolboxApi = createToolboxApi()
```

### 4.2 依赖注入模式

```tsx
// 支持测试时注入 mock
const mockApi = createToolboxApi({
  list: vi.fn().mockResolvedValue([mockItem1, mockItem2]),
})
```

## 五、Zustand Store 规范

### 5.1 Store 结构

```tsx
// store.ts
import { create } from 'zustand'
import type { AiLinkItem, GroupOption } from './types'
import { toolboxApi } from './api/toolboxApi'
import { ALL_GROUP_ID } from './constants'

interface ModuleState {
  // 数据状态
  list: AiLinkItem[]
  groupOptions: GroupOption[]

  // 筛选状态
  selectedGroups: (string | number)[]
  keyword: string

  // UI 状态
  loading: boolean
  saving: boolean
  isSort: boolean

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
  isSort: false,

  // Actions 实现
  loadData: async () => {
    set({ loading: true })
    try {
      const data = await toolboxApi.list({})
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

### 5.2 在组件中使用

```tsx
// index.tsx
export function ModulePage() {
  // 从 Store 获取状态和方法
  const {
    list,
    loading,
    keyword,
    loadData,
    setKeyword,
  } = useModuleStore()

  // 初始化加载
  useEffect(() => {
    loadData()
  }, [loadData])

  return (
    <div>
      {/* UI 渲染 */}
    </div>
  )
}
```

## 六、测试规范

### 6.1 测试文件结构

```
__tests__/
├── types.ts               # 测试类型定义（用于 mock）
├── types/
│   └── index.test.ts      # 类型测试
├── api/
│   └── moduleApi.test.ts  # API 测试
└── integration/
    └── ModulePage.test.tsx # 集成测试
```

### 6.2 Zustand Store 测试重置

```tsx
// 每个测试前后重置 store
import { useModuleStore } from '../store'
import { ALL_GROUP_ID } from '../constants'

describe('Module 测试', () => {
  beforeEach(() => {
    // 重置到初始状态
    useModuleStore.setState({
      list: [],
      groupOptions: [],
      selectedGroups: [ALL_GROUP_ID],
      keyword: '',
      loading: false,
      isSort: false,
    })
  })

  afterEach(() => {
    // 清理
    useModuleStore.setState({
      list: [],
      keyword: '',
    })
  })

  it('应该正确渲染', async () => {
    await act(async () => {
      render(<ModulePage />)
    })
    // 断言...
  })
})
```

### 6.3 API Mock

```tsx
// mock API 模块
vi.mock('../api/moduleApi', () => ({
  moduleApi: {
    list: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  },
}))

// 在测试中配置返回值
beforeEach(() => {
  vi.mocked(mockApi.list).mockResolvedValue([mockItem1, mockItem2])
})
```

### 6.4 使用 act() 处理状态更新

```tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

it('测试状态变化', async () => {
  // 初始渲染用 act 包装
  await act(async () => {
    render(<ModulePage />)
  })

  // 点击事件触发状态更新
  act(() => {
    fireEvent.click(screen.getByText('按钮'))
  })

  // 等待异步更新
  await waitFor(() => {
    expect(screen.getByText('结果')).toBeInTheDocument()
  })
})
```

## 七、常量管理规范

### 7.1 集中定义

```tsx
// constants.ts

/** 全部分组 ID */
export const ALL_GROUP_ID = '-1'

/** AI 链接分组类型 */
export const GROUP_TYPE_AI_LINK = 3

/** 默认分页大小 */
export const DEFAULT_PAGE_SIZE = 20

/** 排序方向 */
export const SORT_ORDER = {
  ASC: 'asc',
  DESC: 'desc',
} as const
```

### 7.2 消除魔法值

```tsx
// ❌ 魔法值
if (type === 3) { /* ... */ }
if (id === '-1') { /* ... */ }

// ✅ 使用常量
import { GROUP_TYPE_AI_LINK, ALL_GROUP_ID } from './constants'

if (type === GROUP_TYPE_AI_LINK) { /* ... */ }
if (id === ALL_GROUP_ID) { /* ... */ }
```

## 八、代码风格规范

### 8.1 组件结构

```tsx
/**
 * 模块页面
 * 功能描述
 */
export function ModulePage() {
  // 1. Hooks
  const navigate = useNavigate()
  const { list, loading, loadData } = useModuleStore()

  // 2. 计算属性
  const filteredList = list.filter(item => item.active)

  // 3. 回调函数
  const handleClick = useCallback((id: string) => {
    navigate(`/detail/${id}`)
  }, [navigate])

  // 4. Effects
  useEffect(() => {
    loadData()
  }, [loadData])

  // 5. 渲染
  return (
    <div className="container">
      {/* UI */}
    </div>
  )
}
```

### 8.2 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `ModulePage`, `UserList` |
| 函数 | camelCase | `handleClick`, `loadData` |
| 常量 | UPPER_SNAKE_CASE | `ALL_GROUP_ID`, `DEFAULT_PAGE_SIZE` |
| 类型 | PascalCase | `AiLinkItem`, `GroupOption` |
| 文件 | camelCase 或 PascalCase | `index.tsx`, `ModulePage.tsx` |

### 8.3 注释规范

```tsx
/**
 * 加载列表数据
 * @description 从 API 获取数据并更新 store
 */
const loadData = async () => { /* ... */ }

// 单行注释说明复杂逻辑
const sortedList = list.sort((a, b) => b.sort - a.sort) // 按排序值降序
```

## 九、重构检查清单

### 9.1 代码质量

- [ ] 主组件行数 < 350 行
- [ ] 无 `any` 类型
- [ ] 无魔法值
- [ ] 常量集中在 `constants.ts`
- [ ] 类型定义集中在 `types/index.ts`
- [ ] API 调用封装在 `api/` 目录

### 9.2 状态管理

- [ ] 相关状态使用 Zustand 统一管理
- [ ] Store 有清晰的类型定义
- [ ] Store 支持测试重置

### 9.3 测试

- [ ] 单元测试覆盖核心逻辑
- [ ] 集成测试覆盖主要流程
- [ ] 测试全部通过
- [ ] 每个 test 前后正确重置状态

### 9.4 文档

- [ ] 有 README.md 说明模块职责
- [ ] 复杂逻辑有注释说明
- [ ] 公共 API 有 JSDoc 注释

## 十、参考示例

### Toolbox 模块重构对比

| 指标 | 原版 | 重构版 |
|------|------|--------|
| 列表页行数 | 424 行 | ~300 行 |
| 创建页行数 | 417 行 | ~350 行 |
| useState 数量 | 14 个 | Zustand store |
| 测试覆盖 | 0 | 26 个测试 |
| 类型安全 | 部分 any | 完全类型安全 |

### 关键改进

1. **状态管理**：14+ useState → Zustand 统一管理
2. **测试覆盖**：0 → 26 个测试
3. **类型安全**：消除所有 `any`
4. **代码简洁**：总行数减少，可读性提升

### 最终文件结构

```
toolbox-refactored/
├── index.tsx              # 列表页 (~300 行)
├── store.ts               # Zustand 状态管理
├── constants.ts           # 常量
├── README.md              # 文档
├── types/
│   └── index.ts           # 类型定义
├── api/
│   └── toolboxApi.ts      # API 封装
├── create/
│   └── index.tsx          # 创建页 (~350 行)
└── __tests__/
    ├── types.ts           # 测试类型
    ├── types/             # 类型测试 (4 个)
    ├── api/               # API 测试 (15 个)
    └── integration/       # 集成测试 (7 个)
```
