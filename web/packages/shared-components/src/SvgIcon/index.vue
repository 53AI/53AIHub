<script setup lang="ts" name="SvgIcon">
import { computed, ref, onMounted, watch } from 'vue'

interface SvgProps {
  name: string // 图标的名称 ==> 必传
  prefix?: string // 图标的前缀 ==> 非必传（默认为 "icon"）
  size?: number | string
  width?: string
  height?: string
  color?: string
}

const props = withDefaults(defineProps<SvgProps>(), {
  prefix: 'icon',
  size: undefined,
  width: '16px',
  height: '16px',
  color: '',
})

const symbolId = computed(() => `#${props.prefix}-${props.name}`)

// 尺寸：优先 size，否则 width/height
const sizeStyle = computed(() => {
  if (props.size !== undefined && props.size !== '') {
    const s = typeof props.size === 'number' ? `${props.size}px` : String(props.size)
    return { width: s, height: s }
  }
  return { width: props.width, height: props.height }
})

// 仅检测 sprite 是否已存在（由 front/console 的 main.ts 在空闲时加载），不在此处触发加载
const iconsLoaded = ref(false)
const loadAttempted = ref(false)

const checkIconsLoaded = () => {
  if (loadAttempted.value) return
  loadAttempted.value = true

  const check = () => {
    if (document.getElementById('__svg__icons__dom__')) {
      iconsLoaded.value = true
      return true
    }
    return false
  }

  if (check()) return
  const deadline = Date.now() + 5000
  const timer = setInterval(() => {
    if (check() || Date.now() > deadline) clearInterval(timer)
  }, 150)
}

watch(
  () => props.name,
  () => {
    if (props.name && !iconsLoaded.value) {
      checkIconsLoaded()
    }
  },
  { immediate: true }
)

onMounted(() => {
  if (props.name) {
    checkIconsLoaded()
  }
})
</script>

<template>
  <svg
    v-if="iconsLoaded || loadAttempted"
    :style="{ ...sizeStyle, color }"
    :class="{ 'custom-color': color }"
    aria-hidden="true"
  >
    <use :xlink:href="symbolId" />
  </svg>
  <span
    v-else
    :style="{
      ...sizeStyle,
      display: 'inline-block',
    }"
    aria-hidden="true"
  />
</template>

<style scoped>
svg {
  width: 1em;
  height: 1em;
  overflow: hidden;
  vertical-align: -0.15em;
  fill: currentColor;
}

.custom-color {
  fill: v-bind(color);
  stroke: v-bind(color);
}
</style>
