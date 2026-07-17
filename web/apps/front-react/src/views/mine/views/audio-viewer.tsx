// FILEPATH: apps/front-react/src/views/library/main/file/views/audio-simple.tsx

import { useState, useRef, useEffect } from 'react'
import { Slider, Popover } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import type { MenuProps } from 'antd'
import { FileItem } from '@/api/modules/files/types'
import { SvgIcon } from '@km/shared-components-react'
import { ReloadOutlined } from '@ant-design/icons'

interface AudioViewProps {
  currentFile: FileItem
}

export function AudioView({ currentFile }: AudioViewProps) {
  const audioRef = useRef<HTMLAudioElement>(null)

  // Audio state
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(80)
  const [playbackRate, setPlaybackRate] = useState(1.0)

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

  // Set initial volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100
    }
  }, [])

  return (
    <div className="flex-1 flex flex-col bg-white h-full">
      {/* Hidden Audio Element */}
      <audio ref={audioRef} className="hidden" src={currentFile?.file_url ?? ''} />

      {/* Center Icon */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-[120px] h-[120px] rounded-full bg-[#E3ECFF] flex items-center justify-center">
          <SvgIcon name="microphone" size={48} color="#2563EB" className="text-[#2563EB]" />
        </div>
      </div>

      {/* Bottom Player Bar */}
      <div className="h-16 flex items-center px-6 bg-white select-none border-t border-gray-100 pb-1">
        {/* Play Controls */}
        <div className="flex items-center space-x-4 mr-6">
          <div className="size-8 flex items-center justify-center relative cursor-pointer" onClick={() => seek(-5)}>
            <ReloadOutlined className="text-gray-600 hover:text-blue-500 text-xl" style={{ transform: 'scaleX(-1)' }} />
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
          <div className="size-8 flex items-center justify-center relative cursor-pointer" onClick={() => seek(5)}>
            <ReloadOutlined className="text-gray-600 hover:text-blue-500 text-xl" />
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
            <div className="w-11 h-7 border rounded-md text-xs text-[#1D1E1F] cursor-pointer hover:text-blue-500 flex items-center justify-center transition-colors">
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
            <div className="w-7 h-7 border rounded-md text-xs text-[#1D1E1F] cursor-pointer hover:text-blue-500 flex items-center justify-center transition-colors">
              <SvgIcon name={volumeIcon} size={18} />
            </div>
          </Popover>
        </div>
      </div>
    </div>
  )
}

export default AudioView
