import { useRef, useState, useEffect, ReactNode } from 'react'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import './index.css'

interface SliderProps {
  children: ReactNode
  gap?: number | string
  scrollAmount?: number
}

export function Slider({
  children,
  gap = 2,
  scrollAmount = 200,
}: SliderProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showBtn, setShowBtn] = useState(true)
  const animationRef = useRef<number | null>(null)

  const easeInOutCubic = (t: number) => {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1
  }

  const scroll = (targetScrollLeft: number) => {
    if (!scrollRef.current) return

    const duration = 300
    const startTime = performance.now()
    const element = scrollRef.current
    const startScrollLeft = element.scrollLeft

    const step = (timestamp: number) => {
      const elapsedTime = timestamp - startTime
      const progress = Math.min(elapsedTime / duration, 1)
      element.scrollLeft = easeInOutCubic(progress) * (targetScrollLeft - startScrollLeft) + startScrollLeft

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(step)
      }
    }

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
    }
    animationRef.current = requestAnimationFrame(step)
  }

  const handleScrollLeft = () => {
    if (scrollRef.current) {
      scroll(scrollRef.current.scrollLeft - scrollAmount)
    }
  }

  const handleScrollRight = () => {
    if (scrollRef.current) {
      scroll(scrollRef.current.scrollLeft + scrollAmount)
    }
  }

  const checkShowBtn = () => {
    if (scrollRef.current) {
      setShowBtn(scrollRef.current.scrollWidth > scrollRef.current.offsetWidth)
    }
  }

  useEffect(() => {
    checkShowBtn()
    window.addEventListener('resize', checkShowBtn)

    return () => {
      window.removeEventListener('resize', checkShowBtn)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [])

  // Re-check when children change
  useEffect(() => {
    checkShowBtn()
  }, [children])

  const gapValue = typeof gap === 'number' ? `${gap * 4}px` : gap

  return (
    <div className="slider-container">
      {showBtn && (
        <LeftOutlined
          className="slider-icon"
          onClick={handleScrollLeft}
        />
      )}
      <div
        ref={scrollRef}
        className="slider-content scrollbar-none"
        style={{ gap: gapValue }}
      >
        {children}
      </div>
      {showBtn && (
        <RightOutlined
          className="slider-icon"
          onClick={handleScrollRight}
        />
      )}
    </div>
  )
}

export default Slider
