<script setup lang="ts">
import { h, nextTick, onMounted, ref, useSlots, onUnmounted, watch, getCurrentInstance, computed } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { ElTableColumn } from 'element-plus'
import Pagination from '../Pagination/index.vue'

import Sortable from 'sortablejs'
import createSlots from './create-slots'

const { proxy } = getCurrentInstance()!
const tableData = computed(() => (proxy!.$attrs as any).data || [])
const props = withDefaults(
  defineProps<{
    type?: string
    page?: number
    limit?: number
    total?: number
    prefix?: string
    pagination?: boolean
    fixedFields?: any[]
    hiddenProps?: any[]
    insertIndex?: number
    loading?: boolean
    sortable?: boolean
  }>(),
  {
    type: '',
    page: 1,
    limit: 10,
    total: 0,
    prefix: '',
    fixedFields: () => [],
    hiddenProps: () => [],
    pagination: true,
    loading: false,
    sortable: false,
  },
)

const emits = defineEmits<{
  (event: 'pageSizeChange', data: any): any
  (event: 'pageCurrentChange', data: any): any
  (event: 'sortableChange', data: any): any
  (event: 'update:data', data: any): any
  (event: 'selectionChange', data: any): any
}>()

const MAX_SHOW_NUM = 30

const tableRef = ref()

const slots = useSlots()

const showSlots = ref<any[]>([])
const visibleSlots = createSlots({
  mountedCallFun() {},
  updatedCallFun() {},
  unmountedCallFun() {},
})

const showFieldVisible = ref(false)
const allFieldList = ref<any[]>([])
const showFieldList = ref<any[]>([])

const onSelectionChange = (selection: any) => {
  emits('selectionChange', selection)
}

const onSizeChange = (...args: any[]) => {
  emits('pageSizeChange', ...args)
}
const onCurrentChange = (...args: any[]) => {
  emits('pageCurrentChange', ...args)
}

const createColumnVNode = (column: { prop: string; label: string }) => {
  return h(ElTableColumn, {
    prop: column.prop,
    label: column.label,
    showOverflowTooltip: true,
    formatter: (row: any, column: any, cellValue: any) => {
      return cellValue || '--'
    },
  })
}

const handleSetting = () => {
  showFieldVisible.value = true
}

const handleFieldChange = (check: boolean, item: any) => {
  if (check) showFieldList.value.push({ ...item })
  else showFieldList.value = showFieldList.value.filter((i) => i.id !== item.id)
}

const loadUserMemoryFieldList = async () => {
  let data: any[] = []
  let use_key_list: string[] = []
  data = []
  use_key_list = []
  const defaultSlotList = slots.default!()
  allFieldList.value = data
  if (props.fixedFields && props.fixedFields.length) {
    props.fixedFields.forEach((key = '') => {
      if (!use_key_list.includes(key)) use_key_list.unshift(key)
    })
  }
  if (use_key_list && use_key_list.length)
    showFieldList.value = use_key_list
      .map((key) => data.find((item) => item.field_key === key))
      .filter((item) => item)
      .map((item) => ({ ...item }))
  else showFieldList.value = data.map((item) => ({ ...item }))

  const list = showFieldList.value.map((item) => {
    return createColumnVNode({ prop: props.prefix + item.field_key, label: item.field_name })
  })

  let newSlotList: any[] = []
  if (Number(props.insertIndex) > -1) {
    const prevSlotList = defaultSlotList.slice(0, props.insertIndex)
    const nextSlotList = defaultSlotList.slice(props.insertIndex)
    newSlotList = [...prevSlotList, ...list, ...nextSlotList]
  } else {
    newSlotList = [...list, ...defaultSlotList]
  }
  if (props.hiddenProps && props.hiddenProps.length)
    newSlotList = newSlotList.filter(
      ({ props: { prop: _prop = '' } = {} }: any = {}) => !props.hiddenProps.includes(_prop),
    )
  showSlots.value = newSlotList
}
const handleCancel = () => {
  showFieldVisible.value = false
}
const handleConfirm = async () => {
  showFieldVisible.value = false
}

let sortableInstance: any = null
const initSortable = () => {
  if (!props.sortable || !tableData.value.length) return
  const sortable_el = tableRef.value.$el.querySelector('.el-table__body tbody')
  sortableInstance = Sortable.create(sortable_el, {
    onStart: (event: any = {}) => {
      const { target, oldIndex } = event
      target.children[oldIndex].style.background = '#ECF5FF'
    },
    onEnd: async (event: any = {}) => {
      const { target, newIndex: targetIndex, oldIndex: originIndex } = event
      if (target.children && target.children[targetIndex])
        target.children[targetIndex].style.background = 'transparent'
      if (targetIndex === originIndex) return
      const list = JSON.parse(JSON.stringify(tableData.value))
      const originData = list.splice(originIndex, 1)[0]
      list.splice(targetIndex, 0, originData)
      emits('update:data', [])
      await nextTick()
      emits('update:data', list)
      emits('sortableChange', { data: list, targetIndex, originIndex })
    },
  })
}
const destroySortable = () => {
  if (sortableInstance) {
    sortableInstance.destroy()
    sortableInstance = null
  }
}

