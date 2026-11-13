import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SafeImage } from '@km/shared-components-react'

describe('SafeImage fallback', () => {
  it('空 src + 不传 kind → 默认 agent 兜底图（兼容旧行为）', () => {
    const { container } = render(<SafeImage src="" className="size-8" />)
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toContain('default_agent.png')
    expect(img?.style.objectFit).toBe('contain')
    expect(img?.style.width).toBe('100%')
  })

  it('kind="user" → default_avatar', () => {
    const { container } = render(<SafeImage src="" kind="user" className="size-8" />)
    expect(container.querySelector('img')?.getAttribute('src')).toContain('default_avatar.png')
  })

  it('fallback URL 优先于 kind', () => {
    const { container } = render(
      <SafeImage src="" kind="user" fallback="/custom.png" className="size-8" />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toContain('custom.png')
  })

  it('fallback="" 等价于 none：无内层 img', () => {
    const { container } = render(<SafeImage src="" fallback="" className="size-8" />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('kind="none" → 无内层 img，仅透明盒子', () => {
    const { container } = render(<SafeImage src="" kind="none" className="size-8" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.firstElementChild?.className).toContain('size-8')
  })

  it('letter 优先于 kind，渲染文字而非 img', () => {
    const { container } = render(<SafeImage src="" kind="user" letter="alpha" className="size-8" />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('A')).toBeTruthy()
  })

  it('className 落在兜底外层 div 上（圆角/尺寸类生效）', () => {
    const { container } = render(
      <SafeImage src="" kind="user" className="size-8 rounded-full" />,
    )
    const box = container.firstElementChild as HTMLElement
    expect(box.tagName).toBe('DIV')
    expect(box.className).toContain('rounded-full')
    expect(box.style.overflow).toBe('hidden')
  })
})
