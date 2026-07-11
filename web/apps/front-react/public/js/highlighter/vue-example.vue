<template>
  <div class="highlighter-demo">
    <h1>Vue 中使用划词高亮插件</h1>

    <div ref="contentRef" class="content-area">
      <h2>示例内容</h2>
      <p>这是一个在 Vue 中使用划词高亮插件的示例。</p>
      <p>你可以将鼠标悬停在段落上，或者手动选择文本来触发高亮功能。</p>

      <div class="restricted-area" ref="restrictedRef">
        <h3>限制区域</h3>
        <p>只有在这个区域内才能进行划词高亮。</p>
      </div>

      <div v-html="markdownContent"></div>
    </div>

    <div class="controls">
      <button @click="updateMenu">更新菜单</button>
      <button @click="refresh">刷新段落识别</button>
      <button @click="destroy">销毁插件</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const contentRef = ref<HTMLElement | null>(null)
const restrictedRef = ref<HTMLElement | null>(null)
let highlighter: any = null

const markdownContent = ref(`
  <h2>Markdown 内容示例</h2>
  <p>这是一段 Markdown 渲染后的内容。</p>
  <p>插件可以自动识别这些段落元素。</p>
  <ul>
    <li>列表项 1</li>
    <li>列表项 2</li>
    <li>列表项 3</li>
  </ul>
`)

onMounted(() => {
  if (!contentRef.value) return

  // 初始化高亮插件
  highlighter = new (window as any).TextHighlighter({
    container: contentRef.value,
    restrictSelector: '.restricted-area',
    enableAutoHighlight: true,
    enableManualHighlight: true,
    menuItems: [
      {
        label: '复制',
        handler: (info: any) => {
          navigator.clipboard.writeText(info.text)
          ElMessage.success('已复制: ' + info.text)
        }
      },
      {
        label: '翻译',
        background: '#2196F3',
        color: '#fff',
        handler: (info: any) => {
          ElMessage.info('翻译: ' + info.text)
        }
      },
      {
        label: '搜索',
        background: '#4CAF50',
        color: '#fff',
        handler: (info: any) => {
          window.open('https://www.google.com/search?q=' + encodeURIComponent(info.text))
        }
      }
    ],
    onHighlight: (info: any) => {
      console.log('高亮事件:', info)
    },
    onMenuClick: (data: any) => {
      console.log('菜单点击:', data)
    }
  })
})

const updateMenu = () => {
  if (!highlighter) return
  highlighter.updateMenuItems([
    {
      label: '新菜单1',
      handler: (info: any) => alert('新菜单1: ' + info.text)
    },
    {
      label: '新菜单2',
      handler: (info: any) => alert('新菜单2: ' + info.text)
    }
  ])
}

const refresh = () => {
  if (!highlighter) return
  highlighter.refresh()
}

const destroy = () => {
  if (highlighter) {
    highlighter.destroy()
    highlighter = null
  }
}

onBeforeUnmount(() => {
  destroy()
})
</script>

<style scoped>
.highlighter-demo {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.content-area {
  border: 1px solid #ddd;
  padding: 20px;
  margin: 20px 0;
  border-radius: 4px;
  background: #fafafa;
}

.restricted-area {
  background: #fff;
  padding: 15px;
  border: 2px dashed #4CAF50;
  border-radius: 4px;
  margin: 20px 0;
}

.controls {
  margin-top: 20px;
  display: flex;
  gap: 10px;
}

.controls button {
  padding: 8px 16px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 4px;
  cursor: pointer;
}

.controls button:hover {
  background: #f5f5f5;
}
</style>

