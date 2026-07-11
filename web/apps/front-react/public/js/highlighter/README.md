# 划词高亮插件

一个纯 JavaScript 实现的划词高亮插件，支持自动段落识别和手动划词高亮，可轻松集成到 Vue 和 React 项目中。

## 功能特性

- ✅ **自动段落识别**：自动识别段落元素，鼠标悬停时自动高亮
- ✅ **手动划词高亮**：支持手动选择文本进行高亮
- ✅ **区域限制**：可限制划词区域，只在指定区域内生效
- ✅ **智能菜单定位**：根据边界情况自动选择菜单显示位置（上方或下方）
- ✅ **自定义菜单**：支持自定义菜单项，可通过初始化或方法传递
- ✅ **事件回调**：提供丰富的事件回调支持
- ✅ **框架无关**：纯 JavaScript 实现，可集成到任何框架

## 快速开始

### 1. 引入文件

```html
<!-- 引入样式 -->
<link rel="stylesheet" href="/js/highlighter.css">

<!-- 引入脚本 -->
<script src="/js/highlighter.js"></script>
```

### 2. 基本使用

```javascript
const highlighter = new TextHighlighter({
  container: '#content', // 容器选择器或 DOM 元素
  menuItems: [
    {
      label: '复制',
      handler: (info) => {
        navigator.clipboard.writeText(info.text)
        alert('已复制: ' + info.text)
      }
    },
    {
      label: '翻译',
      handler: (info) => {
        // 处理翻译逻辑
      }
    }
  ]
})
```

## 配置选项

### 基础配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `container` | `string \| HTMLElement` | `null` | **必需**。目标容器选择器或 DOM 元素 |
| `menuItems` | `Array` | `[]` | 菜单项配置数组 |
| `restrictSelector` | `string` | `null` | 限制划词区域的选择器 |

### 样式配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `highlightClass` | `string` | `'text-highlight'` | 手动高亮样式类名 |
| `autoHighlightClass` | `string` | `'text-auto-highlight'` | 自动高亮样式类名 |
| `menuClass` | `string` | `'highlight-menu'` | 菜单容器类名 |

### 功能配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableAutoHighlight` | `boolean` | `true` | 是否启用自动段落识别高亮 |
| `enableManualHighlight` | `boolean` | `true` | 是否启用手动划词高亮 |
| `forceVirtualMode` | `boolean` | `false` | 强制使用虚拟高亮模式（不修改 DOM），适用于复杂结构如 Markdown 渲染内容 |

### 位置配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `menuOffset` | `object` | `{ x: 0, y: 10 }` | 菜单位置偏移量 |

### 回调函数

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `onHighlight` | `function` | `null` | 高亮事件回调 |
| `onMenuClick` | `function` | `null` | 菜单点击事件回调 |

## 菜单项配置

每个菜单项支持以下配置：

```javascript
{
  label: '菜单文本',           // 菜单项显示文本
  text: '菜单文本',            // 同 label（兼容）
  background: '#f5f5f5',      // 背景色
  color: '#333',              // 文字颜色
  hoverBackground: '#e0e0e0', // 悬停背景色
  handler: (info) => {},      // 点击处理函数
  action: (info) => {}        // 同 handler（兼容）
}
```

### 菜单项回调参数

```javascript
{
  type: 'auto' | 'manual',    // 高亮类型
  element: HTMLElement,      // 高亮的 DOM 元素
  text: string               // 高亮的文本内容
}
```

## API 方法

### `updateMenuItems(menuItems)`

更新菜单项。

```javascript
highlighter.updateMenuItems([
  {
    label: '新菜单项',
    handler: (info) => {
      console.log(info.text)
    }
  }
])
```

### `refresh()`

刷新段落识别。当内容动态更新后，调用此方法重新识别段落。

```javascript
highlighter.refresh()
```

### `destroy()`

销毁插件实例，清理所有事件监听和 DOM 元素。

```javascript
highlighter.destroy()
```

## 在 Vue 中使用

```vue
<template>
  <div ref="contentRef" class="content">
    <!-- 你的内容 -->
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const contentRef = ref(null)
let highlighter = null

onMounted(() => {
  if (!contentRef.value) return

  highlighter = new window.TextHighlighter({
    container: contentRef.value,
    menuItems: [
      {
        label: '复制',
        handler: (info) => {
          navigator.clipboard.writeText(info.text)
        }
      }
    ]
  })
})

onBeforeUnmount(() => {
  if (highlighter) {
    highlighter.destroy()
  }
})
</script>
```

## 在 React 中使用

```jsx
import { useEffect, useRef } from 'react'

function MyComponent() {
  const contentRef = useRef(null)
  const highlighterRef = useRef(null)

  useEffect(() => {
    if (!contentRef.current || !window.TextHighlighter) return

    highlighterRef.current = new window.TextHighlighter({
      container: contentRef.current,
      menuItems: [
        {
          label: '复制',
          handler: (info) => {
            navigator.clipboard.writeText(info.text)
          }
        }
      ]
    })

    return () => {
      if (highlighterRef.current) {
        highlighterRef.current.destroy()
      }
    }
  }, [])

  return <div ref={contentRef}>你的内容</div>
}
```

## 限制划词区域

使用 `restrictSelector` 选项限制划词区域：

```javascript
const highlighter = new TextHighlighter({
  container: '#content',
  restrictSelector: '.allowed-area', // 只有在这个区域内才能划词
  menuItems: [...]
})
```

## 事件回调

### onHighlight

高亮事件回调，在文本被高亮时触发。

```javascript
const highlighter = new TextHighlighter({
  container: '#content',
  onHighlight: (info) => {
    console.log('高亮类型:', info.type)      // 'auto' 或 'manual'
    console.log('高亮元素:', info.element)
    console.log('高亮文本:', info.text)
  }
})
```

### onMenuClick

菜单点击事件回调。

```javascript
const highlighter = new TextHighlighter({
  container: '#content',
  onMenuClick: (data) => {
    console.log('菜单项:', data.item)
    console.log('菜单索引:', data.index)
    console.log('高亮信息:', data.highlight)
  }
})
```

## 样式定制

你可以通过 CSS 自定义高亮和菜单样式：

```css
/* 自定义自动高亮样式 */
.text-auto-highlight {
  background-color: rgba(100, 200, 255, 0.3) !important;
}

/* 自定义手动高亮样式 */
.text-highlight {
  background-color: rgba(255, 100, 100, 0.4) !important;
}

/* 自定义菜单样式 */
.highlight-menu {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
```

## 浏览器兼容性

- Chrome/Edge (最新版本)
- Firefox (最新版本)
- Safari (最新版本)
- 移动端浏览器

## 注意事项

1. 确保在 DOM 加载完成后再初始化插件
2. 在组件销毁时调用 `destroy()` 方法清理资源
3. 动态更新内容后，调用 `refresh()` 方法重新识别段落
4. 菜单会自动根据边界位置选择显示在上方或下方

## 许可证

MIT License

