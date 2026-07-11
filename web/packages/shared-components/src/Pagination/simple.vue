<script setup lang="ts">
import { ref, watch } from 'vue'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'

const props = withDefaults(
  defineProps<{
    page?: number
    total: number
  }>(),
  {
    page: 1,
    total: 0,
  },
)
const emits = defineEmits<{
  (e: 'change', page: number): void
}>()
const val = ref(1)

const onChange = () => {
  emits('change', val.value)
}
const handlePrev = () => {
  if (val.value === 1) return
  val.value -= 1
  onChange()
}

const handleNext = () => {
  if (val.value === props.total) return
  val.value += 1
  onChange()
}

watch(
  () => props.page,
  (page) => {
    val.value = page
  },
)
</script>

<template>
  <div v-if="total" class="flex items-center gap-5">
    <el-icon
      color="#182B50"
      :class="[val === 1 ? 'cursor-not-allowed opacity-20' : 'cursor-pointer']"
      @click="handlePrev"
    >
      <ArrowLeft />
    </el-icon>
    <div class="flex items-center">
      <el-input-number v-model="val" :controls="false" :min="1" :max="total" @change="onChange" />
      <span class="text-regular mx-2">/</span>
      <span class="text-sm text-regular">{{ total }}</span>
    </div>
    <el-icon
      color="#182B50"
      :class="[val === total ? 'cursor-not-allowed opacity-20' : 'cursor-pointer']"
      @click="handleNext"
    >
      <ArrowRight />
    </el-icon>
  </div>
</template>

<style scoped>
::v-deep(.el-input-number) {
  width: 47px;
}
</style>
