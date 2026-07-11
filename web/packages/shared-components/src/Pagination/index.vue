<script setup lang="ts">
import { ref, watch } from 'vue'
import { debounce } from '@km/shared-utils'

const props = withDefaults(
  defineProps<{
    total?: number | string
    pageSize?: number
    page?: number
    layout?: string
    pageSizes?: number[]
  }>(),
  {
    page: 1,
    total: 0,
    pageSize: 20,
    layout: 'prev, pager, next, jumper',
    pageSizes: () => [10, 20, 30, 40, 50, 100],
  },
)

const current_page = ref<number>(props.page)
const page_size = ref<number>(props.pageSize)

const emits = defineEmits<{
  (e: 'currentChange', page: number): void
  (e: 'update:page', page: number): void
  (e: 'sizeChange', size: number): void
  (e: 'update:pageSize', size: number): void
}>()

const handleCurrentChange = debounce(
  (page: number) => {
    current_page.value = page
    emits('currentChange', page)
    emits('update:page', page)
  },
  200,
  true,
)
const handleSizeChange = debounce(
  (size: number) => {
    page_size.value = size
    emits('sizeChange', size)
    emits('update:pageSize', size)
  },
  800,
  true,
)

watch(
  () => props.page,
  (page) => {
    current_page.value = page
  },
  { immediate: true },
)
watch(
  () => props.pageSize,
  (size) => {
    page_size.value = size
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex justify-between items-center py-4 overflow-x-auto">
    <div
      class="flex-shrink-0 text-sm text-[#666]"
      v-html="$t('shared_components.table_footer_text', { total: `<span class='text-[#2563eb]'>${total}</span>` })"
    />
    <el-pagination
      :current-page="current_page"
      :page-size="page_size"
      :page-sizes="pageSizes"
      :layout="layout"
      :total="total"
      @current-change="handleCurrentChange"
      @size-change="handleSizeChange"
    />
  </div>
</template>
