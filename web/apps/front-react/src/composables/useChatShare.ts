import { useState, useMemo, useCallback } from 'react'
import { sharesApi } from '@/api/modules/share'
import { copyToClip, encodeShortId } from '@km/shared-utils'
import { message } from 'antd'
import { t } from '@/locales'
import { buildUrl } from '@/utils/router'

export const DISPLAY_MODE = {
  CHAT: 'chat',
  SHARE: 'share'
}

interface ShareState {
  displayMode: string
  selectMessageIds: any[]
  selectAll: boolean
}

export function useChatShare() {
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
    const res = await sharesApi.create({
      message_ids: state.selectMessageIds,
      conversation_id: conversation_id as any,
      select_all: state.selectAll
    })

    let link = buildUrl(`/share/chat?share_id=${res.share_id}&from=${from}`)
    const info: { name?: string, space?: string } = {}
    if (libraryName) info.name = libraryName
    if (spaceName) info.space = spaceName
    const infoId = await encodeShortId(JSON.stringify(info))
    link += `&info=${infoId}`

    await copyToClip(link)
    message.success(t('chat.completion_share_link'))

    setState(prev => ({
      ...prev,
      displayMode: DISPLAY_MODE.CHAT
    }))
  }, [state.selectMessageIds, state.selectAll])

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
