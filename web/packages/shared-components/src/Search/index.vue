<template>
  <el-input
    v-if="searching"
    ref="inputRef"
    v-model="input"
    style="max-width: 230px"
    size="default"
    clearable
    :prefix-icon="Search"
    :placeholder="placeholder || $t('shared_components.search_placeholder')"
    class="input-with-search"
    :disabled="disabled"
    @blur="handleBlur"
    @input="handleInput"
    @change="handleChange"
  />
  <div
    v-else
    class="h-8 flex items-center gap-1"
    :class="[disabled ? 'text-[#999] cursor-not-allowed' : 'cursor-pointer text-[#576D9C]']"
    @click="handleFocus"
  >
    <svg-icon name="search" width="16" />
    <span class="text-sm">{{ text || $t('shared_components.search_text') }}</span>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { debounce } from '@km/shared-utils';

const props = withDefaults(
  defineProps<{
    placeholder?: string
    text?: string
    size?: string
    disabled?: boolean
  }>(),
  {
    placeholder: '',
    text: '',
    size: 'default',
    disabled: false,
  },
)

const emits = defineEmits<{
  (e: 'input', value: string): void
  (e: 'change', value: string): void
}>()

const inputRef = ref()

const input = ref('')
const searching = ref(false)

const handleFocus = () => {
  if (props.disabled) return
  searching.value = true
  nextTick(() => {
    inputRef.value.focus()
  })
}
const handleBlur = () => {
  if (input.value) return
  searching.value = false
}

const handleInput = debounce(() => {
  emits('input', input.value)
}, 600)
const handleChange = debounce(() => {
  emits('change', input.value)
}, 0)
</script>

<style>
.input-with-search .el-input-group__prepend {
  padding: 0 10px;
  --el-fill-color-light: transparent;
}
.input-with-search .el-input-group__append {
  padding: 0 12px;
  cursor: pointer;
}
</style>
