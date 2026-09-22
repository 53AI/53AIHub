import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Collapse, Spin, Tag } from 'antd'
import recordingApi from '@/api/modules/recording'
import type { RecordingDecisionContextPackage } from '@/api/modules/recording/types'
import { cognitionTypeLabel } from '../../cognition/utils'

const DECISION_CONTEXT_REASON_LABELS: Record<string, string> = {
  enterprise_knowledge_disabled: '企业知识源已关闭',
  enterprise_knowledge_scope_missing: '未配置授权知识库范围',
  enterprise_knowledge_scope_invalid: '知识库范围配置无效',
  enterprise_knowledge_query_missing: '当前没有可用于企业知识检索的问题',
  enterprise_knowledge_no_hit: '授权知识库未检索到相关内容',
  enterprise_knowledge_search_failed: '企业知识检索失败，已降级为三源上下文',
  enterprise_knowledge_timeout: '企业知识检索超时，已降级为三源上下文',
  enterprise_knowledge_adapt_failed: '企业知识结果适配失败，已降级为三源上下文',
  enterprise_knowledge_permission_filtered: '部分企业知识因权限被排除',
  decision_runtime_compile_failed: '四源上下文编译失败，已降级为兼容上下文'
}

export function formatDecisionContextReason(reason: string): string {
  const normalized = reason.trim()
  if (!normalized) return normalized
  const separator = normalized.indexOf(':')
  const code = separator === -1 ? normalized : normalized.slice(0, separator)
  const suffix = separator === -1 ? '' : normalized.slice(separator + 1)
  const label = DECISION_CONTEXT_REASON_LABELS[code]
  if (!label) return normalized
  if (!suffix) return label
  const suffixLabel = code === 'enterprise_knowledge_permission_filtered' ? '引用' : '范围'
  return `${label}（${suffixLabel} ${suffix}）`
}

interface DecisionContextSourcesPanelProps {
  fileId: string
  refreshKey?: string
  /** 嵌入现有侧栏卡片时只渲染内容，不再创建洞察正文顶部卡片。 */
  embedded?: boolean
  /** Context Builder 不可用时保留原有关联记忆展示。 */
  fallback?: ReactNode
}

/**
 * 洞察页的轻量可解释入口：展示 Context Builder 实际组装了哪些来源，
 * 让用户知道“老板认知”不是隐藏 prompt，也能看见被排除的内容。
 */
