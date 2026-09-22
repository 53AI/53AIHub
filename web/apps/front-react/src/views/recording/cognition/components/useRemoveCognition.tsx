import { useCallback } from 'react'
import { Modal, message } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import recordingApi from '@/api/modules/recording'
import { useCognitionContext } from './CognitionContext'

/**
 * 认知「删除」= 置失效（expire），无硬删。详情弹窗与抽屉列表共用同一
 * 确认弹窗 + expireCognition + 刷新计数的流程，避免各写一份。
 *
 * @param item 至少需要 id / title 用于确认弹窗文案
 * @param options.onDone 失效成功后的额外收尾（如详情弹窗自动关闭）
 */
export function useRemoveCognition() {
  const { refreshAfterMutation } = useCognitionContext()
  return useCallback(
    (item: { id: string | number; title: string }, options?: { onDone?: () => void }) => {
      Modal.confirm({
        title: '删除认知',
        icon: <WarningOutlined />,
        content: `确定删除「${item.title}」这条认知吗？`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          await recordingApi.expireCognition(item.id)
          message.success('已删除')
          options?.onDone?.()
          await refreshAfterMutation()
        },
      })
    },
    [refreshAfterMutation],
  )
}