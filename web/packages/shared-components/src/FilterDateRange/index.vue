<template>
  <el-date-picker
    v-model="model"
    type="daterange"
    :start-placeholder="startPlaceholder"
    :end-placeholder="endPlaceholder"
    :size="size"
    style="--el-date-editor-width: 280px"
    :popper-options="{ placement: 'bottom-start' }"
    :shortcuts="shortcutsComputed"
    v-bind="{ ...$attrs }"
    @change="handleChange"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getSimpleDateFormatString, getRangeStartEndDates } from '@km/shared-utils'

export type DateRangeShortcut = { text: string; value: string }

interface DateRange {
  start: string
  end: string
}

const props = withDefaults(
  defineProps<{
    modelValue?: (string | number)[]
    prop?: DateRange
    startPlaceholder?: string
    endPlaceholder?: string
    size?: 'small' | 'default' | 'large'
    valueFormat?: (date: Date) => string
    /** 快捷选项，value 为 time_type（'0'～'8'），text 由应用侧 i18n 后传入 */
    shortcuts?: DateRangeShortcut[]
  }>(),
  {
    modelValue: () => [],
    prop: () => ({ start: 'start', end: 'end' }),
    startPlaceholder: '开始时间',
    endPlaceholder: '结束时间',
    size: 'default',
    valueFormat: (date: Date) =>
      getSimpleDateFormatString({ date, format: 'YYYY-MM-DD hh:mm' }),
    shortcuts: () => [],
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', data: (string | number)[]): void
  (e: 'add'): void
  (e: 'change', data: (string | number)[]): void
}>()

const model = ref<[Date, Date] | null>(null)

function parseToDates(arr: (string | number)[] | undefined): [Date, Date] | null {
  if (!arr || arr.length < 2) return null
  const a = new Date(String(arr[0]))
  const b = new Date(String(arr[1]))
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null
  return [a, b]
}

watch(
  () => props.modelValue,
  (val) => {
    model.value = parseToDates(val)
  },
  { immediate: true, deep: true }
)

const handleChange = (e: [Date, Date] | null) => {
  let date: (string | number)[] = []
  if (e && e.length >= 2) {
    e[0].setHours(0, 0, 0, 0)
    e[1].setHours(23, 59, 59, 999)
    date = [props.valueFormat(e[0]), props.valueFormat(e[1])]
  }
  emit('update:modelValue', date)
  emit('change', date)
}

const shortcutsComputed = computed(() =>
  props.shortcuts.map((item) => ({
    text: item.text,
    value: () => {
      const range = getRangeStartEndDates(item.value)
      const start = range.start ? new Date(range.start.replace(' ', 'T')) : null
      const end = range.end ? new Date(range.end.replace(' ', 'T')) : null
      if (start && end) return [start, end] as [Date, Date]
      return [] as unknown as [Date, Date]
    },
  }))
)
</script>
