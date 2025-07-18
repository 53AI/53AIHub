<template>
  <Layout class="px-[60px] py-8">
    <Header :title="$t('module.payment')" />

    <div class="flex-1 flex flex-col bg-white py-8 px-6 mt-3">
      <h1 class="font-semibold text-[#1D1E1F]">CNY</h1>
      <div class="mt-5 grid grid-cols-2 gap-5">
        <div class="border rounded-lg p-5 pb-8 group">
          <div class="relative w-full flex items-center gap-3">
            <SvgIcon name="wechat" width="24" />
            <label class="font-semibold text-[#1D1E1F]">{{ $t('payment.type.wechat') }}</label>
            <ElTag v-if="wechat_setting_info.pay_status" class="!border-none !bg-[#E3F6E0] !text-[#09BB07]" type="success" size="default">
              {{ $t('enabled') }}
            </ElTag>
            <div class="flex-1" />
            <ElDropdown placement="bottom" @command="handleCommand($event, 'wechat')">
              <div class="!border-none !outline-none p-1 cursor-pointer rounded overflow-hidden invisible group-hover:visible hover:bg-[#F0F0F0]">
                <ElIcon class="rotate-90" size="16">
                  <MoreFilled />
                </ElIcon>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="setting">
                    {{ $t('action_setting') }}
                  </el-dropdown-item>
                  <template v-if="wechat_setting_info.pay_setting_id">
                    <el-dropdown-item v-if="wechat_setting_info.pay_status" command="disable">
                      {{ $t('action_disable') }}
                    </el-dropdown-item>
                    <el-dropdown-item v-else command="enable">
                      {{ $t('action_enable') }}
                    </el-dropdown-item>
                  </template>
                </el-dropdown-menu>
              </template>
            </ElDropdown>
          </div>
          <div class="mt-3 text-sm text-[#4F5052]">
            {{
              wechat_setting_info.pay_setting_id
                ? `${$t('setting')} · ${$t('updated_at')}
							${wechat_setting_info.updated_time.slice(0, 16)}`
                : $t('not_setting')
            }}
          </div>
        </div>
        <div class="border rounded-lg p-5 pb-8 group">
          <div class="relative w-full flex items-center gap-3">
            <SvgIcon name="alipay" width="24" />
            <label class="font-semibold text-[#1D1E1F]">{{ $t('payment.type.alipay') }}</label>
            <ElTag v-if="alipay_setting_info.pay_status" class="!border-none !bg-[#E3F6E0] !text-[#09BB07]" type="success" size="default">
              {{ $t('enabled') }}
            </ElTag>
            <div class="flex-1" />
            <ElDropdown placement="bottom" @command="handleCommand($event, 'alipay')">
              <div class="!border-none !outline-none p-1 cursor-pointer rounded overflow-hidden invisible group-hover:visible hover:bg-[#F0F0F0]">
                <ElIcon class="rotate-90" size="16">
                  <MoreFilled />
                </ElIcon>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="setting">
                    {{ $t('action_setting') }}
                  </el-dropdown-item>
                  <template v-if="alipay_setting_info.pay_setting_id">
                    <el-dropdown-item v-if="alipay_setting_info.pay_status" command="disable">
                      {{ $t('action_disable') }}
                    </el-dropdown-item>
                    <el-dropdown-item v-else command="enable">
                      {{ $t('action_enable') }}
                    </el-dropdown-item>
                  </template>
                </el-dropdown-menu>
              </template>
            </ElDropdown>
          </div>
          <div class="mt-3 text-sm text-[#4F5052]">
            {{
              alipay_setting_info.pay_setting_id
                ? `${$t('setting')} · ${$t('updated_at')}
							${alipay_setting_info.updated_time.slice(0, 16)}`
                : $t('not_setting')
            }}
          </div>
        </div>
        <div class="border rounded-lg p-5 pb-8 group">
          <div class="relative w-full flex items-center gap-3">
            <SvgIcon name="manual-pay" width="24" />
            <label class="font-semibold text-[#1D1E1F]">{{ $t('payment.type.manual') }}</label>
            <ElTag v-if="manual_setting_info.pay_status" class="!border-none !bg-[#E3F6E0] !text-[#09BB07]" type="success" size="default">
              {{ $t('enabled') }}
            </ElTag>
            <div class="flex-1" />
            <ElDropdown placement="bottom" @command="handleCommand($event, 'manual')">
              <div class="!border-none !outline-none p-1 cursor-pointer rounded overflow-hidden invisible group-hover:visible hover:bg-[#F0F0F0]">
                <ElIcon class="rotate-90" size="16">
                  <MoreFilled />
                </ElIcon>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="setting">
                    {{ $t('action_setting') }}
                  </el-dropdown-item>
                  <template v-if="manual_setting_info.pay_setting_id">
                    <el-dropdown-item v-if="manual_setting_info.pay_status" command="disable">
                      {{ $t('action_disable') }}
                    </el-dropdown-item>
                    <el-dropdown-item v-else command="enable">
                      {{ $t('action_enable') }}
                    </el-dropdown-item>
                  </template>
                </el-dropdown-menu>
              </template>
            </ElDropdown>
          </div>
          <div class="mt-3 text-sm text-[#4F5052]">
            {{
              manual_setting_info.pay_setting_id
                ? `${$t('setting')} · ${$t('updated_at')}
							${manual_setting_info.updated_time.slice(0, 16)}`
                : $t('not_setting')
            }}
          </div>
        </div>
      </div>
      <h1 class="mt-10 font-semibold text-[#1D1E1F] opacity-60">USD</h1>
      <div class="mt-5 grid grid-cols-2 gap-5 opacity-60">
        <div class="flex-1 border border-[#E6E8EB] rounded-lg p-5 pb-8 group">
          <div class="relative w-full flex items-center gap-3">
            <SvgIcon name="paypal" width="24" />
            <label class="font-semibold text-[#1D1E1F]">{{ $t('payment.type.paypal') }}</label>
            <div class="flex-1" />
            <ElDropdown placement="bottom" @command="handleCommand($event, 'paypal')">
              <div class="!border-none !outline-none p-1 cursor-pointer rounded overflow-hidden invisible group-hover:visible hover:bg-[#F0F0F0]">
                <ElIcon class="rotate-90" size="16">
                  <MoreFilled />
                </ElIcon>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="setting">
                    {{ $t('action_setting') }}
                  </el-dropdown-item>
                  <el-dropdown-item command="enable">
                    {{ $t('action_enable') }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </ElDropdown>
          </div>
          <div class="mt-3 text-sm text-[#4F5052]">
            {{ $t('not_setting') }}
          </div>
        </div>
        <div class="flex-1 rounded-lg p-5 pb-8 group" />
      </div>
    </div>
  </Layout>

  <WechatSettingDialog ref="wechat_setting_ref" @success="refresh" />
  <ManualSettingDialog ref="manual_setting_ref" @success="refresh" />
  <AlipaySettingDialog ref="alipay_setting_ref" @success="refresh" />
</template>

<script setup lang="ts">
import { MoreFilled } from '@element-plus/icons-vue'
import { onMounted, onUnmounted, ref } from 'vue'
import WechatSettingDialog from './components/wechat-setting-dialog.vue'
import ManualSettingDialog from './components/manual-setting-dialog.vue'
import AlipaySettingDialog from './components/alipay-setting-dialog.vue'

import eventBus from '@/utils/event-bus'
import { settingApi } from '@/api/modules/setting'
import { PAYMENT_TYPE } from '@/constants/payment'
import { useEnv } from '@/hooks/useEnv'
import TipConfirm from '@/components/TipConfirm/setup'

const { isLocalEnv, isOpLocalEnv } = useEnv()
const wechat_setting_ref = ref()
const manual_setting_ref = ref()
const alipay_setting_ref = ref()

const wechat_setting_info = ref({})
const manual_setting_info = ref({})
const alipay_setting_info = ref({})

onMounted(() => {
  refresh()
  eventBus.on('user-login-success', refresh)
})
onUnmounted(() => {
  eventBus.off('user-login-success', refresh)
})

const refresh = async () => {
  const list = await settingApi.paymentSettingList()
  wechat_setting_info.value = list.find((item) => item.pay_type === PAYMENT_TYPE.WECHAT) || {}
  manual_setting_info.value = list.find((item) => item.pay_type === PAYMENT_TYPE.MANUAL) || {}
  alipay_setting_info.value = list.find((item) => item.pay_type === PAYMENT_TYPE.ALIPAY) || {}
}

const handleCommand = async (command, type = '') => {
  if (type == 'paypal') return ElMessage.warning(window.$t('feature_coming_soon'))
  if (isLocalEnv.value && isOpLocalEnv.value) {
    return TipConfirm({
      title: window.$t('local_config_limited_tip'),
      content: window.$t('local_config_limited_desc', { url: window.location.href }),
      confirmButtonText: window.$t('know_it'),
      showCancelButton: false
    }).open()
  }
  const data = type === 'wechat' ? wechat_setting_info.value : type === 'alipay' ? alipay_setting_info.value : manual_setting_info.value
  switch (command) {
    case 'setting':
      if (type === 'wechat') wechat_setting_ref.value.open({ data })
      else if (type === 'alipay') alipay_setting_ref.value.open({ data })
      else if (type === 'manual') manual_setting_ref.value.open({ data })
      break
    case 'enable':
      await settingApi.updatePaymentStatus(data.pay_setting_id, true)
      ElMessage.success(window.$t('enabled'))
      refresh()
      break
    case 'disable':
      await settingApi.updatePaymentStatus(data.pay_setting_id, false)
      ElMessage.success(window.$t('disabled'))
      refresh()
      break
  }
}
</script>

<style scoped lang="scss"></style>
