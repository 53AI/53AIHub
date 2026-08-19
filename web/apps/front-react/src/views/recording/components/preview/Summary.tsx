/**
 * 会议纪要展示组件
 *
 * 展示结构（与 meeting.md Section 3/12 对齐）：
 * - 固定头部：主题、时间、参会人、关键实体、关键词
 * - 自由主体：按 sections 自由组织
 * - 结构化语义字段：决策、问题、风险、机会、行动、承诺、未解决问题、关键引语
 */
 interface SummaryProps {
  meetingMinutes: Record<string, any>
}

// ============= 辅助函数 =============

/** 格式化时长（秒 → 可读字符串） */
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}小时${m}分钟`
  return `${m}分钟`
}

/** 将时间戳格式化为可读时间 */
function formatTimestamp(ts: string | number): string {
  if (!ts) return ''
  // 如果是数字时间戳（秒）
  if (typeof ts === 'number') {
    const d = new Date(ts * 1000)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  // 如果是字符串时间戳
  if (typeof ts === 'string' && /^\d{10,13}$/.test(ts)) {
    const num = parseInt(ts, 10)
    const d = new Date(num > 1e12 ? num : num * 1000)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  // 直接返回字符串
  return ts
}

/** 状态标签颜色 */
const statusColorMap: Record<string, string> = {
  confirmed: 'text-[#16A34A]',
  proposed: 'text-[#D97706]',
  rejected: 'text-[#EF4444]',
  deferred: 'text-[#6B7280]',
  uncertain: 'text-[#9CA3AF]',
  open: 'text-[#D97706]',
  resolved: 'text-[#16A34A]',
  new: 'text-[#2563EB]',
  ongoing: 'text-[#D97706]',
  completed: 'text-[#16A34A]',
  unknown: 'text-[#9CA3AF]',
  unfulfilled: 'text-[#EF4444]',
  fulfilled: 'text-[#16A34A]',
  low: 'text-[#6B7280]',
  medium: 'text-[#D97706]',
  high: 'text-[#EF4444]',
  critical: 'text-[#991B1B]',
}

function getStatusColor(status?: string): string {
  return statusColorMap[status || ''] || 'text-[#6B7280]'
}

/** 状态标签显示名 */
const statusLabelMap: Record<string, string> = {
  confirmed: '已确认',
  proposed: '提议',
  rejected: '已拒绝',
  deferred: '延期',
  uncertain: '不确定',
  open: '未解决',
  resolved: '已解决',
  new: '新建',
  ongoing: '进行中',
  completed: '已完成',
  unknown: '未知',
  unfulfilled: '未兑现',
  fulfilled: '已兑现',
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

function getStatusLabel(status?: string): string {
  return statusLabelMap[status || ''] || status || ''
}

// ============= 子组件 =============

/** 会议基本信息头部（固定头部：主题、时间、参会人、关键实体、关键词） */
function MeetingHeader({ meeting, keywords, keyEntities }: { meeting: any; keywords?: string[]; keyEntities?: any[] }) {
  if (!meeting || Object.keys(meeting).length === 0) return null

  const hasTime = meeting.started_at || meeting.ended_at || !!meeting.duration_seconds
  const hasParticipants = Array.isArray(meeting.participants) && meeting.participants.length > 0
  const hasEntities = Array.isArray(keyEntities) && keyEntities.length > 0
  const keywordList = Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === 'string') : []
  const hasKeywords = keywordList.length > 0

  if (!meeting.title && !hasTime && !hasKeywords && !hasParticipants && !hasEntities) return null

  return (
    <>
      <div className="mb-6">
        {/* 会议主题 */}
        {meeting.title && (
          <h2 className="text-xl font-semibold text-[#1D1E1F] mb-3">{meeting.title}</h2>
        )}

        <ul className="space-y-1 text-base text-[#4F5052]">
          {/* 会议时间 */}
          {hasTime && (
            <li>
              <span className="font-medium text-[#1D1E1F]">会议时间</span>：
              {meeting.started_at && formatTimestamp(meeting.started_at)}
              {meeting.ended_at && <> — {formatTimestamp(meeting.ended_at)}</>}
              {meeting.duration_seconds && <>（{formatDuration(meeting.duration_seconds)}）</>}
            </li>
          )}

          {/* 参会人 */}
          {hasParticipants && (
            <li>
              <span className="font-medium text-[#1D1E1F]">参会人</span>：
              {meeting.participants.map((p: any) => p.name).filter(Boolean).join('、')}
            </li>
          )}

          {/* 关键实体 */}
          {hasEntities && (
            <li>
              <span className="font-medium text-[#1D1E1F]">关键实体</span>：
              {keyEntities.map((e) => e.mention).filter(Boolean).join('、')}
            </li>
          )}

          {/* 关键词 */}
          {hasKeywords && (
            <li>
              <span className="font-medium text-[#1D1E1F]">关键词</span>：
              {keywordList.join('、')}
            </li>
          )}
        </ul>
      </div>
      <div className="h-px bg-[#E5E6EB] mb-4" />
    </>
  )
}

/** 执行摘要 */
function ExecutiveSummary({ summary }: { summary: string }) {
  if (!summary) return null
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">摘要</h3>
      <p className="text-[#4F5052] leading-relaxed">{summary}</p>
    </div>
  )
}

/** 会议主体章节 */
function Sections({ sections }: { sections: any[] }) {
  if (!Array.isArray(sections) || sections.length === 0) return null
  return (
    <div className="mb-4 space-y-4">
      {sections.map((sec, i) => (
        <div key={i}>
          {sec.title && (
            <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">{sec.title}</h3>
          )}
          {sec.summary && (
            <p className="text-[#4F5052] leading-relaxed">{sec.summary}</p>
          )}
        </div>
      ))}
    </div>
  )
}

/** 决策列表 */
function Decisions({ decisions }: { decisions: any[] }) {
  if (!Array.isArray(decisions) || decisions.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">决策</h3>
      <ul className="space-y-2">
        {decisions.map((d, i) => (
          <li key={d.id || i} className="text-[#4F5052]">
            <span>{d.content}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 行动列表 */
function Actions({ actions }: { actions: any[] }) {
  if (!Array.isArray(actions) || actions.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">行动</h3>
      <ul className="space-y-3">
        {actions.map((a, i) => (
          <li key={a.id || i} className="text-[#4F5052]">
            <p>{a.content}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 议题/问题列表 */
function Issues({ issues }: { issues: any[] }) {
  if (!Array.isArray(issues) || issues.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">议题与问题</h3>
      <ul className="space-y-2">
        {issues.map((iss, i) => (
          <li key={iss.id || i} className="text-[#4F5052]">
            <span>{iss.content}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 风险列表 */
function Risks({ risks }: { risks: any[] }) {
  if (!Array.isArray(risks) || risks.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">风险</h3>
      <ul className="space-y-2">
        {risks.map((r, i) => (
          <li key={r.id || i} className="text-[#4F5052]">
            {r.title && <span className="font-medium">{r.title}</span>}
            {r.description && <p className="text-sm mt-0.5">{r.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 关键引语 */
function KeyQuotes({ quotes }: { quotes: any[] }) {
  if (!Array.isArray(quotes) || quotes.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">关键引语</h3>
      <div className="space-y-3">
        {quotes.map((q, i) => (
          <div key={i}>
            {q.quote && (
              <p className="font-medium text-[#1D1E1F] leading-relaxed">
                "{q.quote}"
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-secondary">
              {q.speaker && <span>{q.speaker}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 机会列表 */
function Opportunities({ opportunities }: { opportunities: any[] }) {
  if (!Array.isArray(opportunities) || opportunities.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">机会</h3>
      <ul className="space-y-2">
        {opportunities.map((o, i) => (
          <li key={o.id || i} className="text-[#4F5052]">
            {o.title && <span className="font-medium">{o.title}</span>}
            {o.description && <p className="text-sm mt-0.5">{o.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 承诺列表 */
function Commitments({ commitments }: { commitments: any[] }) {
  if (!Array.isArray(commitments) || commitments.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">承诺</h3>
      <ul className="space-y-2">
        {commitments.map((c, i) => (
          <li key={c.id || i} className="text-[#4F5052]">
            <p>{c.content}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 未解决问题 */
function OpenQuestions({ questions }: { questions: any[] }) {
  if (!Array.isArray(questions) || questions.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-[#1D1E1F] mb-2">未解决问题</h3>
      <ul className="space-y-2">
        {questions.map((q, i) => (
          <li key={q.id || i} className="text-[#4F5052]">
            <p>{q.content}</p>
            {q.why_important && (
              <p className="text-sm text-secondary mt-0.5">重要性: {q.why_important}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ============= 主组件 =============

export function Summary({ meetingMinutes }: SummaryProps) {
  if (!meetingMinutes || Object.keys(meetingMinutes).length === 0) {
    return null
  }

  const { meeting, keywords, executive_summary, sections, decisions, actions, issues, risks, key_entities, opportunities, commitments, key_quotes, open_questions } = meetingMinutes

  return (
    <div className="py-4">
      {/* 固定头部：主题、时间、参会人、关键实体、关键词 */}
      <MeetingHeader meeting={meeting} keywords={keywords} keyEntities={key_entities} />

      {/* 执行摘要 */}
      <ExecutiveSummary summary={executive_summary} />

      {/* 会议主体 */}
      <Sections sections={sections} />

      {/* 决策 */}
      <Decisions decisions={decisions} />

      {/* 行动 */}
      <Actions actions={actions} />

      {/* 议题/问题 */}
      <Issues issues={issues} />

      {/* 风险 */}
      <Risks risks={risks} />

      {/* 机会 */}
      <Opportunities opportunities={opportunities} />

      {/* 承诺 */}
      <Commitments commitments={commitments} />

      {/* 关键引语 */}
      <KeyQuotes quotes={key_quotes} />

      {/* 未解决问题 */}
      <OpenQuestions questions={open_questions} />
    </div>
  )
}

export default Summary