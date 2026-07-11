<template>
  <Teleport :to="target" :disabled="!isFullscreen">
    <div
      ref="contentRef"
      :class="[containerClasses, $attrs.class]"
      :style="containerStyle"
      @keydown.esc="handleEscapeKey"
    >
      <slot :is-fullscreen="isFullscreen" :toggle-fullscreen="toggleFullscreen" />
    </div>
  </Teleport>
  <div v-if="isFullscreen" :style="placeholderStyle" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, readonly } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useZIndex } from 'element-plus'

type FullscreenProps = {
  /** 传送目标元素选择器 */
  target?: string
  /** 是否使用 flex 布局 */
  flex?: boolean
  /** 自定义 z-index 值 */
  zIndex?: number
  /** 是否启用 ESC 键退出全屏 */
  escapeToExit?: boolean
  /** 全屏状态 */
  modelValue?: boolean
  /** 是否启用过渡动画 */
  transition?: boolean
}

type FullscreenEmits = {
  (e: 'update:modelValue', value: boolean): void
  (e: 'toggle', value: boolean): void
}

const props = withDefaults(defineProps<FullscreenProps>(), {
  target: 'body',
  flex: false,
  zIndex: 0,
  escapeToExit: true,
  modelValue: false,
  transition: true,
})

const emit = defineEmits<FullscreenEmits>()

const { nextZIndex } = useZIndex()

const contentRef = ref<HTMLElement>()
const isFullscreen = ref(props.modelValue)
const nodeHeight = ref(0)

const containerClasses = computed(() => ({
  'fullscreen-container': isFullscreen.value,
  'fullscreen-flex': props.flex && isFullscreen.value,
  'fullscreen-animate': props.transition && isFullscreen.value,
}))

const containerStyle = computed(() => ({
  zIndex: props.zIndex || nextZIndex(),
}))

const placeholderStyle = computed(() => ({
  height: `${nodeHeight.value}px`,
}))

const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value
  emit('update:modelValue', isFullscreen.value)
  emit('toggle', isFullscreen.value)
}

const handleEscapeKey = (event: KeyboardEvent) => {
  if (props.escapeToExit && event.key === 'Escape' && isFullscreen.value) {
    toggleFullscreen()
  }
}

watch(
  () => props.modelValue,
  (newValue) => {
    isFullscreen.value = newValue
  }
)

let stopResizeObserver: { stop: () => void } | undefined

onMounted(async () => {
  await nextTick()
  if (contentRef.value) {
    stopResizeObserver = useResizeObserver(contentRef, ([entry]) => {
      nodeHeight.value = entry.target.scrollHeight
    })
  }
})

onUnmounted(() => {
  if (stopResizeObserver?.stop) {
    stopResizeObserver.stop()
  }
})

defineExpose({
  toggleFullscreen,
  isFullscreen: readonly(isFullscreen),
})
</script>

<style scoped>
.fullscreen-container {
  @apply fixed inset-0 p-4 bg-black/25 overflow-y-auto;
  backdrop-filter: blur(2px);
}

.fullscreen-container:deep(> *) {
  @apply w-full h-full bg-white rounded-lg shadow-2xl;
  margin-top: 0 !important;
}

.fullscreen-animate:deep(> *) {
  animation: fullscreen-enter 0.2s ease-out;
}

.fullscreen-flex {
  @apply flex overflow-hidden;
}

.fullscreen-flex:deep(> *) {
  @apply flex-1;
}

@keyframes fullscreen-enter {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 768px) {
  .fullscreen-container {
    @apply p-2;
  }

  .fullscreen-container:deep(> *) {
    @apply rounded-none;
  }
}
</style>
