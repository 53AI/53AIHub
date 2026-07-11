/**
 * Media Controls Hook - React Hook for audio/video controls
 *
 * Provides common media control functionality for audio and video players
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

interface UseMediaControlsOptions {
  initialVolume?: number
  initialPlaybackRate?: number
}

interface UseMediaControlsReturn {
  // State
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  playbackRate: number
  buffered: number
  waiting: boolean

  // Refs
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement>

  // Actions
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (time: number) => void
  setVolume: (vol: number) => void
  setPlaybackRate: (rate: number) => void
  forward: (seconds?: number) => void
  backward: (seconds?: number) => void

  // Utilities
  formatTime: (seconds: number) => string
  progress: number
}

export function useMediaControls(
  options: UseMediaControlsOptions = {}
): UseMediaControlsReturn {
  const { initialVolume = 0.8, initialPlaybackRate = 1 } = options

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(initialVolume)
  const [playbackRate, setPlaybackRateState] = useState(initialPlaybackRate)
  const [buffered, setBuffered] = useState(0)
  const [waiting, setWaiting] = useState(false)

  // Format time helper
  const formatTime = useCallback((seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '00:00'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)

    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }, [])

  // Play
  const play = useCallback(() => {
    const media = mediaRef.current
    if (media) {
      media.play().catch(console.error)
    }
  }, [])

  // Pause
  const pause = useCallback(() => {
    const media = mediaRef.current
    if (media) {
      media.pause()
    }
  }, [])

  // Toggle play/pause
  const toggle = useCallback(() => {
    if (playing) {
      pause()
    } else {
      play()
    }
  }, [playing, play, pause])

  // Seek to specific time
  const seek = useCallback((time: number) => {
    const media = mediaRef.current
    if (media) {
      media.currentTime = time
      setCurrentTime(time)
    }
  }, [])

  // Set volume
  const setVolume = useCallback((vol: number) => {
    const media = mediaRef.current
    const clampedVol = Math.max(0, Math.min(1, vol))
    if (media) {
      media.volume = clampedVol
    }
    setVolumeState(clampedVol)
  }, [])

  // Set playback rate
  const setPlaybackRate = useCallback((rate: number) => {
    const media = mediaRef.current
    if (media) {
      media.playbackRate = rate
    }
    setPlaybackRateState(rate)
  }, [])

  // Forward by seconds
  const forward = useCallback((seconds = 10) => {
    const media = mediaRef.current
    if (media) {
      const newTime = Math.min(duration, currentTime + seconds)
      media.currentTime = newTime
      setCurrentTime(newTime)
    }
  }, [duration, currentTime])

  // Backward by seconds
  const backward = useCallback((seconds = 10) => {
    const media = mediaRef.current
    if (media) {
      const newTime = Math.max(0, currentTime - seconds)
      media.currentTime = newTime
      setCurrentTime(newTime)
    }
  }, [currentTime])

  // Progress percentage
  const progress = useMemo(() => {
    if (!duration) return 0
    return (currentTime / duration) * 100
  }, [currentTime, duration])

  // Event listeners
  useEffect(() => {
    const media = mediaRef.current
    if (!media) return

    const handlePlay = () => setPlaying(true)
    const handlePause = () => setPlaying(false)
    const handleEnded = () => setPlaying(false)
    const handleTimeUpdate = () => setCurrentTime(media.currentTime)
    const handleDurationChange = () => setDuration(media.duration)
    const handleVolumeChange = () => setVolumeState(media.volume)
    const handleWaiting = () => setWaiting(true)
    const handleCanPlay = () => setWaiting(false)
    const handleProgress = () => {
      if (media.buffered.length > 0) {
        setBuffered(media.buffered.end(media.buffered.length - 1))
      }
    }

    media.addEventListener('play', handlePlay)
    media.addEventListener('pause', handlePause)
    media.addEventListener('ended', handleEnded)
    media.addEventListener('timeupdate', handleTimeUpdate)
    media.addEventListener('durationchange', handleDurationChange)
    media.addEventListener('volumechange', handleVolumeChange)
    media.addEventListener('waiting', handleWaiting)
    media.addEventListener('canplay', handleCanPlay)
    media.addEventListener('progress', handleProgress)

    // Set initial volume
    media.volume = initialVolume
    media.playbackRate = initialPlaybackRate

    return () => {
      media.removeEventListener('play', handlePlay)
      media.removeEventListener('pause', handlePause)
      media.removeEventListener('ended', handleEnded)
      media.removeEventListener('timeupdate', handleTimeUpdate)
      media.removeEventListener('durationchange', handleDurationChange)
      media.removeEventListener('volumechange', handleVolumeChange)
      media.removeEventListener('waiting', handleWaiting)
      media.removeEventListener('canplay', handleCanPlay)
      media.removeEventListener('progress', handleProgress)
    }
  }, [initialVolume, initialPlaybackRate])

  return {
    playing,
    currentTime,
    duration,
    volume,
    playbackRate,
    buffered,
    waiting,
    mediaRef,
    play,
    pause,
    toggle,
    seek,
    setVolume,
    setPlaybackRate,
    forward,
    backward,
    formatTime,
    progress,
  }
}
