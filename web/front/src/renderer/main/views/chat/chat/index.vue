<template>
  <div class="h-full flex gap-10 bg-white relative overflow-hidden">
    <div class="flex-1 flex flex-col">
      <MainHeader v-if="!hideMenuHeader">
        <template #before_suffix>
          <div
            class="text-base text-primary line-clamp-1 max-md:flex-1 max-md:text-center"
            :title="currentConv.title || currentAgent.name || ''"
          >
            {{ currentConv.title || currentAgent.name || '' }}
          </div>
        </template>
        <template #after_prefix>
          <span
            class="flex items-center gap-1 text-sm cursor-pointer md:hidden"
            @click="$router.back()"
          >
            <svg-icon name="return" size="18" stroke></svg-icon>
          </span>
        </template>
        <template #after_suffix>
          <div
            class="h-[26px] px-2 rounded-full flex-center gap-1.5 text-sm text-primary cursor-pointer hover:bg-[#E1E2E3]"
            @click="handleToggleGuide"
            v-tooltip="{ content: $t('chat.usage_guide') }"
          >
            <div class="size-4">
              <svg-icon name="layout-split" size="18"></svg-icon>
            </div>
          </div>
        </template>
      </MainHeader>

      <!-- 消息列表区域 -->
      <x-bubble-list
        class="flex-1"
        :autoScroll="true"
        :messages="state.messageList"
        :mainClass="[showRecommend ? 'w-[95%]' : 'w-11/12 md:w-4/5 max-w-[800px] mx-auto mt-5']"
        enablePullUp
        @pull-up="handleLoadListMore"
      >
        <template #header v-if="currentAgent.settings_obj">
          <div
            class="w-full mt-2 flex items-center gap-3 box-border p-6 rounded-xl overflow-hidden"
            :style="{
              background: `linear-gradient(90deg, rgba(243, 249, 254, 1) 0%, rgba(247, 243, 255, 1) 100%)`
            }"
          >
            <img class="flex-none size-10 rounded-full overflow-hidden" :src="currentAgent.logo" />
            <div class="flex-1 flex flex-col gap-1">
              <div class="text-xl font-semibold text-primary">{{ currentAgent.name }}</div>
              <div class="text-sm text-regular break-words whitespace-pre-wrap">
                {{ currentAgent.description }}
              </div>
            </div>
          </div>
          <div class="mt-2 mb-10">
            <AuthTagGroup labelPosition="top" :modelValue="currentAgent.user_group_ids" />
          </div>
          <x-bubble-assistant
            v-if="showWelcome"
            type="welcome"
            :content="currentAgent.settings_obj.opening_statement"
            :suggestions="currentAgent.settings_obj.suggested_questions"
            @suggestion="handleSuggestion"
          >
          </x-bubble-assistant>
        </template>
        <template #item="{ message, index }">
          <!-- 用户消息气泡 -->
          <x-bubble-user
            :key="message.id + '_user'"
            :content="message.query"
            :files="message.user_files"
          >
            <template #menu>
              <div
                class="h-6 px-1 rounded flex-center cursor-pointer hover:bg-[#E1E2E3]"
                v-tooltip="{ content: $t('action.copy') }"
                v-copy="message.query"
              >
                <el-icon color="#9B9B9B">
                  <CopyDocument />
                </el-icon>
              </div>
            </template>
          </x-bubble-user>

          <!-- AI助手消息气泡 -->
          <x-bubble-assistant
            :key="message.id + '_assistant'"
            :content="message.answer"
            :reasoning="message.reasoning_content"
            :reasoning-expanded="message.reasoning_expanded"
            :streaming="message.loading"
            :alwaysShowMenu="index === state.messageList.length - 1"
          >
            <template #menu v-if="!message.loading">
              <div
                v-tooltip="{ content: $t('action.copy') }"
                v-copy="message.answer"
                class="h-6 px-1 rounded flex-center cursor-pointer hover:bg-[#E1E2E3]"
              >
                <el-icon color="#9B9B9B">
                  <CopyDocument />
                </el-icon>
              </div>
              <div
                class="h-6 px-1 rounded flex-center cursor-pointer hover:bg-[#E1E2E3]"
                v-tooltip="{ content: $t('chat.regenerate') }"
                @click="handleRegenerate(message)"
              >
                <el-icon color="#9B9B9B">
                  <Refresh />
                </el-icon>
              </div>
              <div
                v-if="false"
                class="h-6 px-1 rounded flex-center cursor-pointer hover:bg-[#E1E2E3]"
                v-tooltip="{ content: $t('chat.like') }"
              >
                <svg-icon size="18" name="like" color="#9B9B9B"></svg-icon>
              </div>
              <div
                v-if="false"
                class="h-6 px-1 rounded flex-center cursor-pointer hover:bg-[#E1E2E3]"
                v-tooltip="{ content: $t('chat.like') }"
              >
                <svg-icon size="18" name="dislike" color="#9B9B9B"></svg-icon>
              </div>
            </template>
          </x-bubble-assistant>
        </template>
      </x-bubble-list>

      <!-- 底部输入区域 -->
      <div
        class="py-5"
        :class="[showRecommend ? 'w-full box-border' : 'w-11/12 md:w-4/5 max-w-[800px] mx-auto']"
      >
        <div class="flex gap-2 mb-2.5">
          <AgentTooltip @select="onSelectAgent">
            <div
              class="h-8 px-2 rounded-full flex-center gap-1.5 bg-[#F1F2F3] cursor-pointer hover:bg-[#E1E2E3]"
            >
              <img class="size-4 rounded-full" :src="currentAgent.logo" alt="" />
              <span class="text-sm text-primary">{{ currentAgent.name }}</span>
              <div class="size-4 flex-center">
                <el-icon color="#333333">
                  <ArrowDown />
                </el-icon>
              </div>
            </div>
          </AgentTooltip>

          <div
            v-if="false"
            class="h-8 px-2 rounded-full flex-center gap-1.5 bg-[#F1F2F3] cursor-pointer hover:bg-[#E1E2E3]"
          >
            <div class="size-4">
              <svg-icon name="network"></svg-icon>
            </div>
            <span class="text-sm text-primary">{{ $t('chat.online_search') }}</span>
          </div>
          <div class="flex-1"></div>
          <div
            v-if="showHistory"
            class="h-8 px-2 rounded-full flex-center gap-1.5 bg-[#F1F2F3] text-sm text-primary cursor-pointer hover:bg-[#E1E2E3]"
            @click="historyRef.open"
          >
            <div class="size-4">
              <svg-icon name="history"></svg-icon>
            </div>
            {{ $t('chat.history') }}
          </div>
          <div
            class="h-8 px-2 rounded-full flex-center gap-1.5 bg-[#F1F2F3] text-sm text-primary cursor-pointer hover:bg-[#E1E2E3]"
            @click="handleNewConversation"
          >
            <div class="size-4">
              <svg-icon name="plus"></svg-icon>
            </div>
            {{ $t('chat.new_conversation') }}
          </div>
        </div>
        <x-sender
          :http-request="httpRequest"
          :enable-upload="enable_upload"
          :accept-types="upload_accept"
          :loading="state.isStreaming"
          @send="handleSend"
          @stop="handleStop"
        >
        </x-sender>
        <div v-if="!hideFooter" class="flex justify-center items-center my-2">
          <img src="/images/chat/footer.png" class="h-[12px]" />
        </div>
      </div>
    </div>
    <div class="flex-none w-2/6 box-border relative" v-if="showRecommend">
      <h2 class="text-xl font-semibold text-primary">{{ $t('common.related_agent') }}</h2>
      <ListView
        v-if="currentAgent.agent_id"
        class="!w-full max-w-full !mt-4 !mb-0"
        hideFilter
        singleRow
        hideHeader
        hideFooter
        :showLimit="6"
        :excludeIds="[currentAgent.agent_id]"
        :transition="false"
      />
    </div>

    <!-- 右侧帮助面板 -->
    <Transition name="slide">
      <div
        v-if="state.showHelper"
        class="border-l bg-white left-0 right-0 top-0 bottom-0 z-[10]"
        :class="[useCaseFixed && state.showHelper ? 'fixed' : 'absolute']"
      >
        <div class="h-[70px] flex-center border-b relative">
          <h4 class="text-lg text-primary">{{ $t('chat.usage_guide') }}</h4>
          <div
            class="flex-center size-6 absolute right-2 top-1/2 -translate-y-1/2 rounded cursor-pointer hover:bg-[#ECEDEE]"
            @click="handleToggleGuide"
          >
            <el-icon>
              <Close />
            </el-icon>
          </div>
        </div>
        <Helper :agent="currentAgent"></Helper>
      </div>
    </Transition>

    <HistoryDrawer ref="historyRef" @new="handleNewConversation" />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, reactive, computed, onMounted, ref, nextTick } from 'vue'
