import { SvgIcon } from '@km/shared-components-react'

// Speaker styles (background + text color)
const SPEAKER_STYLES = [
  { bg: '#E3ECFF', color: '#2563EB' },  // Speaker 1: Blue
  { bg: '#E8F5E9', color: '#2E7D32' },  // Speaker 2: Green
  { bg: '#FFF3E0', color: '#E65100' },  // Speaker 3: Orange
  { bg: '#F3E5F5', color: '#7B1FA2' },  // Speaker 4: Purple
  { bg: '#E0F7FA', color: '#00838F' },  // Speaker 5: Cyan
  { bg: '#FBE9E7', color: '#D84315' },  // Speaker 6: Deep Orange
]

function formatTime(seconds: number) {
  if (!seconds || isNaN(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function getSpeakersBySentenceIds(sentenceIds: number[], insightSummary: Record<string, any>): { id: string; name: string }[] {
  const paragraphs = insightSummary.paragraphs || []
  const conversationalSummary = insightSummary.conversational_summary || []

  const speakerIds = new Set<string>()

  paragraphs.forEach((para: any) => {
    const words = para.Words || []
    const hasMatchingSentence = words.some((word: any) =>
      sentenceIds.includes(word.SentenceId)
    )
    if (hasMatchingSentence && para.SpeakerId) {
      speakerIds.add(para.SpeakerId)
    }
  })

  const speakers: { id: string; name: string }[] = []
  speakerIds.forEach(id => {
    const summary = conversationalSummary.find((s: any) => s.SpeakerId === id)
    speakers.push({
      id,
      name: summary?.SpeakerName || `发言人${id}`
    })
  })

  return speakers
}

interface InsightContentProps {
  insightSummary: Record<string, any>
}

export function InsightContent({ insightSummary }: InsightContentProps) {
  if (!insightSummary || Object.keys(insightSummary).length === 0) return null

  return (
    <div className="flex-col self-stretch py-4">
      {/* Keywords */}
      {insightSummary.keywords?.length > 0 && (
        <div className="flex-col self-stretch">
          <span className="self-start text-lg font-semibold text-[#1D1E1F]">关键词</span>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {insightSummary.keywords.map((item: string, index: number) => (
              <div key={index} className="flex justify-center items-center h-7 px-2 bg-[#E6EEFF] rounded">
                <span className="text-sm text-[#2563EB]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full Summary */}
      {insightSummary.paragraph_summary && (
        <div className="mt-10">
          <div className="text-lg font-semibold text-[#1D1E1F]">全文概要</div>
          <div className="text-base text-[#4F5052] mt-4">
            {insightSummary.paragraph_summary || '暂无内容'}
          </div>
        </div>
      )}

      {/* Chapters */}
      {insightSummary.auto_chapters?.length > 0 && (
        <div className="mt-10">
          <span className="text-lg font-semibold text-[#1D1E1F]">章节速览</span>
          <div className="mt-4 space-y-3">
            {insightSummary.auto_chapters.map((item: any, index: number) => (
              <div key={index} className="flex gap-3 relative">
                <div className="flex-col relative pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#1D1E1F]">{formatTime(item.Start / 1000)}</span>
                    <div className="w-[10px] h-[10px] bg-[#2563EB] rounded-full"></div>
                  </div>
                </div>
                {index < insightSummary.auto_chapters.length - 1 && (
                  <div className="absolute left-[50px] top-4 -bottom-2 border-r border-dashed border-[#2563EB]"></div>
                )}
                <div className="flex-col flex-1 self-start bg-[#F2F6FF] rounded-xl p-4">
                  <div className="self-start text-base text-[#1D1E1F]">{item.Headline}</div>
                  <div className="self-stretch text-sm text-[#999999] mt-2 whitespace-pre-wrap">
                    {item.Summary}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Speaker Summary */}
      {insightSummary.conversational_summary?.length > 0 && (
        <div className="mt-10">
          <span className="self-start text-lg font-semibold text-[#1D1E1F]">发言总结</span>
          <div className="mt-4 space-y-3">
            {insightSummary.conversational_summary.map((item: any, index: number) => {
              const speakerIndex = (parseInt(item.SpeakerId) - 1) % SPEAKER_STYLES.length
              const style = SPEAKER_STYLES[speakerIndex]
              return (
                <div key={index} className="flex bg-[#F2F6FF] py-4 pr-4 rounded-xl">
                  <div className="w-[100px] flex-none flex flex-col items-center justify-center">
                    <div
                      className="flex justify-center items-center w-6 h-6 rounded-full"
                      style={{ backgroundColor: style.bg }}
                    >
                      <span className="text-sm" style={{ color: style.color }}>{item.SpeakerName.slice(0, 1)}</span>
                    </div>
                    <span className="mt-2 text-sm text-[#4F5052]">{item.SpeakerName}</span>
                  </div>
                  <span className="flex-1 text-sm text-[#4F5052]">
                    {item.Summary}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Key Points Review */}
      {insightSummary.questions_answering_summary?.length > 0 && (
        <div className="flex-col self-stretch mt-10">
          <span className="self-start text-lg font-semibold text-[#1D1E1F]">要点回顾</span>
          <div className="mt-4 space-y-4">
            {insightSummary.questions_answering_summary.map((item: any, index: number) => {
              const speakers = getSpeakersBySentenceIds([...(item.SentenceIdsOfQuestion || []), ...(item.SentenceIdsOfAnswer || [])], insightSummary)
              return (
                <div key={index} className="flex bg-[#F2F6FF] rounded-xl p-4 gap-6">
                  <div className="flex justify-start items-center bg-[#E0EAFF] rounded-md h-7 px-2">
                    <span className="text-sm text-[#2563EB]">要点</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex-row items-center self-stretch">
                      <span className="text-base text-[#1D1E1F] whitespace-pre-wrap">{item.Question}</span>
                    </div>
                    <span className="text-sm text-[#999999] whitespace-pre-wrap mt-2">
                      {item.Answer}
                    </span>
                    {speakers.length > 0 && (
                      <div className="flex items-center mt-3">
                        {speakers.map((speaker: any, sIndex: number) => {
                          const speakerStyleIndex = (parseInt(speaker.id) - 1) % SPEAKER_STYLES.length
                          const speakerStyle = SPEAKER_STYLES[speakerStyleIndex]
                          return (
                            <div
                              key={sIndex}
                              className="flex justify-center items-center w-6 h-6 rounded-full"
                              style={{ backgroundColor: speakerStyle.bg }}
                            >
                              <span className="text-xs" style={{ color: speakerStyle.color }}>{speaker.name.slice(0, 1)}</span>
                            </div>
                          )
                        })}
                        <span className="text-xs text-[#999999] ml-1">
                          {speakers.map((s: any) => s.name).join('、')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* To-Do Items */}
      {insightSummary.actions?.length > 0 && (
        <div className="flex-col self-stretch mt-10">
          <span className="self-start text-lg font-semibold text-[#1D1E1F]">待办事项</span>
          <div className="mt-4 space-y-4">
            {insightSummary.actions.map((item: any, index: number) => (
              <div key={index} className="h-12 flex items-center gap-3 bg-[#F2F6FF] px-4 rounded-xl">
                <SvgIcon name="message-sent" size={16} color="#2563EB" />
                <span className="text-base text-[#1D1E1F] truncate">{item.Text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default InsightContent