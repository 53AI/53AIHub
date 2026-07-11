# @km/shared-business

共享业务逻辑包，提供 Agent 创建等核心功能的抽象实现。

## 安装

```bash
pnpm add @km/shared-business
```

## 依赖

此包使用 peerDependencies，需要宿主应用提供以下依赖：

- `react` >= 18.0.0
- `antd` >= 6.0.0
- `zustand` >= 4.0.0
- `i18next` >= 22.0.0
- `react-i18next` >= 12.0.0

## 模块

### agent-create

Agent 创建模块提供统一的创建/编辑功能，通过适配器模式支持不同应用场景。

#### 使用方式

```tsx
import { 
  AdapterProvider, 
  useAgentFormStore, 
  useAgentForm 
} from '@km/shared-business/agent-create'

// 1. 实现适配器
const myAdapter: IAgentCreateAdapter = {
  supportedPlatforms: ['prompt'],
  defaultPlatform: 'prompt',
  visibleConfigKeys: ['model', 'prompt'],
  
  async getDetail(agentId) {
    return await myApi.getAgent(agentId)
  },
  
  async save(formData) {
    return await myApi.saveAgent(formData)
  },
}

// 2. 在页面组件中使用
function AgentCreatePage() {
  return (
    <AdapterProvider adapter={myAdapter}>
      <AgentCreateContent />
    </AdapterProvider>
  )
}

function AgentCreateContent() {
  const form = useAgentForm()
  const store = useAgentFormStore()
  
  // 使用共享的状态和方法
  console.log(form.formData.name)
  
  return <div>...</div>
}
```

#### 适配器接口

```typescript
interface IAgentCreateAdapter {
  // 能力声明
  supportedPlatforms: AgentType[]
  defaultPlatform: AgentType
  visibleConfigKeys?: ConfigKey[]
  
  // API 操作
  getDetail: (agentId: number) => Promise<AgentFormData>
  save: (data: AgentFormData) => Promise<AgentFormData>
  getGroupOptions?: () => Promise<GroupOption[]>
  delete?: (agentId: number) => Promise<void>
  
  // 数据转换
  filterFormData?: (data: AgentFormData) => AgentFormData
  filterResponseData?: (data: AgentFormData) => AgentFormData
  
  // 平台配置
  getPlatformConfig?: (platform: AgentType) => Promise<any>
  
  // UI 组件注入
  PageLayout?: ComponentType<PageLayoutProps>
  ModelSelect?: ComponentType<ModelSelectProps>
  GroupSelect?: ComponentType<GroupSelectProps>
}
```

#### 现有实现

- `consoleAgentAdapter` - 后台管理端适配器，支持全量平台和配置
- `frontAgentAdapter` - 用户端适配器，仅支持 Prompt 平台

## 开发

```bash
# 构建
pnpm run build

# 类型检查
pnpm run typecheck
```

## 架构

```
packages/shared-business/
├── src/
│   ├── index.ts                    # 主入口
│   └── agent-create/               # Agent 创建模块
│       ├── index.ts                # 模块导出
│       ├── adapters/
│       │   ├── types.ts            # 适配器类型定义
│       │   ├── context.tsx         # AdapterProvider
│       │   └── index.ts            # 适配器导出
│       ├── types.ts                # 表单类型和默认值
│       ├── store.ts                # Zustand 状态管理
│       └── hooks/
│           └── index.ts            # useAgentForm hook
└── package.json
```

## 设计原则

1. **共享逻辑，独立UI**: 业务逻辑在共享包中实现，UI 组件由各应用自行实现
2. **适配器模式**: 通过适配器抽象不同应用之间的差异（API、平台支持、配置项）
3. **按需使用**: 各应用可以选择性导入需要的模块
