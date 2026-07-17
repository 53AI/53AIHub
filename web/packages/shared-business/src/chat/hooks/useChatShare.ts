import { useState, useMemo, useCallback } from 'react'
import { useChatAdapters } from '../i18n'

export const DISPLAY_MODE = {
  CHAT: 'chat',
  SHARE: 'share'
} as const

interface ShareState {
  displayMode: string
  selectMessageIds: any[]
  selectAll: boolean
}

/**
 * 聊天分享 Hook
 *
 * 需要通过 ChatConfigProvider 注入 share 适配器：
 * ```tsx
 * <ChatConfigProvider adapters={{ share: { api, context } }}>
 *   <YourComponent />
 * </ChatConfigProvider>
 * ```
 */
export function useChatShare() {
  const adapters = useChatAdapters()

  if (!adapters?.share) {
    throw new Error(
      'useChatShare requires share adapter. ' +
      'Please provide it in ChatConfigProvider: adapters={{ share: { api, context } }}'
    )
  }

  const { api, context } = adapters.share

  const [state, setState] = useState<ShareState>({
    displayMode: DISPLAY_MODE.CHAT,
    selectMessageIds: [],
    selectAll: false
  })

  const isShareMode = useMemo(() => state.displayMode === DISPLAY_MODE.SHARE, [state.displayMode])

  const handleSelectAll = useCallback((messageList: any[]) => {
    if (isShareMode) {
      setState(prev => ({
        ...prev,
        selectMessageIds: prev.selectAll ? [] : messageList.map((item) => item.id),
        selectAll: !prev.selectAll
      }))
    }
  }, [isShareMode])

  const handleOpenShare = useCallback((message?: any) => {
    setState(prev => {
      const newSelectAll = false
      const newSelectMessageIds: any[] = []

      let newDisplayMode = prev.displayMode
      if (message) {
        newDisplayMode = DISPLAY_MODE.SHARE
      } else {
        newDisplayMode = prev.displayMode === DISPLAY_MODE.SHARE ? DISPLAY_MODE.CHAT : DISPLAY_MODE.SHARE
      }

      return {
        ...prev,
        displayMode: newDisplayMode,
        selectAll: newSelectAll,
        selectMessageIds: newSelectMessageIds
      }
    })
  }, [])

  const handleSelectMessage = useCallback((msg: any) => {
    if (state.displayMode === DISPLAY_MODE.SHARE) {
      setState(prev => {
        if (prev.selectMessageIds.includes(msg.id)) {
          return {
            ...prev,
            selectMessageIds: prev.selectMessageIds.filter((id) => id !== msg.id),
            selectAll: false
          }
        } else {
          return {
            ...prev,
            selectMessageIds: [...prev.selectMessageIds, msg.id]
          }
        }
      })
    }
  }, [state.displayMode])

  const handleCreateShare = useCallback(async (
    conversation_id: string | number,
    from: string,
    libraryName?: string,
    spaceName?: string
  ) => {
    const res = await api.create({
      message_ids: state.selectMessageIds,
      conversation_id: conversation_id as any,
      select_all: state.selectAll
    })

    let link = context.buildUrl(`/share/chat?share_id=${res.share_id}&from=${from}`)
    const info: { name?: string; space?: string } = {}
    if (libraryName) info.name = libraryName
    if (spaceName) info.space = spaceName

    // 如果有 encodeShortId 方法，使用它
    if (context.encodeShortId) {
      const infoId = await context.encodeShortId(JSON.stringify(info))
      link += `&info=${infoId}`
    }

    await context.copyToClipboard(link)
    context.showSuccess(context.t('chat.completion_share_link'))

    setState(prev => ({
      ...prev,
      displayMode: DISPLAY_MODE.CHAT
    }))
  }, [api, context, state.selectMessageIds, state.selectAll])

  return {
    state,
    isShareMode,
    handleSelectAll,
    handleOpenShare,
    handleSelectMessage,
    handleCreateShare
  }
}

export default useChatShare