import { Close, ArrowDown, CopyDocument, Refresh } from '@element-plus/icons-vue'
import AuthTagGroup from '@/components/AuthTagGroup/index.vue'
import MainHeader from '@/layout/header.vue'
import AgentTooltip from './agent-tooltip.vue'
import ListView from '@/views/agent/index.vue'
import HistoryDrawer from './history.vue'

import { useConversationStore } from '@/stores/modules/conversation'

import { API_HOST } from '@/api/host'
import chatApi from '@/api/modules/chat'
import uploadApi from '@/api/modules/upload'
import conversationApi from '@/api/modules/conversation'
import { checkPermission } from '@/directive/permission'

const Helper = defineAsyncComponent(() => import('../helper.vue'))
// 扩展消息类型，添加动效相关属性
interface ExtendedMessage extends Conversation.Message {
  isNew?: boolean
}

const convStore = useConversationStore()

const props = withDefaults(
  defineProps<{
    hideMenuHeader?: boolean
    hideFooter?: boolean
    showRecommend?: boolean
    useCaseFixed?: boolean
    showHistory?: boolean
  }>(),
  {
    hideMenuHeader: false,
    hideFooter: false,
    showRecommend: false,
    useCaseFixed: false,
    showHistory: false
  }
)

const abortController = ref<AbortController | null>(null)
const historyRef = ref<InstanceType<typeof HistoryDrawer> | null>(null)

