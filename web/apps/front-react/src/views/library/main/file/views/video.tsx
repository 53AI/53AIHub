import { useState, useRef, useEffect } from 'react'
import { Tabs, Button, Slider, Empty, Avatar, Popover } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import type { MenuProps } from 'antd'
import { FileItem } from '@/api/modules/files/types'
import { SvgIcon } from '@km/shared-components-react'
import './video.css'

interface TranscriptItem {
  id: string
  time: string
  seconds: number
  speaker: string
  avatar: string
  content: string
}

interface VideoViewProps {
  currentFile: FileItem
}

// Test audio URL for demo
const TEST_AUDIO_URL = 'https://music.163.com/song/media/outer/url?id=1901371647.mp3'

export function VideoView({ currentFile }: VideoViewProps) {
  const audioRef = useRef<HTMLAudioElement>(null)

  // State
  const [activeTab, setActiveTab] = useState('transcript')
  const [currentTranscriptId, setCurrentTranscriptId] = useState('')

  // Audio state
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(80)
  const [playbackRate, setPlaybackRate] = useState(1.0)

  // Mock transcript data
  const [transcriptList] = useState<TranscriptItem[]>([
    {
      id: '1',
      time: '00:00:05',
      seconds: 5,
      speaker: '发言人-A',
      avatar: 'https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png',
      content: '大家好，欢迎来到今天的分享。非常感谢大家在百忙之中抽出时间来参加我们这次分享会。最近数字人直播在各行各业都火了起来，今天就想借这个机会，和大家一起聊聊实战中的经验以及未来的思考。'
    },
    {
      id: '2',
      time: '00:00:08',
      seconds: 8,
      speaker: '发言人-B',
      avatar: 'https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png',
      content: '大家晚上好。首先我想介绍一下 53AI 的核心定位。我们不仅仅是一个技术平台，更是一个赋能企业实现数字化转型的引擎。很多中大型企业第一次接触我们的时候，会觉得 53AI 就是做数字人、做直播工具的。但其实我们的定位远不止于此。我们的底层技术能力，包括多模态交互、实时渲染、知识图谱等等，最终都是为了帮企业把复杂的数字化转型变得更轻量化、更可落地。简单来说，我们不只是"卖工具"，更是陪着客户一起"做增长"。'
    },
    {
      id: '3',
      time: '00:01:02',
      seconds: 62,
      speaker: '发言人-A',
      avatar: 'https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png',
      content: '我特别认同杨总说的。我们接触过很多客户，不管是传统的制造业，还是新兴的消费品牌，他们都想拥抱 AI，但最大的痛点就是"不知道从哪下手"。'
    },
    {
      id: '4',
      time: '00:01:58',
      seconds: 118,
      speaker: '发言人-B',
      avatar: 'https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png',
      content: '其实我们做的就是把复杂的 AI 技术封装成一个个开箱即用的"智能体"，让企业不需要自己养一个庞大的技术团队，就能快速搭建数字人直播、智能客服、私域运营这些场景，真正让 AI 在业务里跑起来、赚到钱。'
    },
    {
      id: '5',
      time: '00:02:13',
      seconds: 133,
      speaker: '发言人-C',
      avatar: 'https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png',
      content: '我想页页可以从一个大家都很熟悉的体系切入 —— 阿里的"三板斧"。很多人都知道它是"定战略、造土壤、断事用人"，这在传统组织管理里是一套非常成熟的打法。但在 AI 时代，尤其是我们在用数字人、智能体这些工具重构业务的时候，这三个维度其实都被赋予了全新的内涵，今天我们请杨总来一层一层来拆解。'
    },
    {
      id: '6',
      time: '00:03:28',
      seconds: 208,
      speaker: '发言人-B',
      avatar: 'https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png',
      content: '在管理中，我们常说"定战略、造土壤、断事用人"。在 AI 时代，这三个维度都有了新的内涵。首先说"定战略"。以前我们定战略，更多是基于经验和行业判断，周期可能按年算。但现在有了 AI，我们可以通过实时的数据反馈，比如数字人直播间的用户互动、成交转化，来动态调整产品策略和营销节奏，战略的迭代速度从"年"变成了"天"。'
    }
  ])

  // Format time
  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '00:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  // Volume icon
  const volumeIcon = volume === 0 ? 'volume-mute' : volume < 50 ? 'volume-notice' : 'volume-notice'

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

  // Handle start parse
  const handleStartParse = () => {
    console.log('Start parsing...')
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
        <audio ref={audioRef} className="hidden" src={TEST_AUDIO_URL} />

        {/* Top Tabs */}
        <div className="px-1 pt-4">
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              { key: 'insight', label: '洞察与总结' },
              { key: 'transcript', label: '视频文字稿' }
            ]}
          />
        </div>

        {/* Main Content Area */}
        {activeTab === 'insight' ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="flex-none size-[60px] rounded-full border border-[#D1E0FF] bg-[#E3ECFF] flex items-center justify-center mb-6">
              <SvgIcon name="microphone" size={24} className="text-[#2563EB]" />
            </div>
            <h3 className="text-base font-medium text-[#1D1E1F] mb-2">是否解析视频内容?</h3>
            <p className="text-[#999999] text-sm mb-8 max-w-md">
              解析视频内容生成洞察与总结，转写成文字稿并识别发言人，提升回顾效率
            </p>
            <Button type="primary" size="large" className="!px-8 !rounded-lg" onClick={handleStartParse}>
              <SvgIcon name="magic-stick" className="mr-1" />
              开始解析
            </Button>
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
                    <div className="w-1 border-l-[2px] border-[#E5E7EB] border-dashed absolute left-12 top-10 bottom-3" />

                    {/* Content */}
                    <div className="flex-1">
                      <div className="flex items-center mb-2">
                        <Avatar size={24} src={item.avatar} className="mr-2" />
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
              <SvgIcon name="refresh-left" className="text-gray-600 cursor-pointer hover:text-blue-500 text-xl" />
              <span className="text-[10px] text-[#000] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">5</span>
            </div>
            <div
              className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 flex items-center justify-center cursor-pointer transition-colors shadow-sm"
              onClick={togglePlay}
            >
              {playing ? (
                <SvgIcon name="pause" size={20} className="text-white" />
              ) : (
                <SvgIcon name="play-one-fill" size={20} className="text-white" />
              )}
            </div>
            <div className="size-8 flex-center relative" onClick={() => seek(5)}>
              <SvgIcon name="refresh-right" className="text-gray-600 cursor-pointer hover:text-blue-500 text-xl" />
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
              className="!mb-0 !h-5"
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
                <div className="py-3 flex justify-center h-[120px]">
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

export default VideoView
