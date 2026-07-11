# Data Pipeline Module

数据流水线配置组件，用于配置文档处理流水线的各个步骤。

## 安装

```bash
pnpm add @km/shared-business
```

## 使用

### 基础用法

```tsx
import {
  PipelineBasicDialog,
  PipelineDetail,
  usePipelineConfig,
} from '@km/shared-business/knowledge-pipeline'

function MyComponent() {
  const { pipeline, updateStepConfig, updateStepRunMode } = usePipelineConfig()

  return (
    <>
      <PipelineBasicDialog
        open={showDialog}
        pipeline={pipeline}
        onConfirm={(data) => {
          // Handle confirm
        }}
        onCancel={() => setShowDialog(false)}
        iconPicker={({ value, onChange, children }) => (
          <CustomIconPicker value={value} onChange={onChange}>
            {children}
          </CustomIconPicker>
        )}
      />

      <PipelineDetail
        open={showDetail}
        pipeline={pipeline}
        onChange={setPipeline}
        onClose={() => setShowDetail(false)}
        onSave={(p) => {
          // Handle save
        }}
      />
    </>
  )
}
```

## 组件

### PipelineBasicDialog

创建/编辑流水线基本信息对话框。

**Props:**

| 属性 | 类型 | 描述 |
|------|------|------|
| `open` | `boolean` | 是否显示对话框 |
| `pipeline` | `Pipeline \| null` | 当前流水线（编辑模式） |
| `pipelines` | `Pipeline[]` | 所有流水线列表（用于名称去重） |
| `onConfirm` | `(data: { name: string; icon: string }) => void` | 确认回调 |
| `onCancel` | `() => void` | 取消回调 |
| `iconPicker` | `Component` | 自定义图标选择器组件 |
| `i18nPrefix` | `string` | 国际化前缀，默认 `'shared.data_pipeline'` |

### PipelineDetail

流水线详细配置抽屉。

**Props:**

| 属性 | 类型 | 描述 |
|------|------|------|
| `open` | `boolean` | 是否显示 |
| `pipeline` | `Pipeline` | 当前流水线 |
| `onChange` | `(pipeline: Pipeline) => void` | 配置变更回调 |
| `onClose` | `() => void` | 关闭回调 |
| `onSave` | `(pipeline: Pipeline) => void` | 保存回调 |
| `onEditBasic` | `(pipeline: Pipeline) => void` | 编辑基本信息回调 |
| `width` | `number` | 抽屉宽度，默认 1200 |
| `i18nPrefix` | `string` | 国际化前缀 |

### 配置组件

所有配置组件遵循统一的 API：

```tsx
interface ConfigProps {
  config: Record<string, any>
  onChange: (config: Record<string, any>) => void
  i18nPrefix?: string
}
```

- **ParseConfig**: 解析配置（依赖注入 `parseMethods` 或 `onLoadParserSettings`）
- **ChunkConfig**: 分块配置（可选 `chunkTypes`, `getPublicPath`）
- **VectorConfig**: 向量化配置（依赖注入 `onRefresh`, `onTest`, `onGoToModelManagement`）
- **GraphConfig**: 图谱配置（依赖注入 `onLoadTemplates`）
- **CleanConfig**: 清洗配置（可选 `cleanRules`）
- **SummaryConfig**: 摘要配置

## Hooks

### usePipelineConfig

管理流水线配置状态的 Hook。

```tsx
const {
  pipeline,           // 当前流水线
  setPipeline,        // 设置流水线
  updateStepConfig,   // 更新步骤配置
  updateStepRunMode,  // 更新步骤运行模式
  updateBasicInfo,    // 更新基本信息
  resetPipeline,      // 重置流水线
  createNew,          // 创建新流水线
  getStep,            // 获取指定步骤
  getVisibleSteps,    // 获取可见步骤列表
} = usePipelineConfig({
  initialPipeline,
  onChange: (pipeline) => {
    // Handle change
  },
})
```

## 国际化

组件使用 `shared.data_pipeline.*` 作为国际化 key 前缀。

导入语言包：

```tsx
import { dataPipelineLocales } from '@km/shared-business'

// 在 i18n 配置中使用
i18n.addResourceBundle('zh-CN', 'shared', dataPipelineLocales['zh-CN'])
i18n.addResourceBundle('en-US', 'shared', dataPipelineLocales['en-US'])
```

## 类型

```tsx
import type {
  Pipeline,
  PipelineNode,
  PipelineStep,
  PipelineProfileJson,
  PipelineNodeRunMode,
  PipelineNodeStepKey,
  PipelineBasicDialogProps,
  PipelineDetailProps,
  ConfigComponentProps,
} from '@km/shared-business/knowledge-pipeline'
```

## 常量

```tsx
import {
  NODE_ICONS_MAP,
  STEP_KEY_TO_NAME_I18N_KEY,
  STEP_KEY_TO_DESCRIPTION_I18N_KEY,
  LIST_DISPLAY_NODE_TYPES,
  DEFAULT_PIPELINE_STEP,
  createNewPipeline,
  CHUNK_TYPE,
  SPLIT_TYPE,
  CHUNK_MODE,
} from '@km/shared-business/knowledge-pipeline'
```

## 依赖注入模式

配置组件采用依赖注入模式，允许应用提供特定的数据获取逻辑：

```tsx
// ParseConfig - 提供解析方法
<ParseConfig
  config={config}
  onChange={handleChange}
  onLoadParserSettings={async () => {
    const res = await platformSettingsApi.find()
    return transformToParseMethods(res)
  }}
/>

// GraphConfig - 提供图谱模板
<GraphConfig
  config={config}
  onChange={handleChange}
  onLoadTemplates={async () => {
    const res = await graphTemplatesApi.list()
    return res.items
  }}
/>

// VectorConfig - 提供向量模型配置
<VectorConfig
  onRefresh={async () => {
    const data = await chunkSettingApi.modelConfig.get()
    return data.model_config.vector_embedding
  }}
  onTest={async (channelId, modelName) => {
    return await channelApi.test(channelId, { model: modelName })
  }}
/>
```