const currentAgent = computed(() => convStore.currentAgent)
const currentConv = computed(() => convStore.currentConversation)
const custom_config_obj = computed(() => convStore.currentAgent.custom_config_obj)
const enable_upload = computed(() =>
  Boolean(
    custom_config_obj.value?.file_parse?.enable || custom_config_obj.value?.image_parse?.enable
  )
)
const upload_accept = computed(() => {
  let accept = ''
  if (custom_config_obj.value?.file_parse?.enable)
    accept += '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.html,.json,.xml,.md'
  if (custom_config_obj.value?.image_parse?.enable) accept += ',image/*'
  return accept
})

const showWelcome = computed(() => {
  const settings = currentAgent.value.settings_obj
  if (settings.opening_statement && settings.opening_statement.replace(/\s/g, '')) return true
  if (
    settings.suggested_questions &&
    settings.suggested_questions.length &&
    settings.suggested_questions.some((item) => item.content.replace(/\s/g, ''))
  )
    return true
  return false
})

const state = reactive({
  offset: 0,
  limit: 10,
  showHelper: false,
  messageList: [] as ExtendedMessage[],
  isStreaming: false,
  isLoadingMore: false, // 添加加载更多状态标志
  hasMore: true // 是否还有更多消息
})

const handleToggleGuide = () => {
  state.showHelper = !state.showHelper
}

const onSelectAgent = (agent: Agent.State) => {
  convStore.pushUsualAgent(agent)
  convStore.setCurrentState(agent.agent_id, 0)
}

const handleNewConversation = () => {
  convStore.setCurrentState(currentAgent.value.agent_id, 0)
}

const httpRequest = async (dataFile: File) => {
  try {
    const res = await uploadApi.upload(dataFile)
    return {
      id: res.data.id,
      url: `${API_HOST}/api/preview/${res.data.preview_key || ''}`,
      size: res.data.size,
      name: res.data.file_name,
      mime_type: res.data.mime_type
    }
  } catch (error) {
    return {}
  }
}

// 处理流式数据的函数
const processStreamData = (e: any, processedLength: number): number => {
  const lastMessage = state.messageList[state.messageList.length - 1]
  if (!e.event?.target) return processedLength

  const fullResponse = e.event.target.response || ''
  // 只处理新增的部分
  const newChunk = fullResponse.substring(processedLength)
  const newProcessedLength = fullResponse.length

  try {
    // 处理SSE格式的数据
    const lines = newChunk
      .split('\n')
      .filter((line) => line.trim() !== '' && line.trim() !== 'data: [DONE]')

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          const content = data.choices?.[0]?.delta?.content
          const reasoning_content = data.choices?.[0]?.delta?.reasoning_content
          if (content) {
            // 将新内容追加到当前消息
            lastMessage.answer += content
          }
          if (reasoning_content) {
            // 将新内容追加到当前消息
            lastMessage.reasoning_content += reasoning_content
          }
        } catch (err) {
          console.error('解析JSON失败:', err)
        }
      }
    }
  } catch (err) {
    console.error('处理流数据失败:', err)
  }

  return newProcessedLength
}

// 工具函数
const messageUtils = {
  // 格式化消息
  formatMessage: (item: any): ExtendedMessage => {
    const data = {
      ...item,
      query: ''
    }
    const content = JSON.parse(item.message)[0].content
    try {
      const arr = JSON.parse(content)
      const query = arr.find((item) => item.type === 'text')?.content
      data.query = query
      data.user_files = arr.filter((item) => item.type === 'image')
    } catch (error) {
      data.query = content
    }
    return data
  },

  // 格式化文件
  formatFiles: (user_files: any[]): Conversation.UserFile[] =>
    user_files?.map((item) => ({
      type: 'image',
      content: `file_id:${item.id}`,
      filename: item.name,
      size: item.size,
      mime_type: item.mime_type,
      url: item.url
    })) || [],

  // 创建新消息
  createNewMessage: (
    query: string,
    agent_id: number,
    conversation_id: number,
    user_files: Conversation.UserFile[]
  ): ExtendedMessage => ({
    id: Date.now(),
    query,
    answer: '',
    loading: true,
    agent_id,
    conversation_id,
    reasoning_content: '',
    reasoning_expanded: true,
    user_files
  })
}

