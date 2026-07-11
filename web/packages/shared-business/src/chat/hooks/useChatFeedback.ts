import { useState, useCallback } from 'react'
import type { FeedbackState } from '../types'
import { useChatAdapters } from '../i18n'

interface FeedbackConfig {
  satisfied: string[]
  unsatisfied: string[]
}

/**
 * 聊天反馈处理 Hook
 *
 * 需要通过 ChatConfigProvider 注入 feedback 适配器：
 * ```tsx
 * <ChatConfigProvider adapters={{ feedback: { api, context } }}>
 *   <YourComponent />
 * </ChatConfigProvider>
 * ```
 */
export function useChatFeedback() {
  const adapters = useChatAdapters()

  if (!adapters?.feedback) {
    throw new Error(
      'useChatFeedback requires feedback adapter. ' +
      'Please provide it in ChatConfigProvider: adapters={{ feedback: { api, context } }}'
    )
  }

  const { api, context } = adapters.feedback

  const [feedbackConfig, setFeedbackConfig] = useState<FeedbackConfig>({
    satisfied: [],
    unsatisfied: []
  })

  // 加载反馈配置
  const loadFeedbackConfig = useCallback(async (type?: string): Promise<FeedbackConfig | null> => {
    try {
      const configData = await api.getConfig({
        eid: context.getEid(),
        type: type
      })
      const configList = JSON.parse(configData.value)
      if (configList) {
        const types: Array<'satisfied' | 'unsatisfied'> = ['satisfied', 'unsatisfied']
        for (const t of types) {
          if (configList[t] && !configList[t].includes('其它')) {
            configList[t].push('其它')
          }
        }
        setFeedbackConfig(configList)
        return configList
      }
      return null
    } catch (err) {
      console.error('加载反馈配置失败:', err)
      return null
    }
  }, [api, context])

  // 初始化反馈参数
  const initFeedbackParams = useCallback((): FeedbackState => ({
    feedbackId: null,
    feedbackVisible: false,
    feedbackTypeOptions: null,
    submitBtnDisabled: true,
    feedbackSuccessful: false
  }), [])

  // 加载消息反馈
  const loadMessageFeedback = useCallback(async (messageId: string | number): Promise<FeedbackState> => {
    try {
      const feedbackData = await api.getFeedback({ message_id: messageId })
      return {
        ...feedbackData,
        feedbackId: feedbackData.id,
        feedbackVisible: false,
        feedbackTypeOptions: null,
        submitBtnDisabled: true,
        feedbackSuccessful: false
      }
    } catch (err) {
      return initFeedbackParams()
    }
  }, [api, initFeedbackParams])

  // 创建/更新反馈
  const setFeedback = useCallback(async (message: any) => {
    const type = message.feedbackTypeOptions
      ? [...message.feedbackTypeOptions.entries()].reduce((res: string[], [key, value]) => {
          if (value) res.push(key)
          return res
        }, [] as string[])
      : []

    const params = {
      description: message.description,
      feedback_type: message.feedback_type,
      message_id: message.id,
      question: message.original_question || message.question,
      reason: type.join('、')
    }

    let feedbackData = null
    if (message.feedbackId) {
      feedbackData = await api.updateFeedback(message.feedbackId, params)
    } else {
      feedbackData = await api.createFeedback(params)
    }

    if (feedbackData) {
      message.feedbackId = feedbackData.id
    }
    return feedbackData
  }, [api])

  // 删除反馈
  const deleteFeedback = useCallback(async (message: any) => {
    if (!message.feedbackId) return
    await api.deleteFeedback(message.feedbackId)
    message.feedbackId = null
  }, [api])

  // 点击反馈按钮 - 返回更新后的消息对象
  const handleClickFeedbackBtn = useCallback(async (
    message: any,
    type: 'satisfied' | 'unsatisfied'
  ): Promise<any> => {
    // 确保反馈配置已加载
    let configList = feedbackConfig[type]
    if (!configList || !Array.isArray(configList) || configList.length === 0) {
      const reloadedConfig = await loadFeedbackConfig()
      // 优先使用重载后的配置，否则使用默认配置
      configList = reloadedConfig?.[type] || (type === 'satisfied'
        ? ['准确', '有帮助', '其它']
        : ['不准确', '不相关', '其它'])
    }

    const feedbackTypeOptions = new Map<string, boolean>()
    configList.forEach((item: string) => {
      if (!feedbackTypeOptions.has(item)) {
        feedbackTypeOptions.set(item, false)
      }
    })

    const newFeedbackType = message.feedback_type === type ? '' : type
    const newFeedbackVisible = newFeedbackType === type

    // 创建更新后的消息对象
    const updatedMessage = {
      ...message,
      feedbackTypeOptions,
      feedback_type: newFeedbackType,
      feedbackVisible: newFeedbackVisible,
      submitBtnDisabled: true
    }

    if (newFeedbackType) {
      await setFeedback(updatedMessage)
    } else {
      await deleteFeedback(updatedMessage)
    }

    return updatedMessage
  }, [feedbackConfig, loadFeedbackConfig, setFeedback, deleteFeedback])

  // 切换反馈类型 - 返回更新后的消息对象
  const handleToggleFeedbackBtn = useCallback((message: any, type: string): any => {
    const newOptions = new Map(message.feedbackTypeOptions)
    newOptions.set(type, !newOptions.get(type))

    return {
      ...message,
      feedbackTypeOptions: newOptions,
      submitBtnDisabled: ![...newOptions.values()].includes(true)
    }
  }, [])

  // 关闭反馈面板 - 返回更新后的消息对象
  const handleCloseFeedback = useCallback((message: any): any => {
    return {
      ...message,
      description: '',
      feedbackVisible: false
    }
  }, [])

  // 重置反馈成功状态
  const resetFeedbackSuccess = useCallback((message: any): any => {
    return {
      ...message,
      feedbackSuccessful: false
    }
  }, [])

  // 提交反馈
  const handleSubmitFeedback = useCallback(async (message: any): Promise<any> => {
    await setFeedback(message)
    // 创建新对象，设置成功状态
    const updatedMessage = {
      ...message,
      feedbackVisible: false,
      feedbackSuccessful: true
    }
    return updatedMessage
  }, [setFeedback])

  // 重置反馈成功状态 - 用于setTimeout回调
  const resetFeedbackSuccessState = useCallback((message: any): any => {
    return {
      ...message,
      feedbackSuccessful: false
    }
  }, [])

  return {
    feedbackConfig,
    loadFeedbackConfig,
    initFeedbackParams,
    loadMessageFeedback,
    setFeedback,
    deleteFeedback,
    handleClickFeedbackBtn,
    handleToggleFeedbackBtn,
    handleCloseFeedback,
    handleSubmitFeedback,
    resetFeedbackSuccess,
    resetFeedbackSuccessState
  }
}

export default useChatFeedback
