import { useState, useRef, useEffect, useCallback } from 'react';
import { Tabs, Slider, Empty, Popover } from 'antd';
import { Dropdown } from '@km/shared-components-react';
import { ReloadOutlined } from "@ant-design/icons";
import type { MenuProps } from 'antd';
import { FileItem } from '@/api/modules/files/types';
import fileBodiesApi from '@/api/modules/file-bodies';
import { SvgIcon } from '@km/shared-components-react';
import { usePoll } from '@/hooks/usePoll';
import './audio.css';

// Speaker styles (background + text color)
const SPEAKER_STYLES = [
  { bg: '#E3ECFF', color: '#2563EB' },  // Speaker 1: Blue
  { bg: '#E8F5E9', color: '#2E7D32' },  // Speaker 2: Green
  { bg: '#FFF3E0', color: '#E65100' },  // Speaker 3: Orange
  { bg: '#F3E5F5', color: '#7B1FA2' },  // Speaker 4: Purple
  { bg: '#E0F7FA', color: '#00838F' },  // Speaker 5: Cyan
  { bg: '#FBE9E7', color: '#D84315' },  // Speaker 6: Deep Orange
]

interface TranscriptItem {
  id: string
  time: string
  seconds: number
  speaker: string
  speakerNum: number
  content: string
}

interface AudioViewProps {
  currentFile: FileItem
}

// Parse time string to seconds
function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':').map(Number)
  if (parts.length === 2) {
    const [m, s] = parts
    return (m || 0) * 60 + (s || 0)
  }
  if (parts.length === 3) {
    const [h, m, s] = parts
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
  }
  return 0
}

// Parse transcript content from markdown
function parseTranscriptContent(content: string, conversationalSummary: any[] = []): TranscriptItem[] {
  if (!content?.trim()) return []
  const items: TranscriptItem[] = []
  const blocks = content.split(/##\s*(\d+)\s*\n/)

  for (let i = 1; i < blocks.length; i += 2) {
    const speakerNum = blocks[i]?.trim() || '1'
    const timeAndContent = blocks[i + 1]
    if (!timeAndContent) continue

    const lines = timeAndContent.split('\n').map(l => l.trim()).filter(Boolean)
    const quoteLine = lines.find(l => l.startsWith('>'))
    const startEnd = quoteLine?.match(/>\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)/)
    const startTimeStr = startEnd?.[1] ?? ''
    const seconds = timeStringToSeconds(startTimeStr)
    const contentLines = lines.filter(l => !l.startsWith('>'))
    const text = contentLines.join('\n').trim()
    const num = parseInt(speakerNum, 10) || 1
    // Get speaker name from conversational_summary
    const speakerInfo = conversationalSummary.find((s: any) => s.SpeakerId === speakerNum)
    const speakerName = speakerInfo?.SpeakerName || `发言人${speakerNum}`

    items.push({
      id: `transcript-${items.length + 1}`,
      time: startTimeStr || '00:00',
      seconds,
      speaker: speakerName,
      speakerNum: num,
      content: text
    })
  }
  return items
}

