import { Suspense, lazy } from 'react'
import { Spin } from 'antd'
import { Summary } from './Summary'

const MarkdownViewer = lazy(() => import('@/components/FileViewer/MarkdownViewer'))

interface SummaryContentProps {
  /** 总结原文（兼容 JSON 旧格式和 Markdown 新格式） */
  content: string
  /** Markdown 容器宽度类名，默认 w-4/5 mx-auto */
  containerClass?: string
  // 背景色
  bgColor?: string
  // 内边框
  padding?: string
}

/**
 * 总结内容渲染器：JSON（旧）→ Summary 组件；Markdown（新）→ MarkdownViewer。
 *
 * 登录态（SummaryTabContent）与匿名态（分享落地页）共用，避免两端维护两份解析逻辑。
 * JSON 解析失败时降级为纯文本展示，不抛错。
 */
export function SummaryContent({ content, containerClass = 'w-4/5 mx-auto', bgColor= '#fff', padding = 'p-6' }: SummaryContentProps) {
  if (!content) return null
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content)
      return <Summary meetingMinutes={parsed} />
    } catch {
      return (
        <div className="py-4 text-base text-[#4F5052] leading-relaxed whitespace-pre-wrap break-words text-justify">
          {content}
        </div>
      )
    }
  }
  return (
    <div className="h-full overflow-hidden">
      <Suspense fallback={<Spin className="summary-markdown flex items-center justify-center h-full" />}>
        <MarkdownViewer content={content} containerClass={containerClass} bgColor={bgColor} padding={padding} />
      </Suspense>
    </div>
  )
}

export default SummaryContent