<template>
  <ElForm ref="formRef" class="py-0 px-3" :model="formData" label-position="top" label-width="120px">
    <!-- <h1 class="font-semibold text-[#1D1E1F]">{{ $t('basic_info') }}</h1> -->
    <ElFormItem
      :label="$t('group')" prop="group_ids"
      :rules="[{ required: true, message: $t('form_select_placeholder') }]"
    >
      <GroupSelect v-model="formData.group_ids" :group-type="GROUP_TYPE_PROMPT" default-first multiple clearable />
    </ElFormItem>
    <ElFormItem
      :label="$t('action_sort')" prop="sort"
      :rules="[{ required: true, message: $t('form_input_placeholder') }]"
    >
      <ElInputNumber
        v-model="formData.sort" class="!w-[200px]" size="large" :controls="false" :precision="0" :min="0" :max="99999999"
        :placeholder="$t('form_input_placeholder')"
        @keydown="$numberInputKeydownHandler"
      />
      <div class="w-full text-sm text-[#9A9A9A]">
        {{ $t('module.agent_sort_desc') }}
      </div>
    </ElFormItem>
    <ElFormItem :label="$t('title')" prop="name" :rules="[{ required: true, message: $t('form_input_placeholder') }]">
      <ElInput
        v-model="formData.name" size="large" :placeholder="$t('form_input_placeholder')" :maxlength="20"
        show-word-limit clearable
      />
    </ElFormItem>
    <ElFormItem :label="$t('description')" prop="description">
      <ElInput
        v-model="formData.description" type="textarea" :rows="6" resize="none"
        :placeholder="$t('form_input_placeholder')" :maxlength="200" show-word-limit clearable
      />
    </ElFormItem>
    <ElFormItem
      v-if="false" :label="$t('prompt.content')" prop="content"
      :rules="[{ required: true, message: $t('form_input_placeholder') }]"
    >
      <!-- <Fullscreen class="w-full" :z-index="9">
				<template #default="{ isopen, handler }"></template>
			</Fullscreen> -->
      <div class="border prompt-input-wrapper rounded w-full flex flex-col !bg-white overflow-auto relative">
        <div class="min-h-10 pl-3 pr-2 border-b flex items-center justify-between rounded-t bg-white">
          <div class="flex-1 text-sm text-[#4F5052] truncate" :title="$t('role_instruction_desc')">
            *{{ $t('role_instruction_desc') }}
          </div>
          <div class="flex items-center gap-1">
            <ElTooltip placement="top" :content="$t('optimize_tip')">
              <span
                class="flex-center gap-1 text-[#2563EB] text-sm px-1 cursor-pointer opacity-60 pointer-events-none"
                @click.stop="onOptimize"
              >
                <svg-icon name="hglt" width="18px" />
                {{ $t('optimize') }}
              </span>
            </ElTooltip>
            <div class="flex-none h-4 w-px border-r border-[#E1E2E6]" />
            <ElTooltip placement="top" :content="$t('generate_tip')">
              <span class="text-[#182B50] px-1 cursor-pointer opacity-60 pointer-events-none" @click.stop="onGenerate">
                <svg-icon name="magic-stick" width="18px" />
              </span>
            </ElTooltip>
            <!-- <el-tooltip placement="top" :content="$t('action_copy')">
							<span class="text-[#182B50] px-1 cursor-pointer" @click.stop="onCopy(store.form_data.prompt)">
								<svg-icon name="copy" width="18px" />
							</span>
						</el-tooltip> -->
            <!-- <el-tooltip placement="top" :content="$t(!isopen ? 'action_amplify' : 'action_shrink')">
							<span class="text-[#182B50] px-1 cursor-pointer" @click.stop="handler">
								<svg-icon :name="!isopen ? 'amplify' : 'shrink'" width="18px" />
							</span>
						</el-tooltip> -->
          </div>
        </div>
        <PromptInput
          v-model="formData.content" style="height: 548px; min-height: max-content;" show-line show-token
          @change="formRef.validateField('content')"
        />
      </div>
    </ElFormItem>
    <h1 class="font-semibold text-[#1D1E1F] mt-8 mb-4">
      {{ $t('usage_range') }}
    </h1>
    <ElFormItem :hidden="!(enterprise.info.is_independent || enterprise.info.is_industry)" :label="$t('register_user.title')" prop="subscription_group_ids">
      <GroupSelect
        v-model="formData.subscription_group_ids" type="checkbox" :group-type="GROUP_TYPE_USER" multiple
        default-all
      />
    </ElFormItem>
    <ElFormItem :hidden="!(enterprise.info.is_enterprise || enterprise.info.is_industry)" :label="$t('internal_user.title')" prop="user_group_ids">
      <GroupSelect v-model="formData.user_group_ids" type="picker" :group-type="GROUP_TYPE_INTERNAL_USER" multiple />
    </ElFormItem>
  </ElForm>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useFormDataStore } from './store'
import PromptInput from '@/components/Prompt/input.vue'

import { GROUP_TYPE_INTERNAL_USER, GROUP_TYPE_PROMPT, GROUP_TYPE_USER } from '@/api/modules/group'
import { useEnterpriseStore } from '@/stores/modules/enterprise'

const enterprise = useEnterpriseStore()
const formDataStore = useFormDataStore()

const {formData} = formDataStore
const formRef = ref()

defineExpose({
  validate: () => formRef.value.validate(),
})
</script>

<style scoped>
.is-error .prompt-input-wrapper {
	border-color: #F56C6C;
}
</style>
