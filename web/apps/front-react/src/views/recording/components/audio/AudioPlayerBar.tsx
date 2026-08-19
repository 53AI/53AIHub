import { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react'
import { Slider, Popover } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import { ReloadOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import './AudioView.css'

export interface AudioPlayerBarHandles {
  /** 跳转到指定秒数并播放 */
  seekToAndPlay: (seconds: number) => void
}

export interface AudioPlayerBarProps {
  /** 音频 URL */
  audioSrc: string
  bgColor?: string
  /** 播放进度回调（timeupdate 触发 + seekToAndPlay 跳转后同步触发），
   *  用于联动转写列表高亮。父组件应保持引用稳定（useCallback），避免重复注册事件。 */
  onTimeUpdate?: (currentTime: number) => void
}

export const AudioPlayerBar = forwardRef<AudioPlayerBarHandles, AudioPlayerBarProps>(function AudioPlayerBar({ audioSrc, onTimeUpdate, bgColor = "bg-[#F5F6F7]" }, ref) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(80)
  const [playbackRate, setPlaybackRate] = useState(1.0)

  // 用 ref 持有回调，避免 timeupdate 事件因 prop 变化而频繁重绑
  const onTimeUpdateRef = useRef(onTimeUpdate)
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate
  }, [onTimeUpdate])

  // 暴露 seekToAndPlay 方法给父组件
  useImperativeHandle(ref, () => ({
    seekToAndPlay: (seconds: number) => {
      if (audioRef.current) {
        audioRef.current.currentTime = seconds
        setCurrentTime(seconds)
        audioRef.current.play()
        setPlaying(true)
        // 跳转后同步通知父组件，避免等到下次 timeupdate 才更新联动
        onTimeUpdateRef.current?.(seconds)
      }
    }
  }), [])

  const formatTime = (seconds?: number) => {
    if (!seconds || isNaN(seconds)) return '00:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const volumeIcon = volume === 0 ? 'volume-mute' : 'volume-notice'

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

  const seek = (seconds: number) => {
    if (audioRef.current) {
      const newTime = Math.max(0, Math.min(duration, currentTime + seconds))
      audioRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
  }

  const handleSpeedChange = (rate: string) => {
    const newRate = parseFloat(rate)
    setPlaybackRate(newRate)
    if (audioRef.current) {
      audioRef.current.playbackRate = newRate
    }
  }

  const onSliderChange = (value: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value
      setCurrentTime(value)
    }
  }

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

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      onTimeUpdateRef.current?.(audio.currentTime)
    }
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

  // Set initial volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100
    }
  }, [])

  return (
    <>
      <audio ref={audioRef} className="hidden" src={audioSrc} />
      <div className={`h-14 flex items-center px-4 max-sm:justify-between rounded-2xl select-none  shrink-0 ${bgColor}`}>
        {/* Play Controls */}
        <div className="flex items-center space-x-3 mr-6 max-sm:mr-0">
          <div className="size-8 flex-center relative" onClick={() => seek(-5)}>
            <ReloadOutlined className="text-[#222426] cursor-pointer hover:text-blue-500 text-xl" />
            <span className="text-[10px] text-[#222426] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">5</span>
          </div>
          <div
            className="size-[34px] rounded-xl bg-[#E1E5EB] hover:bg-blue-300 flex items-center justify-center cursor-pointer transition-colors shadow-sm"
            onClick={togglePlay}
          >
            {playing ? (
              <SvgIcon name="pause" color="#222426" size={20} className="text-[#222426]" />
            ) : (
              <SvgIcon name="play-one-fill" color="#222426" size={20} className="text-[#222426]" />
            )}
          </div>
          <div className="size-8 flex-center relative" onClick={() => seek(5)}>
            <ReloadOutlined className="text-[#222426] cursor-pointer hover:text-blue-500 text-xl" style={{ transform: 'scaleX(-1)' }} />
            <span className="text-[10px] text-[#222426] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">5</span>
          </div>
        </div>

        {/* Time */}
        <div className="flex-1 max-sm:hidden">
          <Slider
            value={currentTime}
            max={duration}
            tooltip={{ formatter: formatTime }}
            className="progress-slider"
            onChange={onSliderChange}
            styles={{
              track: {
                background: '#222426'
              }
            }}
          />
        </div>

        {/* Right Controls */}
        <div className="flex items-center space-x-4 ml-6 max-sm:ml-0">
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-[#222426] font-mono">{formatTime(currentTime)}/</span>
            <span className="text-xs text-[#222426] font-mono">{formatTime(duration)}</span>
          </div>

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
    </>
  )
})

export default AudioPlayerBar
