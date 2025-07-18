<template>
  <ElDialog
    v-model="visible"
    :title="$t('action_authorize') + $t(origin_data.label || '')"
    :close-on-click-modal="false"
    width="720px"
    destroy-on-close
    append-to-body
    @close="close"
  >
    <ElForm
      ref="form_ref"
      :model="form"
      :rules="formRules"
      label-position="top"
    >
      <!-- 提示信息 -->
      <div class="w-full flex flex-col gap-3 bg-[#F6F9FC] p-5 mb-4 box-border text-sm text-[#4F5052]">
        <div
          class="whitespace-pre-wrap leading-7"
          v-html="guideHtml"
        />
        <ElIcon
          v-if="origin_data.value === PROVIDER_VALUE.COZE_CN"
          ref="copy_ref"
          class="cursor-pointer ml-1 mt-1 text-[#4F5052] hover:text-[#3664EF]"
          :size="14"
          @click="handleCopy(coze_auth_url)"
        >
          <CopyDocument />
        </ElIcon>
      </div>

      <template v-for="option in schemaOptions" :key="option.prop">
        <ElFormItem
          :label="option.label"
          :prop="option.prop"
        >
          <ElInput
            v-model="form[option.prop]"
            size="large"
            :placeholder="option.placeholder"
          />
        </ElFormItem>
      </template>
    </ElForm>

    <template #footer>
      <div
        v-if="origin_data.value === PROVIDER_VALUE.COZE_CN"
        class="text-center text-sm text-[#9A9A9A]"
      >
        {{ $t('platform_auth.coze_cn.tip_1') }}
      </div>
      <div class="py-4 flex items-center justify-center">
        <ElButton
          class="w-[96px] h-[36px]"
          type="primary"
          :loading="saving"
          @click="handleConfirm"
        >
          {{ $t('action_confirm') }}
        </ElButton>
        <ElButton
          class="w-[96px] h-[36px] text-[#1D1E1F]"
          type="info"
          plain
          @click.stop="close"
        >
          {{ $t('action_cancel') }}
        </ElButton>
      </div>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { CopyDocument } from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'
import { useEnterpriseStore } from '@/stores'
import { copyToClip } from '@/utils/copy'
import { api_host } from '@/utils/config'
import { PROVIDER_VALUE } from '@/constants/platform/provider'
import { providerApi } from '@/api'
import type { ProviderValueType } from '@/constants/platform/provider'

interface AuthForm {
  client_id: string
  client_secret: string
  api_key: string
  base_url: string
  access_token: string
  [key: string]: string
}

interface ProviderData {
  label?: string
  value?: ProviderValueType
  provider_id?: string
  client_id?: string
  client_secret?: string
  base_url?: string
  is_authorized?: number
  access_token?: string
}

interface SaveData {
  configs: Record<string, any>
  name?: string
  provider_type: ProviderValueType
  provider_id?: string
  base_url?: string
  access_token?: string
}

const emits = defineEmits<{
  (e: 'success'): void
}>()

// 状态管理
const enterprise_store = useEnterpriseStore()
const copy_ref = shallowRef<InstanceType<typeof ElIcon> | null>(null)
const form_ref = shallowRef<FormInstance | null>(null)
const visible = ref(false)
const form = reactive<AuthForm>({
  client_id: '',
  client_secret: '',
  api_key: '',
  base_url: '',
  access_token: '',
})
const origin_data = ref<ProviderData>({})
const saving = ref(false)

// 计算属性
const coze_auth_url = computed(() => {
  const enterprise_info = enterprise_store.info
  return `${api_host}/api/callback/cozecn/auth/${enterprise_info.eid}`
})

// 平台配置
const PLATFORM_CONFIGS = {
  [PROVIDER_VALUE.APP_BUILDER]: {
    i18n_key: 'app_builder',
    tip: {
      url: 'https://qianfan.cloud.baidu.com/appbuilder',
    },
    fields: [{
      label: 'module.platform_tool_api_key',
      prop: 'api_key',
      placeholder: 'module.platform_tool_api_key_placeholder',
    }],
    transformData: (form: AuthForm) => ({
      access_token: form.api_key,
    }),
  },
  [PROVIDER_VALUE.COZE_CN]: {
    i18n_key: 'coze_cn',
    tip: {
      url: 'https://www.coze.cn/open/oauth/apps',
      needRedirectUrl: true,
    },
    fields: [{
      label: 'module.platform_auth_client_id',
      prop: 'client_id',
      placeholder: 'module.platform_auth_client_id_placeholder',
    }, {
      label: 'module.platform_auth_client_secret',
      prop: 'client_secret',
      placeholder: 'module.platform_auth_client_secret_placeholder',
    }],
    transformData: (form: AuthForm) => ({
      configs: {
        client_id: form.client_id,
        client_secret: form.client_secret,
      },
    }),
    needsConfirmation: (form: AuthForm, origin: ProviderData) => {
      return !origin.provider_id || (form.client_id !== origin.client_id || form.client_secret !== origin.client_secret)
    },
    getAuthUrl: (form: AuthForm, redirectUrl: string) => {
      return `https://www.coze.cn/api/permission/oauth2/authorize?response_type=code&client_id=${form.client_id}&redirect_uri=${encodeURIComponent(redirectUrl)}&state=coze_auth`
    },
  },
  [PROVIDER_VALUE['53AI']]: {
    i18n_key: '53ai',
    tip: {
      url: 'https://www.53ai.com/',
    },
    fields: [{
      label: 'module.platform_auth_url',
      prop: 'base_url',
      placeholder: 'module.platform_model_base_url_placeholder_53ai',
    }, {
      label: 'module.platform_auth_secret',
      prop: 'access_token',
      placeholder: 'module.platform_tool_api_key_placeholder',
    }],
    setFormData: (form: AuthForm) => {
      form.base_url = form.base_url.trim() || 'https://api.53ai.com'
      form.access_token = form.access_token.trim()
    },
    transformData: (form: AuthForm) => ({
      base_url: form.base_url,
      access_token: form.access_token,
    }),
  },
}

