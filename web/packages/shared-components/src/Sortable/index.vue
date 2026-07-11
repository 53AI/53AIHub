<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import Sortable from 'sortablejs'

const props = withDefaults(defineProps<{
  modelValue: any[]
  props?: any
  dragBg?: string
  identity?: string
  customSortableId?: string
  forceRender?: boolean
  infiniteScrollImmediate?: boolean
  infiniteScrollDistance?: number
  disabled?: boolean
  group?: string | {
    name: string
    pull?: boolean | string | ((to: any, from: any, dragEl: HTMLElement, evt: Event) => boolean)
    put?: boolean | string[] | ((to: any, from: any, dragEl: HTMLElement, evt: Event) => boolean)
    revertClone?: boolean
  }
  sort?: boolean
  allowCrossInstanceDrag?: boolean
}>(), {
  dragBg: '#ECF5FF',
  modelValue: () => [],
  identity: 'id',
  props: () => ({
    handle: '.sort-icon',
    animation: 150,
  }),
  customSortableId: '',
  forceRender: false,
  infiniteScrollImmediate: false,
  infiniteScrollDistance: 20,
  disabled: false,
  group: undefined,
  sort: true,
  allowCrossInstanceDrag: false,
})

const emits = defineEmits<{
  (event: 'update:modelValue', data: any): any
  (event: 'change', args: {
    action: 'sort' | 'remove' | 'add'
    value: any
    prevValue?: any
    originSortableId: string
    targetSortableId: string
    originData?: any
    targetData?: any
    originIndex?: number | string
    targetIndex?: number | string
  }): any
  (event: 'start', data: any): any
  (event: 'end', data: any): any
  (event: 'scroll', args: {
    scrollTop: number
  }): any
}>()
const id = `sort_${Math.random().toString(36).substr(2, 9)}`

const list = ref<any[]>([])
const renderFlag = ref(false)
const sortableId = computed(() => props.customSortableId || id)

onMounted(() => {
  initSortable()
})
onUnmounted(() => {
  destroySortable()
})

let _sortableInstance: any = null
let _removing = false
const initSortable = () => {
  if (props.disabled) return
  const sortableEl = document.querySelector(`#${sortableId.value}`)
  if (!sortableEl) return

  const sortableConfig: any = {
    group: props.group || (props.allowCrossInstanceDrag ? 'shared' : undefined),
    sort: props.sort,
    onStart: (event: any = {}) => {
      const { target, oldIndex } = event
      emits('start', event)
      if (target?.children?.[oldIndex]) {
        (target.children[oldIndex] as HTMLElement).style.background = props.dragBg
      }
    },
    onEnd: (event: any = {}) => {
      const { from = {}, to = {}, target, newIndex: targetIndex, oldIndex: originIndex } = event
      emits('end', event)
      if (target?.children?.[targetIndex]) {
        (target.children[targetIndex] as HTMLElement).style.background = 'transparent'
      }

      if (from === to && targetIndex !== originIndex) {
        if (_removing) return (_removing = false)
        const value = [...list.value]
        const prevValue = JSON.parse(JSON.stringify(value))
        const originData = value.splice(originIndex, 1)[0]
        const targetData = value[targetIndex]
        value.splice(targetIndex, 0, originData)
        list.value = value
        emits('update:modelValue', value)
        emits('change', {
          action: 'sort',
          prevValue,
          value,
          originSortableId: from.id,
          targetSortableId: to.id,
          originData,
          targetData,
          originIndex,
          targetIndex,
        })
      }
    },
    onAdd: (event: any = {}) => {
      const { from = {}, to = {}, target, newIndex: targetIndex, oldIndex: originIndex, item } = event
      if (target?.children?.[targetIndex]) {
        (target.children[targetIndex] as HTMLElement).style.background = 'transparent'
      }

      const value = [...list.value]
      const newItem = JSON.parse((item as HTMLElement).dataset.sortableData || '{}')
      value.splice(targetIndex, 0, newItem)
      list.value = value
      emits('update:modelValue', value)
      emits('change', {
        action: 'add',
        value,
        originSortableId: from.id,
        targetSortableId: to.id,
        originIndex,
        targetIndex,
        newItem,
      })
    },
    onRemove: (event: any = {}) => {
      const { from = {}, to = {}, target, newIndex: targetIndex, oldIndex: originIndex } = event
      if (target?.children?.[targetIndex]) {
        (target.children[targetIndex] as HTMLElement).style.background = 'transparent'
      }

      const value = [...list.value]
      const removedItem = value.splice(originIndex, 1)[0]
      list.value = value
      _removing = true
      emits('update:modelValue', value)
      emits('change', {
        action: 'remove',
        value,
        originSortableId: from.id,
        targetSortableId: to.id,
        originIndex,
        targetIndex,
        removedItem,
      })
    },
    ...props.props,
  }

  _sortableInstance = Sortable.create(sortableEl, sortableConfig)
}
const destroySortable = () => {
  if (_sortableInstance) {
    _sortableInstance.destroy()
    _sortableInstance = null
  }
}
let _scrollTop = 0
const handleScroll = () => {
  const sortableEl = document.querySelector(`#${sortableId.value}`)
  if (sortableEl) {
    _scrollTop = (sortableEl as HTMLElement).scrollTop || 0
  }
  emits('scroll', { scrollTop: _scrollTop })
}

const scrollToBottom = async () => {
  await nextTick()
  const sortableEl = document.querySelector(`#${sortableId.value}`)
  if (!sortableEl) return
  ;(sortableEl as HTMLElement).scrollTop = (sortableEl as HTMLElement).scrollHeight
}

const rerender = async () => {
  destroySortable()
  list.value = []
  renderFlag.value = true
  await nextTick()
  renderFlag.value = false
  await nextTick()
  list.value = [...props.modelValue]
  await nextTick()
  initSortable()
}
watch(
  () => props.modelValue,
  async () => {
    const { forceRender = false } = props
    if (forceRender) {
      await rerender()
    }
    list.value = [...props.modelValue]
    if (forceRender) {
      await nextTick()
      const sortableEl = document.querySelector(`#${sortableId.value}`)
      if (sortableEl) {
        (sortableEl as HTMLElement).scrollTop = _scrollTop
      }
    }
  },
  { immediate: true, deep: true }
)
watch(
  () => props.disabled,
  async () => {
    rerender()
  }
)

defineExpose({
  rerender,
  scrollToBottom,
})
</script>

<template>
  <div
    v-if="!renderFlag"
    :id="sortableId"
    v-infinite-scroll="handleScroll"
    :infinite-scroll-immediate="infiniteScrollImmediate"
    :infinite-scroll-distance="infiniteScrollDistance"
  >
    <slot name="header" />
    <template v-for="(item, index) in list" :key="(item && item[identity]) || index">
      <div :data-sortable-data="JSON.stringify(item)">
        <slot name="item" :item="item" :index="index" />
      </div>
    </template>
    <slot name="footer" />
  </div>
</template>