onMounted(() => {
  nextTick(() => {
    if (/^user_memory_list/im.test(props.type)) {
      loadUserMemoryFieldList()
    } else {
      const slotList = slots.default!()
      showSlots.value = slotList
    }
  })
})
onUnmounted(() => {
  destroySortable()
})

watch(
  () => tableData.value,
  async () => {
    destroySortable()
    await nextTick()
    initSortable()
  },
  { deep: true, immediate: true },
)
defineExpose({
  toggleRowSelection(...args: any[]) {
    tableRef.value.toggleRowSelection(...args)
  },
  refresh: () => {
    loadUserMemoryFieldList()
  },
  clearSelection: () => {
    tableRef.value.clearSelection()
  },
})
</script>

<template>
  <ElTable
    ref="tableRef"
    v-loading="loading"
    v-bind="{ ...$attrs }"
    @selection-change="onSelectionChange"
    :row-key="($attrs as any)['row-key']"
  >
    <ElTableColumn
      v-if="($attrs as any).selection"
      type="selection"
      width="55"
      :reserve-selection="($attrs as any)['reserve-selection']"
    />
    <ElTableColumn v-if="sortable" width="40">
      <div class="pr-3 sort-icon cursor-move">
        <SvgIcon name="drag" width="20px" height="28px" color="#C7C7C7" />
      </div>
    </ElTableColumn>
    <visibleSlots :vnode="showSlots" />
    <ElTableColumn
      v-if="allFieldList.length"
      class-name="table-setting"
      prop="system_setting"
      label=""
      width="20"
      align="center"
      fixed="right"
    >
      <template #header>
        <div class="cursor-pointer" @click="handleSetting">
          <el-icon>
            <Setting />
          </el-icon>
        </div>
      </template>
    </ElTableColumn>
    <template v-if="$slots.empty" #empty>
      <slot name="empty" />
    </template>
  </ElTable>

  <Pagination
    v-if="pagination"
    layout="sizes, prev, pager, next, jumper"
    :page="page"
    :page-size="limit"
    :total="total"
    @size-change="onSizeChange"
    @current-change="onCurrentChange"
  />

  <el-dialog v-model="showFieldVisible" title="列表显示设置" width="660px">
    <div class="flex border-b pb-4" style="height: 350px">
      <div class="flex-1 flex flex-col overflow-y-auto">
        <div class="flex-none text-sm mb-3">
          <span class="text-[#182B50]">需显示的字段</span>
          <span class="text-[#182B5066]">（最多展示{{ MAX_SHOW_NUM }}个）</span>
        </div>
        <div class="flex-1 overflow-y-auto">
          <div class="el-checkbox-group">
            <template v-for="field in allFieldList" :key="field.field_key">
              <el-checkbox
                :disabled="
                  fixedFields.includes(field.field_key) ||
                  (showFieldList.length === 1 && field.field_key === showFieldList[0].field_key)
                "
                :checked="Boolean(showFieldList.find((item) => item.field_key === field.field_key))"
                :value="field.field_key"
                @change="handleFieldChange($event as boolean, field)"
              >
                {{ field.field_name }}
              </el-checkbox>
            </template>
          </div>
        </div>
      </div>
      <div class="border-l mx-4" />
      <div class="flex-1 flex flex-col">
        <div class="flex-none text-sm mb-3">
          <span class="text-[#182B50]">显示顺序</span>
          <span class="text-[#182B5066]">（拖动分组调整分组顺序）</span>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button type="default" @click="handleCancel">取消</el-button>
      <el-button type="primary" @click="handleConfirm">保存</el-button>
    </template>
  </el-dialog>
</template>

<style>
.table-setting .cell {
  padding: 0 6px 0 0;
}
</style>

<style scoped>
::v-deep(.el-checkbox-group) {
  display: flex;
  flex-wrap: wrap;
}
::v-deep(.el-checkbox-group .el-checkbox) {
  flex: 0 0 50%;
  margin-right: 0;
  overflow: hidden;
}
::v-deep(.el-checkbox-group .el-checkbox__label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.el-table__header-wrapper),
:deep(.el-table__header) {
  height: 52px;
}
:deep(.el-table__row .el-table__cell) {
  height: 64px;
  padding: 0;
}
</style>
