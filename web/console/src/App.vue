<template>
  <ElConfigProvider :locale="locale === 'en' ? en : locale === 'ja' ? ja : locale === 'zh-tw' ? zhTw : zhCn">
    <RouterView />
    <UserLoginDialog />
  </ElConfigProvider>
</template>


<script setup lang="ts">
import { ElConfigProvider } from 'element-plus'
import { useI18n } from 'vue-i18n'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import en from 'element-plus/es/locale/lang/en'
import ja from 'element-plus/es/locale/lang/ja'
import eventBus from '@/utils/event-bus'
import { gotoLogin } from '@/router'
// import { useRouter } from 'vue-router'
import { useEnterpriseStore, useUserStore } from '@/stores'

const { locale } = useI18n()
// const router = useRouter()
const enterprise_store = useEnterpriseStore()
const user_store = useUserStore()

eventBus.on('user-login-expired', async () => {
  await user_store.logoff()
  gotoLogin()
})
enterprise_store.loadSelfInfo()
user_store.loadSelfInfo()
</script>

<style>
/* 临时添加，后续hub-ui-x 要支持 */
.markdown-body img {
  display: inline;
}
</style>
