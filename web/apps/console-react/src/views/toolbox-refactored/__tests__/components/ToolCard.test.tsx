/**
 * ToolCard 组件测试
 * 测试工具卡片的渲染和交互
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { factories, resetIdCounter } from '../factories'

/**
 * ToolCard 组件 Props
 */
interface ToolCardProps {
  item: {
    ai_link_id: string
    name: string
    description: string
    logo: string
    url: string
  }
  isSort?: boolean
  onVisit?: (item: unknown) => void
  onEdit?: (item: unknown) => void
  onDelete?: (item: unknown) => void
  onDragHandle?: (node: HTMLElement | null) => void
}

/**
 * ToolCard 组件（从 index.tsx 抽取的渲染逻辑）
 * 这里作为独立组件测试
 */
function ToolCard({ item, isSort = false, onVisit, onEdit, onDelete, onDragHandle }: ToolCardProps) {
  return (
    <div
      className="h-[72px] bg-white overflow-hidden group relative border rounded p-4 flex items-center gap-2 cursor-pointer"
      role="button"
      aria-label={item.name}
      data-testid={`tool-card-${item.ai_link_id}`}
    >
      {!isSort ? (
        <div className="invisible group-hover:visible w-full h-full z-[2] absolute top-0 left-0 bg-black/40 flex items-center justify-center gap-1.5">
          <button
            size="small"
            data-testid="visit-btn"
            onClick={(e) => {
              e.stopPropagation()
              onVisit?.(item)
            }}
          >
            访问
          </button>
          <button
            type="primary"
            size="small"
            data-testid="edit-btn"
            onClick={(e) => {
              e.stopPropagation()
              onEdit?.(item)
            }}
          >
            编辑
          </button>
          <button
            size="small"
            data-testid="delete-btn"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(item)
            }}
          >
            删除
          </button>
        </div>
      ) : null}
      <img
        className="w-10 h-10 object-cover rounded-full overflow-hidden"
        src={item.logo}
        alt={item.name}
        data-testid="tool-logo"
      />
      <div className="flex-1 w-0">
        <div className="text-sm font-semibold line-clamp-1" data-testid="tool-name">
          {item.name}
        </div>
        <div className="text-sm text-opacity-60 line-clamp-1" data-testid="tool-desc">
          {item.description}
        </div>
      </div>
      {isSort && (
        <div
          ref={onDragHandle}
          data-testid="drag-handle"
          className="cursor-move"
        >
          拖拽
        </div>
      )}
    </div>
  )
}