export function DecisionContextSourcesPanel({
  fileId,
  refreshKey = '',
  embedded = false,
  fallback
}: DecisionContextSourcesPanelProps) {
  const [context, setContext] = useState<RecordingDecisionContextPackage | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!fileId) return
    setLoading(true)
    try {
      setContext(await recordingApi.getDecisionContext(fileId))
    } catch {
      setContext(null)
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const cognitionCount =
    (context?.cognitions.core.length || 0) + (context?.cognitions.situational.length || 0)
  const conflicts = context?.cognitions.conflicts || []
  const memoryItems = context?.business_memory.items || []
  const currentClaims = context?.current_context.claims || []
  const knowledgeItems = context?.runtime_context?.enterprise_knowledge || []
  const panels = useMemo(() => {
    if (!context) return []
    const panelStyle = {
      backgroundColor: '#F9FAFC',
      borderRadius: 12,
      marginBottom: 12
    }
    return [
      {
        key: 'cognition',
        label: <span className="text-sm text-[#1D1E1F]">已确认认知（{cognitionCount}）</span>,
        children:
          cognitionCount === 0 ? (
            <div className="text-xs text-[#9AA4B2]">本次没有适用的已确认认知。</div>
          ) : (
            <div className="space-y-2">
              {[...context.cognitions.core, ...context.cognitions.situational].map((item) => (
                <div key={String(item.id)} className="rounded-lg bg-[#F7F9FC] py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 break-words text-xs font-medium text-[#334A68]">
                      {item.title}
                    </span>
                    <Tag
                      bordered={false}
                      className="!m-0 !rounded !bg-white !px-2 py-0.5 !text-xs !text-[#8290A3]"
                    >
                      {item.layer === 'core' ? '核心认知' : '领域认知'}
                    </Tag>
                    {item.cognition_type && cognitionTypeLabel(item.cognition_type)}
                  </div>
                  <div className="mt-1 break-words text-xs leading-5 text-[#718096]">
                    {item.statement}
                  </div>
                </div>
              ))}
            </div>
          ),
        style: panelStyle
      },
      {
        key: 'conflicts',
        label: <span className="text-sm text-[#1D1E1F]">认知冲突（{conflicts.length}）</span>,
        children:
          conflicts.length === 0 ? (
            <div className="text-xs text-[#9AA4B2]">本次没有匹配到已标记的认知冲突。</div>
          ) : (
            <div className="space-y-2">
              {conflicts.map((item) => (
                <div
                  key={String(item.id)}
                  className="rounded-lg border border-[#F5E3B6] bg-[#FFFBEB] px-3 py-2"
                >
                  <div className="break-words text-sm font-medium text-[#8A5A00]">{item.title}</div>
                  <div className="mt-1 break-words text-xs leading-5 text-[#8B6B2E]">
                    {item.statement}
                  </div>
                </div>
              ))}
            </div>
          ),
        style: panelStyle
      },
      {
        key: 'memory',
        label: <span className="text-sm text-[#1D1E1F]">相关业务记忆（{memoryItems.length}）</span>,
        children:
          memoryItems.length === 0 ? (
            <div className="text-xs text-[#9AA4B2]">没有召回到可验证的历史业务记忆。</div>
          ) : (
            <div className="space-y-2">
              {memoryItems.slice(0, 8).map((item) => (
                <div key={String(item.memory_id)} className="rounded-lg bg-[#F7F9FC] py-2">
                  <div className="min-w-0 flex items-center gap-2 text-xs text-[#95A1B1]">
                    <span className="break-words">{item.kind}</span>
                    {item.evidence_available && (
                      <span className="flex-none text-[#5D9A7A]">有证据</span>
                    )}
                  </div>
                  <div className="mt-1 break-words text-xs leading-5 text-[#66768C]">
                    {item.content}
                  </div>
                </div>
              ))}
            </div>
          ),
        style: panelStyle
      },
      {
        key: 'current',
        label: (
          <span className="text-sm text-[#1D1E1F]">当前会议事实（{currentClaims.length}）</span>
        ),
        children:
          currentClaims.length === 0 ? (
            <div className="text-sm text-[#6B7280]">当前纪要没有可展示的结构化事实。</div>
          ) : (
            <div className="space-y-1">
              {currentClaims.slice(0, 8).map((claim) => (
                <div
                  key={claim.temp_id}
                  className="min-w-0 flex gap-2 text-sm leading-5 text-[#6B7280]"
                >
                  <span className="flex-none text-[#B3BFCE]">·</span>
                  <span className="min-w-0 flex-1 break-words">{claim.content}</span>
                </div>
              ))}
            </div>
          ),
        style: panelStyle
      }
    ]
  }, [context, cognitionCount, conflicts, currentClaims, memoryItems, knowledgeItems])

  if (!context) {
    if (loading)
      return (
        <div className="flex items-center gap-2 py-3 text-sm text-[#8A94A6]">
          <Spin size="small" />
          正在组装洞察上下文
        </div>
      )
    if (fallback) return <>{fallback}</>
    return null
  }

  if (embedded) {
    return (
      <div className="space-y-2 mt-4">
        <Collapse ghost size="small" bordered={false} items={panels} expandIconPlacement="end" />
      </div>
    )
  }

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-[#E6EBF3] bg-white">
      <Collapse
        ghost
        size="small"
        items={panels}
        className="!border-t !border-[#F0F2F6] !rounded-none !bg-[#FCFDFE]"
      />
    </section>
  )
}

export default DecisionContextSourcesPanel