const guideHtml = computed(() => {
  const {value} = origin_data.value
  if (typeof value !== 'number')
    return ''

  const config = PLATFORM_CONFIGS[value]
  if (!config)
    return ''

  const tipParams: Record<string, string> = {
    url: `<a class='text-[#5A6D9E]' href='${config.tip.url}' target='_blank'>${config.tip.url}</a>`,
  }

  if (config.tip.needRedirectUrl) {
    tipParams.redirect_url = `<span class='text-[#F04F4D]'>${coze_auth_url.value}</span><span class='copy-hook'></span>`
    tipParams.client_id = `<span class='text-[#F04F4D]'>${window.$t('module.platform_auth_client_id')}</span>`
    tipParams.client_secret = `<span class='text-[#F04F4D]'>${window.$t('module.platform_auth_client_secret')}</span>`
  }

  return window.$t(`platform_auth.${config.i18n_key}.tip`, tipParams)
})

const schemaOptions = computed(() => {
  const {value} = origin_data.value
  if (typeof value !== 'number')
    return []

  const config = PLATFORM_CONFIGS[value]
  return config?.fields.map(field => ({
    label: window.$t(field.label),
    prop: field.prop,
    placeholder: window.$t(field.placeholder),
  })) || []
})

// 表单验证规则
const formRules = computed(() => {
  const rules: FormRules = {}
  const {value} = origin_data.value
  if (typeof value === 'number' && PLATFORM_CONFIGS[value]) {
    PLATFORM_CONFIGS[value].fields.forEach((field) => {
      rules[field.prop] = [{
        validator: (_, value: string, callback: Function) => {
          if (!(value || '').trim())
            return callback(new Error(window.$t(field.placeholder)))
          callback()
        },
        trigger: 'blur',
      }]
    })
  }
  return rules
})

const reset = () => {
  Object.assign(form, {
    client_id: '',
    client_secret: '',
    api_key: '',
    base_url: '',
    access_token: '',
  })
}

// 方法
const open = async ({ data = {} as ProviderData } = {}) => {
  form.client_id = data.client_id || ''
  form.client_secret = data.client_secret || ''
  form.api_key = data.access_token || ''
  form.base_url = data.base_url || ''
  form.access_token = data.access_token || ''

  const config = PLATFORM_CONFIGS[data.value]
  if (config?.setFormData)
    config.setFormData(form)

  origin_data.value = data
  visible.value = true

  await nextTick()
  const {value} = data
  if (typeof value === 'number' && value === PROVIDER_VALUE.COZE_CN && copy_ref.value?.$el) {
    const copy_hook_el = form_ref.value?.$el.querySelector('.copy-hook')
    copy_hook_el?.appendChild(copy_ref.value.$el)
  }
}

const close = () => {
  visible.value = false
  reset()
}

const handleCopy = async (text: string) => {
  if (!text)
    return
  await copyToClip(text)
  ElMessage.success(window.$t('action_copy_success'))
}

const handleAuthorization = async (auth_url: string, provider_type: ProviderValueType) => {
  const auth_window = window.open(auth_url, '_blank', 'width=1000,height=800')

  window.addEventListener('message', ({ data = {} }) => {
    if (data.provider_type === provider_type) {
      auth_window?.close()
      ElMessage.success(window.$t('action_authorize_success'))
      emits('success')
    }
  })
}

const handleConfirm = async () => {
  if (!form_ref.value)
    return

  const valid = await form_ref.value.validate()
  if (!valid)
    return

  const providerType = origin_data.value.value as ProviderValueType
  const config = PLATFORM_CONFIGS[providerType]
  if (!config)
    return

  const data: SaveData = {
    configs: {},
    name: origin_data.value.label,
    provider_type: providerType,
    provider_id: origin_data.value.provider_id,
    ...config.transformData(form),
  }

  if (config.needsConfirmation && config.needsConfirmation(form, origin_data.value)) {
    await ElMessageBox.confirm(
      window.$t('module.platform_auth_coze_confirm'),
      window.$t('tip'),
    )
  }

  try {
    saving.value = true
    await providerApi.save({ data })

    if (config.getAuthUrl && !origin_data.value.is_authorized) {
      const auth_url = config.getAuthUrl(form, coze_auth_url.value)
      await handleAuthorization(auth_url, providerType)
    }

    ElMessage.success(window.$t('action_save_success'))
    emits('success')
    close()
  }
  catch (error) {
    console.error('Save failed:', error)
    ElMessage.error(window.$t('action_save_failed'))
  }
  finally {
    saving.value = false
  }
}

defineExpose({
  open,
  close,
  reset,
})
</script>

<style scoped>
.el-dialog {
  --el-dialog-padding-primary: 24px;
}
</style>
