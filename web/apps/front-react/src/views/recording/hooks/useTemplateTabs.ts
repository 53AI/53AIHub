import { useRef, useState, useMemo, useEffect } from 'react'
import type { TemplateListModalRef } from '@km/shared-business/recording-template'
import type { RecordingFileSummary } from '@/api/modules/recording/types'

export interface AudioTabItem {
  key: string
  label: string
}

/**
 * 安心录音频预览的模板 tab 扩展状态
 * 模板 tab 全部来自后端 fileSummaries（sum-*），不再保留本地 tpl-* 路径
 * —— 点击"新增 AI 模板"会触发后端 createFileSummary，接口返回后自然生成 sum-* tab
 */
export function useTemplateTabs(
  fileSummaries?: RecordingFileSummary[],
  fileId?: string,
  /** 当前文件总结列表是否还在加载（用于切文件时保留旧 tab 避免闪烁） */
  isLoading?: boolean,
) {
  const [activeTab, setActiveTab] = useState('insight')
  const [removedSummaryIds, setRemovedSummaryIds] = useState<Set<string>>(new Set())
  const templateListModalRef = useRef<TemplateListModalRef>(null)
  // 切文件瞬间 fileSummaries 被清空，保留旧 summaryTabs 防止 tab 区域从有到无的闪烁
  const prevSummaryTabsRef = useRef<AudioTabItem[]>([])

  // 切换文件时重置本地"已删除"标记（与具体文件绑定，不能跨文件共享）
  useEffect(() => {
    setRemovedSummaryIds(new Set())
    setActiveTab('insight')
  }, [fileId])

  const openTemplateList = () => {
    templateListModalRef.current?.open()
  }

  // 移除总结 tab（仅本地隐藏，不重新调接口）
  const removeSummaryTab = (summaryId: string) => {
    setRemovedSummaryIds((prev) => new Set(prev).add(summaryId))
  }

  // 总结列表中的 tab（排除 template_id=0 的系统纪要 + 已本地删除的）
  const summaryTabs: AudioTabItem[] = useMemo(() => {
    const newTabs = (fileSummaries || [])
      .filter((s) => String(s.template_id) !== '0' && !removedSummaryIds.has(s.id))
      .map((s) => ({
        key: `sum-${s.id}`,
        label: s.template_name || '总结',
      }))
    // 切文件加载中时（fileSummaries 已被清空但新数据未到）保留旧 tabs，避免 tab 区域闪烁
    if (isLoading && newTabs.length === 0 && prevSummaryTabsRef.current.length > 0) {
      return prevSummaryTabsRef.current
    }
    prevSummaryTabsRef.current = newTabs
    return newTabs
  }, [fileSummaries, removedSummaryIds, isLoading])

  const tabItems: AudioTabItem[] = [
    { key: 'insight', label: '洞察' },
    { key: 'summary', label: '纪要' },
    { key: 'transcript', label: '转写' },
  ]

  return {
    activeTab,
    setActiveTab,
    tabItems,
    templateTabItems: summaryTabs,
    templateListModalRef,
    openTemplateList,
    removeSummaryTab,
    summaryTabs,
  }
}
