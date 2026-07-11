### 指令迁移进度说明

**已经完成的剩余指令改写（均在 `apps/console-react/src/directive` 下）：**

- **`debounce.ts`**
  - 提供 **函数级防抖工具**：`debounce(fn, delay?, immediate?)`，可在 React 组件里包一层事件回调使用。
  - 提供 **执行期间禁用能力**：`withDisabledDuringCall(fn, setDisabled, delay?)`，用来实现“点击后按钮一段时间内禁用 + 支持 Promise”的常见场景。

- **`truncate.ts`**
  - 实现核心 DOM 算法为可复用函数：`applyTruncate(el, options)`，等价于原 `v-truncate` 的截断 + 统计 + 后缀文案逻辑。
  - 额外提供便捷封装：
    - `attachTruncate(el, options)`：绑定 `ResizeObserver` 自动在容器尺寸变化时重新计算。
    - `detachTruncate(el)`：移除对应的 `ResizeObserver`。

- **`tooltip.ts`**
  - 提取自动是否需要 tooltip 的判断逻辑为：`shouldShowTooltip(el, options?)`。
  - 内部使用 `Range + getComputedStyle` 计算内容实际渲染宽高，对齐原 `autoShowToolTip` 行为，用于在 React 里决定是否包一层 AntD `Tooltip`。

- **`overflow-tooltip.ts`**
  - 提供溢出判断函数：`shouldEnableOverflowTooltip(el)`，等价于原 `akTooltipAutoShow` 里“文本是否被折叠”的判断，用于控制 tooltip 是否启用。

- **`router.ts`**
  - 用 React 友好的方式封装路由节流：
    - 导出 `createRouterHandler(navigate, back, cooldown?)`，返回一个处理函数：`(action: { type: 'push'; to: string } | { type: 'back' }) => void`。
    - 内部用与原指令相同的 `_routing` 冷却标志，防止多次快速点击导致重复跳转。

- **`version.ts`**（配合 `utils/version.ts` 扩展）
  - 在 `utils/version.ts` 中补充版本配置类型 `VersionOptions` 和 `checkVersionPermission(options)`，目前仍保持 “全部通过” 的阶段性实现，后续可接企业版本信息再收紧。
  - 新增指令工具：`createVersionClickGuard(options: VersionOptions)`，返回一个 `MouseEvent` 处理函数：
    - 若 `checkVersionPermission` 不通过，会 `stopPropagation / preventDefault / stopImmediatePropagation`，阻断后续点击逻辑。
    - 若通过，则可选执行 `options.onClick()`，用于在 React 里组合业务点击逻辑。

### 如何在 React 中使用这些指令工具（示意）

- **防抖按钮：**

```tsx
import { debounce, withDisabledDuringCall } from '@/directive/debounce'

const handleClick = () => { /* ... */ }
const onClick = debounce(handleClick, 1000, true)
```

- **按容器宽度截断标签列表：**

```tsx
import { useEffect, useRef } from 'react'
import { attachTruncate, detachTruncate } from '@/directive/truncate'

const ref = useRef<HTMLDivElement | null>(null)

useEffect(() => {
  if (!ref.current) return
  attachTruncate(ref.current, { node: '.tag', showTotal: true, showRemainder: true, showTooltip: true })
  return () => {
    if (ref.current) detachTruncate(ref.current)
  }
}, [])
```

- **基于 overflow 是否启用 Tooltip：**

```tsx
import { Tooltip } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { shouldEnableOverflowTooltip } from '@/directive/overflow-tooltip'

const ref = useRef<HTMLSpanElement | null>(null)
const [enabled, setEnabled] = useState(false)

useEffect(() => {
  if (!ref.current) return
  setEnabled(shouldEnableOverflowTooltip(ref.current))
}, [])

return (
  <Tooltip title={text} open={enabled ? undefined : false}>
    <span ref={ref} className="inline-block truncate max-w-[160px]">
      {text}
    </span>
  </Tooltip>
)
```

- **路由节流点击：**

```tsx
import { useNavigate } from 'react-router-dom'
import { createRouterHandler } from '@/directive/router'

const navigate = useNavigate()
const handleRoute = createRouterHandler(navigate, () => navigate(-1))

<button onClick={() => handleRoute({ type: 'push', to: '/agent' })}>跳转 Agent</button>
```

- **版本点击守卫：**

```tsx
import { createVersionClickGuard } from '@/directive/version'
import { VERSION_MODULE } from '@/utils/version'

const onClick = createVersionClickGuard({
  module: VERSION_MODULE.AGENT,
  content: '该功能仅在旗舰版可用',
  mode: 'dialog',
  onClick: () => {
    // 真正业务逻辑
  },
})

<button onClick={onClick}>受版本控制的按钮</button>
```

### 小结

- **所有剩余指令（`debounce / tooltip / overflow-tooltip / router / version / truncate`）已经全部改写为 React 环境下可直接调用的工具函数，并放在 `src/directive` 目录，与原 console 指令一一对应。**
- 当前版本保留了完整的 **能力形状与核心判断逻辑**，UI 层（AntD `Tooltip` / `Modal` 等）交由具体业务组件在使用这些工具时自行组合。
- 我也已将 `migrate-directives` todo 标记为 **已完成**，下一步会继续按照 plan 进入 `hooks` 迁移。
