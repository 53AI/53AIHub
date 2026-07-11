import { useState, useCallback } from 'react'
import { feedbackApi } from '@/api/modules/feedback/index'
import { useUserStore } from '@/stores/modules/user'

interface FeedbackConfig {
  satisfied: string[]
  unsatisfied: string[]
}

interface FeedbackParams {
  feedbackId: number | null
  feedbackVisible: boolean
  feedbackTypeOptions: Map<string, boolean> | null
  submitBtnDisabled: boolean
  feedbackSuccessful: boolean
  description?: string
  feedback_type?: string
}

/**
 * 聊天反馈处理 Hook
 */
export function useChatFeedback() {
  const userStore = useUserStore()

  const [feedbackConfig, setFeedbackConfig] = useState<FeedbackConfig>({
    satisfied: [],
    unsatisfied: []
  })

  // 加载反馈配置
  const loadFeedbackConfig = useCallback(async (type?: string): Promise<FeedbackConfig | null> => {
    try {
      const configData = await feedbackApi.getConfig({
        eid: userStore.info.eid,
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
  }, [userStore.info.eid])

  // 初始化反馈参数
  const initFeedbackParams = useCallback((): FeedbackParams => ({
    feedbackId: null,
    feedbackVisible: false,
    feedbackTypeOptions: null,
    submitBtnDisabled: true,
    feedbackSuccessful: false
  }), [])

  // 加载消息反馈
  const loadMessageFeedback = useCallback(async (messageId: number): Promise<FeedbackParams> => {
    try {
      const feedbackData = await feedbackApi.getFeedback({ message_id: messageId })
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
  }, [initFeedbackParams])

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
      feedbackData = await feedbackApi.updateFeedback(message.feedbackId, params)
    } else {
      feedbackData = await feedbackApi.createFeedback(params)
    }

    if (feedbackData) {
      message.feedbackId = feedbackData.id
    }
    return feedbackData
  }, [])

  // 删除反馈
  const deleteFeedback = useCallback(async (message: any) => {
    if (!message.feedbackId) return
    await feedbackApi.deleteFeedback(message.feedbackId)
    message.feedbackId = null
  }, [])

  // 点击反馈按钮 - 返回更新后的消息对象
  // 注意：React 版本不直接修改 messageList，调用方需要负责关闭其他消息的反馈面板
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

  // 提交反馈 - 参考Vue版本实现
  // 注意：在React中需要返回新对象，调用方需要使用返回的对象更新状态
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