// 加载消息列表
const loadMessages = async (conversation_id: number, offset: number, limit: number) => {
  try {
    const res = await conversationApi.messasges(conversation_id, { offset, limit })
    const list = res.data.messages.map(messageUtils.formatMessage)
    return {
      messages: list,
      hasMore: list.length === limit
    }
  } catch (err) {
    console.error('加载消息失败:', err)
    return { messages: [], hasMore: false }
  }
}

const handleLoadListMore = async (done) => {
  if (state.isLoadingMore || !state.hasMore) return done()

  const conversation_id = currentConv.value.conversation_id
  if (!conversation_id) return

  state.isLoadingMore = true
  state.offset += state.limit

  try {
    const { messages, hasMore } = await loadMessages(conversation_id, state.offset, state.limit)
    state.hasMore = hasMore
    state.messageList.unshift(...messages)
  } catch (err) {
    state.offset = Math.max(0, state.offset - state.limit)
  } finally {
    state.isLoadingMore = false
    nextTick(() => {
      done()
    })
  }
}

const loadList = async () => {
  const conversation_id = currentConv.value.conversation_id
  if (!conversation_id) return

  state.isLoadingMore = true
  state.offset = 0
  state.hasMore = true

  try {
    const { messages, hasMore } = await loadMessages(conversation_id, state.offset, state.limit)
    state.hasMore = hasMore
    state.messageList = messages
  } finally {
    state.isLoadingMore = false
  }
}

const sendMessage = async (query: string, user_files: any[]) => {
  if (state.isStreaming) return

  const agent_id = currentAgent.value.agent_id
  const conversation_id = currentConv.value.conversation_id

  // 创建新消息
  const newMessage = messageUtils.createNewMessage(query, agent_id, conversation_id, user_files)
  state.messageList.push(newMessage)

  const configs = JSON.parse(currentAgent.value.configs || '{}')
  const completion_params = configs.completion_params || {}
  state.isStreaming = true
  abortController.value = new AbortController()
  let processedLength = 0

  let content = query
  if (user_files.length > 0) {
    content = JSON.stringify([{ type: 'text', content: query }, ...user_files])
  }

  try {
    await chatApi.completions(
      {
        conversation_id,
        model: 'agent-' + agent_id,
        messages: [{ content, role: 'user' }],
        frequency_penalty: 0,
        presence_penalty: 0,
        stream: true,
        temperature: 0,
        top_p: 0,
        ...completion_params
      },
      {
        responseType: 'stream',
        onDownloadProgress: (e) => {
          processedLength = processStreamData(e, processedLength)
        },
        signal: abortController.value.signal
      }
    )
  } catch (err: any) {
    if (err.message !== 'canceled') {
      console.log(err)
      const lastMessage = state.messageList[state.messageList.length - 1]
      if (lastMessage && !lastMessage.answer) {
        lastMessage.answer = err.response.data || window.$t('response_code.network_error')
      }
    }
  } finally {
    const lastMessage = state.messageList[state.messageList.length - 1]
    if (lastMessage) {
      lastMessage.loading = false
    }

    state.isStreaming = false
    abortController.value = null
  }
}

const handleSend = (question: string, user_files: any[]) => {
  checkPermission({
    group_ids: currentAgent.value.user_group_ids,
    onclick: async () => {
      const agent_id = currentAgent.value.agent_id
      if (!agent_id) return ElMessage.warning(window.$t('chat.no_available_agent'))
      if (!currentConv.value.conversation_id) {
        try {
          const conversation = await convStore.createConversation(agent_id, question)
          convStore.addConversation({ ...conversation, virtual_id: currentConv.value.virtual_id })
          convStore.setCurrentState(conversation.agent_id, conversation.conversation_id)
        } catch (err) {
          console.error('创建对话失败:', err)
          return
        }
      }
      await sendMessage(question, messageUtils.formatFiles(user_files))
    }
  })
}

const handleStop = () => {
  // 取消当前请求
  if (abortController.value) {
    abortController.value.abort()
    abortController.value = null
  }
  state.isStreaming = false
}

const handleRegenerate = async (message: Conversation.Message) => {
  await sendMessage(message.query, message.user_files)
}

const handleSuggestion = (suggestion: string) => {
  handleSend(suggestion, [])
}

onMounted(() => {
  loadList()
})

defineExpose({
  showUseCase: () => {
    state.showHelper = true
  },
  hideUseCase: () => {
    state.showHelper = false
  }
})
</script>

<style scoped></style>