export function AudioView({ currentFile }: AudioViewProps) {
  const audioRef = useRef<HTMLAudioElement>(null)

  // State
  const [activeTab, setActiveTab] = useState('insight')
  const [currentTranscriptId, setCurrentTranscriptId] = useState('')
  const [transcriptList, setTranscriptList] = useState<TranscriptItem[]>([])

  // Audio state
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(80)
  const [playbackRate, setPlaybackRate] = useState(1.0)

  // Insight summary from file
  const insightSummary = (() => {
    try {
      return JSON.parse(currentFile?.insight_summary || '{}')
    } catch {
      return {}
    }
  })()

  // Get speakers by sentence IDs
  const getSpeakersBySentenceIds = useCallback((sentenceIds: number[]): { id: string; name: string }[] => {
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
  }, [insightSummary])

  // Format time
  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '00:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  // Volume icon
  const volumeIcon = volume === 0 ? 'volume-mute' : volume < 50 ? 'volume-notice' : 'volume-notice'

  // Load transcript
  const loadTranscript = useCallback(() => {
    const fileId = currentFile?.id
    if (!fileId) {
      setTranscriptList([])
      return
    }

    fileBodiesApi.find(fileId)
      .then((res) => {
        setTranscriptList(parseTranscriptContent(res?.content ?? '', insightSummary.conversational_summary || []))
      })
      .catch(() => {
        setTranscriptList([])
      })
  }, [currentFile?.id])

  // Toggle play
  const togglePlay = () => {
    if (audioRef.current) {
      if (playing) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
      setPlaying(!playing)
    }
  }

  // Seek
  const seek = (seconds: number) => {
    if (audioRef.current) {
      const newTime = Math.max(0, Math.min(duration, currentTime + seconds))
      audioRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
  }

  // Handle speed change
  const handleSpeedChange = (rate: string) => {
    const newRate = parseFloat(rate)
    setPlaybackRate(newRate)
    if (audioRef.current) {
      audioRef.current.playbackRate = newRate
    }
  }

  // Handle slider change
  const onSliderChange = (value: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value
      setCurrentTime(value)
    }
  }

  // Handle transcript click
  const handleTranscriptClick = (item: TranscriptItem) => {
    setCurrentTranscriptId(item.id)
    if (audioRef.current) {
      audioRef.current.currentTime = item.seconds
      setCurrentTime(item.seconds)
      audioRef.current.play()
      setPlaying(true)
    }
  }

  // Speed menu items
  const speedMenuItems: MenuProps['items'] = [
    { key: '0.5', label: '0.5x', onClick: () => handleSpeedChange('0.5') },
    { key: '1.0', label: '1.0x', onClick: () => handleSpeedChange('1.0') },
    { key: '1.25', label: '1.25x', onClick: () => handleSpeedChange('1.25') },
    { key: '1.5', label: '1.5x', onClick: () => handleSpeedChange('1.5') },
    { key: '2.0', label: '2.0x', onClick: () => handleSpeedChange('2.0') },
  ]

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleLoadedMetadata = () => setDuration(audio.duration)
    const handleEnded = () => setPlaying(false)

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [])

  // Sync transcript highlight with audio time
  useEffect(() => {
    const activeItem = [...transcriptList].reverse().find(item => item.seconds <= currentTime)
    if (activeItem && activeItem.id !== currentTranscriptId) {
      setCurrentTranscriptId(activeItem.id)
    }
  }, [currentTime, transcriptList, currentTranscriptId])

  // Load transcript on mount and file change
  useEffect(() => {
    loadTranscript()
  }, [currentFile?.id, loadTranscript])

  // Polling: when transcriptList is empty, keep requesting
  const { start: startPoll, stop: stopPoll } = usePoll(async () => {
    if (!currentFile?.id) return

    await loadTranscript()

    // Stop polling when content is loaded
    if (transcriptList.length > 0) {
      stopPoll()
    }
  })

  // Start polling on mount
  useEffect(() => {
    startPoll()
    return () => stopPoll()
  }, [])

  // Set initial volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100
    }
  }, [])

  return (
    <div className="flex-1">
      <div className="w-4/5 mx-auto flex flex-col h-full bg-white relative">
        {/* Hidden Audio Element */}
        <audio ref={audioRef} className="hidden" src={currentFile?.file_url ?? ''} />

        {/* Top Tabs */}
        <div className="px-1 pt-4 audio-tabs">
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              { key: 'insight', label: '洞察与总结' },
              { key: 'transcript', label: '音频文字稿' }
            ]}
          />
        </div>

        {/* Main Content Area */}
        {activeTab === 'insight' ? (
          <div className="flex-1 overflow-hidden">
            {transcriptList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="flex-none size-[60px] rounded-full border border-[#D1E0FF] bg-[#E3ECFF] flex items-center justify-center mb-6">
                  <SvgIcon name="microphone" size={24} color="#2563EB" />
                </div>
                <h3 className="text-base font-medium text-[#1D1E1F] mb-2">解析音频内容中...</h3>
                <p className="text-[#999999] text-sm mb-8">
                  解析音频内容生成洞察与总结，转写成文字稿并识别发言人，提升回顾效率
                </p>
              </div>
            ) : (
              <div className="h-full overflow-y-auto">
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
                          const speakers = getSpeakersBySentenceIds([...(item.SentenceIdsOfQuestion || []), ...(item.SentenceIdsOfAnswer || [])])
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
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 px-1 overflow-y-auto">
            {transcriptList.length > 0 ? (
              <div className="py-5 space-y-4">
                {transcriptList.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-start gap-5 border rounded-xl p-4 group cursor-pointer relative ${currentTranscriptId === item.id ? 'bg-[#F2F7FF] border-[#F2F7FF]' : ''}`}
                    onClick={() => handleTranscriptClick(item)}
                  >
                    {/* Time */}
                    <div
                      className={`h-5 px-1 rounded-full flex items-center justify-center text-xs flex-shrink-0 transition-colors ${currentTranscriptId === item.id ? 'bg-[#E6EDFF] text-[#2563EB]' : 'bg-[#F5F5F5] text-[#999999] group-hover:bg-gray-200'}`}
                    >
                      {item.time}
                    </div>
                    <div className="w-1 border-l-[2px] border-[#E5E7EB] border-dashed absolute left-9 top-10 bottom-3" />

                    {/* Content */}
                    <div className="flex-1">
                      <div className="flex items-center mb-2">
                        <div
                          className="size-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 mr-2"
                          style={{
                            backgroundColor: SPEAKER_STYLES[(item.speakerNum - 1) % SPEAKER_STYLES.length].bg,
                            color: SPEAKER_STYLES[(item.speakerNum - 1) % SPEAKER_STYLES.length].color
                          }}
                        >
                          {item.speaker.slice(0, 1)}
                        </div>
                        <span className="text-sm text-[#1D1E1F] mr-2">{item.speaker}</span>
                        {currentTranscriptId === item.id && (
                          <div className="w-6 h-[18px] bg-[#E6EDFF] rounded-md flex items-center justify-center">
                            <SvgIcon name="align-bottom-two-filled" color="#2563EB" size={14} />
                          </div>
                        )}
                      </div>
                      <div className="text-sm text-[#4F5052] leading-relaxed whitespace-pre-wrap break-words text-justify">
                        {item.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full">
                <Empty description="暂无文字稿" />
              </div>
            )}
          </div>
        )}

        {/* Bottom Player Bar */}
        <div className="h-16 flex items-center px-4 bg-white select-none border-t border-gray-100">
          {/* Play Controls */}
          <div className="flex items-center space-x-4 mr-6">
            <div className="size-8 flex-center relative" onClick={() => seek(-5)}>
              <ReloadOutlined className="text-gray-600 cursor-pointer hover:text-blue-500 text-xl" />
              <span className="text-[10px] text-[#000] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">5</span>
            </div>
            <div
              className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 flex items-center justify-center cursor-pointer transition-colors shadow-sm"
              onClick={togglePlay}
            >
              {playing ? (
                <SvgIcon name="pause" color="white" size={20} className="text-white" />
              ) : (
                <SvgIcon name="play-one-fill" color="white" size={20} className="text-white" />
              )}
            </div>
            <div className="size-8 flex-center relative" onClick={() => seek(5)}>
              <ReloadOutlined className="text-gray-600 cursor-pointer hover:text-blue-500 text-xl" style={{ transform: 'scaleX(-1)' }} />
              <span className="text-[10px] text-[#000] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">5</span>
            </div>
          </div>

          {/* Time */}
          <div className="flex-1 pt-3">
            {/* Progress Bar */}
            <Slider
              value={currentTime}
              max={duration}
              tooltip={{ formatter: formatTime }}
              className="progress-slider"
              onChange={onSliderChange}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-[#999999] font-mono">{formatTime(currentTime)}</span>
              <span className="text-xs text-[#999999] font-mono">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-4 ml-6">
            {/* Playback Rate */}
            <Dropdown menu={{ items: speedMenuItems }} trigger={['click']}>
              <div className="w-11 h-7 border rounded-md text-xs text-[#1D1E1F] cursor-pointer hover:text-blue-500 flex-center transition-colors">
                {playbackRate}x
              </div>
            </Dropdown>

            {/* Volume */}
            <Popover
              content={
                <div className="py-3 flex justify-center h-[120px] volume-slider-container">
                  <Slider
                    vertical
                    value={volume}
                    onChange={(val) => {
                      setVolume(val)
                      if (audioRef.current) {
                        audioRef.current.volume = val / 100
                      }
                    }}
                    style={{ height: '100px' }}
                  />
                </div>
              }
              trigger="click"
              placement="top"
            >
              <div className="w-7 h-7 border rounded-md text-xs text-[#1D1E1F] cursor-pointer hover:text-blue-500 flex-center transition-colors">
                <SvgIcon name={volumeIcon} size={18} />
              </div>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AudioView