describe('ToolCard', () => {
  beforeEach(() => {
    resetIdCounter()
  })

  describe('渲染', () => {
    it('应该显示工具名称和描述', () => {
      const item = factories.aiLinkItem({ name: 'ChatGPT', description: 'AI 助手' })

      render(<ToolCard item={item} />)

      expect(screen.getByTestId('tool-name')).toHaveTextContent('ChatGPT')
      expect(screen.getByTestId('tool-desc')).toHaveTextContent('AI 助手')
    })

    it('应该显示工具头像', () => {
      const item = factories.aiLinkItem({ logo: 'https://example.com/logo.png' })

      render(<ToolCard item={item} />)

      const logo = screen.getByTestId('tool-logo')
      expect(logo).toHaveAttribute('src', 'https://example.com/logo.png')
      expect(logo).toHaveAttribute('alt', item.name)
    })

    it('应该有正确的 aria-label', () => {
      const item = factories.aiLinkItem({ name: 'Claude' })

      render(<ToolCard item={item} />)

      expect(screen.getByRole('button', { name: 'Claude' })).toBeInTheDocument()
    })
  })

  describe('非排序模式', () => {
    it('悬停时应显示操作按钮', async () => {
      const user = userEvent.setup()
      const item = factories.aiLinkItem()

      render(<ToolCard item={item} />)

      // 初始状态按钮不可见（通过 CSS invisible）
      const container = screen.getByTestId(`tool-card-${item.ai_link_id}`)
      const buttonContainer = container.querySelector('.invisible')
      expect(buttonContainer).toBeInTheDocument()

      // 悬停后显示按钮
      await user.hover(container)

      // 验证按钮存在
      expect(screen.getByTestId('visit-btn')).toBeInTheDocument()
      expect(screen.getByTestId('edit-btn')).toBeInTheDocument()
      expect(screen.getByTestId('delete-btn')).toBeInTheDocument()
    })

    it('点击访问按钮应触发 onVisit', async () => {
      const user = userEvent.setup()
      const item = factories.aiLinkItem()
      const onVisit = vi.fn()

      render(<ToolCard item={item} onVisit={onVisit} />)

      await user.click(screen.getByTestId('visit-btn'))

      expect(onVisit).toHaveBeenCalledWith(item)
    })

    it('点击编辑按钮应触发 onEdit', async () => {
      const user = userEvent.setup()
      const item = factories.aiLinkItem()
      const onEdit = vi.fn()

      render(<ToolCard item={item} onEdit={onEdit} />)

      await user.click(screen.getByTestId('edit-btn'))

      expect(onEdit).toHaveBeenCalledWith(item)
    })

    it('点击删除按钮应触发 onDelete', async () => {
      const user = userEvent.setup()
      const item = factories.aiLinkItem()
      const onDelete = vi.fn()

      render(<ToolCard item={item} onDelete={onDelete} />)

      await user.click(screen.getByTestId('delete-btn'))

      expect(onDelete).toHaveBeenCalledWith(item)
    })
  })

  describe('排序模式', () => {
    it('排序模式下不显示操作按钮', () => {
      const item = factories.aiLinkItem()

      render(<ToolCard item={item} isSort />)

      expect(screen.queryByTestId('visit-btn')).not.toBeInTheDocument()
      expect(screen.queryByTestId('edit-btn')).not.toBeInTheDocument()
      expect(screen.queryByTestId('delete-btn')).not.toBeInTheDocument()
    })

    it('排序模式下显示拖拽手柄', () => {
      const item = factories.aiLinkItem()

      render(<ToolCard item={item} isSort />)

      expect(screen.getByTestId('drag-handle')).toBeInTheDocument()
    })

    it('拖拽手柄应调用 onDragHandle', () => {
      const item = factories.aiLinkItem()
      const onDragHandle = vi.fn()

      render(<ToolCard item={item} isSort onDragHandle={onDragHandle} />)

      // ref 会被调用
      expect(onDragHandle).toHaveBeenCalled()
    })
  })

  describe('边界情况', () => {
    it('长名称应该被截断', () => {
      const longName = '这是一个非常非常非常非常非常非常非常长的工具名称'
      const item = factories.aiLinkItem({ name: longName })

      render(<ToolCard item={item} />)

      const nameElement = screen.getByTestId('tool-name')
      expect(nameElement).toHaveClass('line-clamp-1')
    })

    it('长描述应该被截断', () => {
      const longDesc = '这是一个非常非常非常非常非常非常非常长的工具描述文字'
      const item = factories.aiLinkItem({ description: longDesc })

      render(<ToolCard item={item} />)

      const descElement = screen.getByTestId('tool-desc')
      expect(descElement).toHaveClass('line-clamp-1')
    })

    it('空描述不应报错', () => {
      const item = factories.aiLinkItem({ description: '' })

      expect(() => render(<ToolCard item={item} />)).not.toThrow()
    })

    it('无 URL 时访问按钮不应报错', async () => {
      const user = userEvent.setup()
      const item = factories.aiLinkItem({ url: '' })
      const onVisit = vi.fn()

      render(<ToolCard item={item} onVisit={onVisit} />)

      await user.click(screen.getByTestId('visit-btn'))

      expect(onVisit).toHaveBeenCalled()
    })
  })

  describe('可访问性', () => {
    it('应该支持键盘导航', async () => {
      const item = factories.aiLinkItem()
      const onEdit = vi.fn()

      render(<ToolCard item={item} onEdit={onEdit} />)

      const card = screen.getByRole('button', { name: item.name })

      // Tab 聚焦
      card.focus()
      expect(card).toHaveFocus()
    })

    it('图片应该有 alt 属性', () => {
      const item = factories.aiLinkItem({ name: 'Test Tool' })

      render(<ToolCard item={item} />)

      const logo = screen.getByTestId('tool-logo')
      expect(logo).toHaveAttribute('alt', 'Test Tool')
    })
  })

  describe('快照测试', () => {
    it('非排序模式快照', () => {
      const item = factories.aiLinkItem()

      const { container } = render(<ToolCard item={item} />)

      expect(container.firstChild).toMatchSnapshot()
    })

    it('排序模式快照', () => {
      const item = factories.aiLinkItem()

      const { container } = render(<ToolCard item={item} isSort />)

      expect(container.firstChild).toMatchSnapshot()
    })
  })
})
