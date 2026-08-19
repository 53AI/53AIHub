import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Spin, Tooltip, message } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import recordingApi from '@/api/modules/recording'
import type { InsightBackground } from '@/api/modules/recording/types'
import {
  BackgroundCard,
  EMPTY_INSIGHT_BACKGROUND,
  INSIGHT_BACKGROUND_CARDS,
} from './InsightBackgroundWorkshop'

interface InsightRegeneratePanelProps {
  fileId?: string
  /** 触发洞察重新生成后回调：用于父级关闭面板 / 刷新列表 / 轮询新结果 */
  onRegenerateStarted?: () => void
  /**
   * 任意解析阶段是否还在跑（pending/parsing/processing）。由父级透传；
   * true 时禁用提交按钮并换文案提示，避免用户在生成未完成时重复提交。
   * （主 Tab 的「开始生成」态视为 actionable pending，会让父级传 false 进来。）
   */
  parseStatusRunning?: boolean
}

/** 当前展开的背景卡片 key。手风琴：一次只展开一张；初始默认展开第一张。 */
type InsightBackgroundCardKey = (typeof INSIGHT_BACKGROUND_CARDS)[number]['key']

/**
 * 文档助手侧边栏 → 「参谋洞察」入口对应的内联面板。
 *
 * 与 InsightBackgroundWorkshop 的区别：仅提供背景卡片编辑 + 确认重新生成，
 * 不包含对话区（消息列表 / 输入框 / 快速提示），用于快速校准背景并重生成洞察。
 *
 * 由 AssistantIndex 渲染到「文档助手」右侧主区域，与 Chat/Map/CustomApp 同级；
 * 无 Modal 包装，符合用户「也跟其他一样」的诉求。
 */
export function InsightRegeneratePanel({
  fileId,
  onRegenerateStarted,
  parseStatusRunning = false,
}: InsightRegeneratePanelProps) {
  const [background, setBackground] = useState<InsightBackground>(EMPTY_INSIGHT_BACKGROUND)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  /** 提交成功后到新一轮洞察出炉前的「已提交」状态：禁用按钮、换文案，
   *  避免用户以为没生效而重复点击；主视图的轮询完成后用户可关闭面板或继续微调再次提交。 */
  const [submitted, setSubmitted] = useState(false)
  /** 手风琴：当前展开的背景卡片 key；默认展开第一张，点击其他卡片时自动收起旧的。
   *  null 表示全部收起。 */
  const [expandedKey, setExpandedKey] = useState<InsightBackgroundCardKey | null>(
    INSIGHT_BACKGROUND_CARDS[0].key,
  )

  const loadBackground = useCallback(async () => {
    if (!fileId) return
    setLoading(true)
    try {
      const result = await recordingApi.getInsightBackground(fileId)
      setBackground({ ...EMPTY_INSIGHT_BACKGROUND, ...result })
    } catch (error: any) {
      message.error(error?.message || '读取洞察背景失败')
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => {
    loadBackground()
    // 切换文件时重置 submitted 状态，新一轮洞察可能尚未开始
    setSubmitted(false)
  }, [loadBackground])

  // 生成完成（parseStatusRunning 从 true → false）时清除 submitted，让按钮恢复可点。
  // 用 prev ref 跟踪上一次值，避免以下误清场景：
  //   - 提交瞬间：setSubmitted(true) 与 startInsightRegeneration 触发的 parseStatusRunning=true
  //     在同一渲染批次里提交，useEffect 看到 current=true 不会误清。
  //   - 初始挂载：parseStatusRunning=true（!initialLoadDone），等首屏加载完成后变 false，
  //     这时 cleared 是 no-op，因为 submitted 本来就是 false。
  const prevInsightGeneratingRef = useRef(parseStatusRunning)
  useEffect(() => {
    if (prevInsightGeneratingRef.current && !parseStatusRunning) {
      setSubmitted(false)
    }
    prevInsightGeneratingRef.current = parseStatusRunning
  }, [parseStatusRunning])

  const updateBackground = (key: Exclude<keyof InsightBackground, 'conversation'>, value: string) => {
    setBackground((current) => ({ ...current, [key]: value }))
    // 用户修改背景后，允许再次提交
    if (submitted) setSubmitted(false)
  }

  const confirmRegenerate = async () => {
    if (!fileId || regenerating || loading || submitted || parseStatusRunning) return
    setRegenerating(true)
    try {
      await recordingApi.regenerateInsights(fileId, {
        background,
        conversation: [],
      })
      message.success('已确认背景，正在重新生成洞察')
      setSubmitted(true)
      onRegenerateStarted?.()
    } catch (error: any) {
      message.error(error?.message || '重新生成洞察失败，请稍后重试')
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fff]">
      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center"><Spin /></div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-3">
            {INSIGHT_BACKGROUND_CARDS.map((card) => (
              <BackgroundCard
                key={card.key}
                title={card.title}
                iconName={card.iconName}
                iconColor={card.iconColor}
                description={card.description}
                readOnly={card.readOnly}
                kind={card.kind}
                value={background[card.key] || ''}
                onChange={(value) => updateBackground(card.key, value)}
                collapsible={card.collapsible}
                expanded={expandedKey === card.key}
                onExpandedChange={(open) => setExpandedKey(open ? card.key : null)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex shrink-0 flex-col bg-white px-3 pb-5 pt-2">
        <Tooltip
          title={parseStatusRunning ? '洞察报告正在生成中，请等待完成后重新生成' : ''}
          placement="top"
        >
          <Button
            type="primary"
            loading={regenerating}
            size="large"
            disabled={loading || !fileId || submitted || parseStatusRunning}
            onClick={confirmRegenerate}
          >
            <SvgIcon name="star-four" />
            {submitted
              ? '已提交，正在生成洞察…'
              : parseStatusRunning
                ? '洞察正在生成中，请等待完成后重新生成'
                : '背景信息已对齐，重新生成洞察报告'}
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
