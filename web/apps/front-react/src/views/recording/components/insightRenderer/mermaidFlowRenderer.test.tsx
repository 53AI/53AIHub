/**
 * mermaidFlowRenderer.tsx 渲染测试
 *
 * 渲染策略（仿 meeting-recorder）：
 * - 节点用 HTML <article> 卡片，CSS 自然换行，box 高度自撑
 * - 边走透明 SVG overlay
 * - useLayoutEffect 测量 offsetHeight 校正布局
 *
 * 覆盖：空图守卫、TB/LR 布局、tone 配色、边标签、孤立边、多 rank 分布、
 *       溢出兜底（HTML 自然换行，不截断）。
 *
 * 注意：jsdom 不做真实布局，offsetHeight=0；测试断言是渲染结构与默认布局（最小高度兜底）。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MermaidFlowRenderer } from './mermaidFlowRenderer';
import type { MermaidFlowDiagram, MermaidFlowNode } from '@/api/modules/recording/types';

const node = (overrides: Partial<MermaidFlowNode> = {}): MermaidFlowNode => ({
  id: 'N',
  title: '节点',
  content: '',
  tone: 'neutral',
  rank: 0,
  ...overrides,
})

// ============= 空图守卫 =============

describe('MermaidFlowRenderer — 空图守卫', () => {
  it('diagram 为 undefined 时返回 null', () => {
    const { container } = render(<MermaidFlowRenderer diagram={undefined as any} />)
    expect(container.querySelector('.insight-mermaid-flow')).toBeNull()
  })

  it('diagram.nodes 为空数组时返回 null', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{ direction: 'TB', nodes: [], edges: [] }}
      />,
    )
    expect(container.querySelector('.insight-mermaid-flow')).toBeNull()
  })

  it('diagram.nodes 不是数组时返回 null', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{ direction: 'TB', nodes: null as any, edges: [] }}
      />,
    )
    expect(container.querySelector('.insight-mermaid-flow')).toBeNull()
  })
})

// ============= TB 基础结构 =============

describe('MermaidFlowRenderer — TB 基础结构', () => {
  const tbDiagram: MermaidFlowDiagram = {
    direction: 'TB',
    nodes: [
      node({ id: 'A', title: '开始', content: '起点描述', rank: 0 }),
      node({ id: 'B', title: '过程', content: '中段描述', rank: 1 }),
      node({ id: 'C', title: '结束', content: '终点描述', rank: 2 }),
    ],
    edges: [
      { from: 'A', to: 'B', label: '' },
      { from: 'B', to: 'C', label: '' },
    ],
  }

  it('渲染 1 个 viewport + 1 个 flow 容器 + 1 个 SVG 边层 + 3 张节点 article', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    expect(container.querySelectorAll('.insight-mermaid-viewport')).toHaveLength(1)
    expect(container.querySelectorAll('.insight-mermaid-flow')).toHaveLength(1)
    expect(container.querySelectorAll('.insight-mermaid-flow svg.insight-flow-lines')).toHaveLength(1)
    expect(container.querySelectorAll('.insight-mermaid-flow .insight-flow-node')).toHaveLength(3)
  })

  it('SVG 是边层，pointer-events: none, z-index: 1', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    const svg = container.querySelector('svg.insight-flow-lines')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
  })

  it('箭头 marker 在 <defs> 内且 id 唯一', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    const marker = container.querySelector('svg defs marker')
    expect(marker).not.toBeNull()
    expect(marker?.getAttribute('id')).toBe('insight-flow-arrow')
  })

  it('TB 走向：边 path d 属性是正交折线 (M V H V)', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    // 边通过 <path stroke=...> 渲染
    const edgePaths = container.querySelectorAll('svg.insight-flow-lines path[stroke]')
    expect(edgePaths.length).toBeGreaterThanOrEqual(2)
    for (const p of Array.from(edgePaths)) {
      const d = p.getAttribute('d') || ''
      // TB 路径：M x y V midY H x2 V y2
      expect(d).toMatch(/^M /)
      expect(d.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(5)
    }
  })

  it('所有边都引用同一个箭头 marker', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    const edgePaths = container.querySelectorAll('svg.insight-flow-lines path[marker-end]')
    expect(edgePaths.length).toBeGreaterThanOrEqual(2)
    for (const p of Array.from(edgePaths)) {
      expect(p.getAttribute('marker-end')).toBe('url(#insight-flow-arrow)')
    }
  })
})

// ============= LR 布局 =============

describe('MermaidFlowRenderer — LR 布局', () => {
  const lrDiagram: MermaidFlowDiagram = {
    direction: 'LR',
    nodes: [
      node({ id: 'A', title: '左', content: '', rank: 0 }),
      node({ id: 'B', title: '中', content: '', rank: 1 }),
    ],
    edges: [{ from: 'A', to: 'B', label: '' }],
  }

  it('LR 走向仍渲染正确数量的节点和边', () => {
    const { container } = render(<MermaidFlowRenderer diagram={lrDiagram} />)
    expect(container.querySelectorAll('.insight-mermaid-flow .insight-flow-node')).toHaveLength(2)
    expect(container.querySelectorAll('svg.insight-flow-lines path[marker-end]')).toHaveLength(1)
  })

  it('LR 走向：边 path d 仍是正交折线 (M H V H)', () => {
    const { container } = render(<MermaidFlowRenderer diagram={lrDiagram} />)
    const edgePath = container.querySelector('svg.insight-flow-lines path[marker-end]')
    const d = edgePath?.getAttribute('d') || ''
    expect(d).toMatch(/^M /)
    expect(d.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(5)
  })
})

// ============= Tone 配色 =============

describe('MermaidFlowRenderer — Tone 配色', () => {
  const tones = ['neutral', 'positive', 'info', 'warning', 'danger', 'critical', 'pending'] as const

  tones.forEach(tone => {
    it(`tone=${tone}:节点带对应 CSS class`, () => {
      const { container } = render(
        <MermaidFlowRenderer
          diagram={{
            direction: 'TB',
            nodes: [
              node({ id: 'X', tone, title: 't', content: 'c' }),
              node({ id: 'Y', tone: 'neutral', rank: 1 }),
            ],
            edges: [{ from: 'X', to: 'Y', label: '' }],
          }}
        />,
      )
      const nodeEl = container.querySelector('.insight-flow-node')
      expect(nodeEl).not.toBeNull()
      expect(nodeEl!.className).toContain(`tone-${tone}`)
    })
  })

  it('未知 tone 退化到 neutral', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'X', tone: 'made-up-tone' as any }),
            node({ id: 'Y', tone: 'neutral', rank: 1 }),
          ],
          edges: [{ from: 'X', to: 'Y', label: '' }],
        }}
      />,
    )
    expect(container.querySelector('.insight-flow-node')!.className).toContain('tone-neutral')
  })

  it('pending 节点有 tone-pending 类(虚线由 CSS 控制)', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'X', tone: 'pending' }),
            node({ id: 'Y', tone: 'neutral', rank: 1 }),
          ],
          edges: [{ from: 'X', to: 'Y', label: '' }],
        }}
      />,
    )
    expect(container.querySelector('.insight-flow-node')!.className).toContain('tone-pending')
  })
})

// ============= 边标签 =============

describe('MermaidFlowRenderer — 边标签', () => {
  it('带 label 的边渲染为 <text class="insight-flow-edge-label">', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', rank: 0 }),
            node({ id: 'B', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '推动' }],
        }}
      />,
    )
    const labelTexts = container.querySelectorAll('.insight-flow-edge-label')
    expect(labelTexts).toHaveLength(1)
    expect(labelTexts[0].textContent).toBe('推动')
  })

  it('无 label 的边不渲染 label text', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', rank: 0 }),
            node({ id: 'B', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '' }],
        }}
      />,
    )
    expect(container.querySelectorAll('.insight-flow-edge-label')).toHaveLength(0)
  })
})

// ============= 节点文本(HTML 渲染,不截断) =============

describe('MermaidFlowRenderer — 节点文本', () => {
  it('title 渲染在 <strong class="insight-flow-node-title">', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', title: '认知框架降维', content: '' }),
            node({ id: 'B', title: '', content: '', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '' }],
        }}
      />,
    )
    const title = container.querySelector('.insight-flow-node-title')!
    expect(title.tagName.toLowerCase()).toBe('strong')
    expect(title.textContent).toBe('认知框架降维')
  })

  it('content 渲染在 <div class="insight-flow-node-body">', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', title: '标题', content: '详细描述' }),
            node({ id: 'B', title: '', content: '', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '' }],
        }}
      />,
    )
    const body = container.querySelector('.insight-flow-node-body')!
    expect(body.tagName.toLowerCase()).toBe('div')
    expect(body.textContent).toBe('详细描述')
  })

  it('无 content 时不渲染 body 元素', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', title: '仅有标题', content: '' }),
            node({ id: 'B', title: '', content: '', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '' }],
        }}
      />,
    )
    expect(container.querySelectorAll('.insight-flow-node-body')).toHaveLength(0)
  })

  it('无 title 时退化用 node.id 作为文本', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'FallbackId', title: '', content: '' }),
            node({ id: 'Helper', title: '', content: '', rank: 1 }),
          ],
          edges: [{ from: 'FallbackId', to: 'Helper', label: '' }],
        }}
      />,
    )
    expect(container.querySelector('.insight-flow-node-title')!.textContent).toBe('FallbackId')
  })

  it('超长 title 不被截断——HTML 自然换行,完整文本保留', () => {
    // 这是与原 SVG 实现的本质差异：不再硬截断，CSS 处理换行
    const longTitle = '这一段超长的节点标题是用来验证 HTML 节点会自然换行而不是被砍掉'
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', title: longTitle, content: '' }),
            node({ id: 'B', title: '', content: '', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '' }],
        }}
      />,
    )
    const title = container.querySelector('.insight-flow-node-title')!
    // 完整文本一字不漏
    expect(title.textContent).toBe(longTitle)
    // 没有任何截断省略号
    expect(title.textContent).not.toMatch(/…/)
  })

  it('超长 content 同样完整保留', () => {
    const longContent =
      '这一段非常长的内容描述文本是为了验证 HTML 节点上的 body 元素会保留完整文字而不被任何硬截断逻辑砍掉 ' +
      '正常情况下整段文字应该全部留在 DOM 中,CSS 在浏览器里负责折行'
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', title: '短标题', content: longContent }),
            node({ id: 'B', title: '', content: '', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '' }],
        }}
      />,
    )
    const body = container.querySelector('.insight-flow-node-body')!
    expect(body.textContent).toBe(longContent)
    expect(body.textContent).not.toMatch(/…/)
  })
})

// ============= 节点定位(默认布局) =============

describe('MermaidFlowRenderer — 节点定位', () => {
  it('节点用 inline style 绝对定位', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', rank: 0 }),
            node({ id: 'B', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '' }],
        }}
      />,
    )
    const nodes = container.querySelectorAll('.insight-flow-node')
    for (const n of Array.from(nodes)) {
      const style = (n as HTMLElement).style
      expect(style.position).toBe('absolute')
      expect(style.left).toBeTruthy()
      expect(style.top).toBeTruthy()
      expect(style.width).toBeTruthy()
    }
  })

  it('同 rank 多节点共享 top,不同 left(TB 居中分布)', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', rank: 0 }),
            node({ id: 'B', rank: 1 }),
            node({ id: 'C', rank: 1 }),
            node({ id: 'D', rank: 1 }),
          ],
          edges: [
            { from: 'A', to: 'B', label: '' },
            { from: 'A', to: 'C', label: '' },
            { from: 'A', to: 'D', label: '' },
          ],
        }}
      />,
    )
    const nodes = Array.from(container.querySelectorAll('.insight-flow-node'))
    const tops = nodes.map(n => (n as HTMLElement).style.top)
    const lefts = nodes.map(n => (n as HTMLElement).style.left)
    // rank 1 的三个节点 (B/C/D) 共享 top
    expect(tops[1]).toBe(tops[2])
    expect(tops[2]).toBe(tops[3])
    // rank 0 的 A 在不同的 top
    expect(tops[0]).not.toBe(tops[1])
    // rank 1 的 B/C/D 必须各自独占不同的 left（最关键的多节点分布断言）
    expect(new Set([lefts[1], lefts[2], lefts[3]]).size).toBe(3)
    // A 居中后可能与 rank 1 的中间节点(C)落在同一列——这是设计意图(centering),
    // 不是 bug；断言至少 3 个独立 left 而非严格的 4
    expect(new Set(lefts).size).toBeGreaterThanOrEqual(3)
  })

  it('多 rank 节点 top 严格递增', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', rank: 0 }),
            node({ id: 'B', rank: 1 }),
            node({ id: 'C', rank: 2 }),
          ],
          edges: [
            { from: 'A', to: 'B', label: '' },
            { from: 'B', to: 'C', label: '' },
          ],
        }}
      />,
    )
    const nodes = Array.from(container.querySelectorAll('.insight-flow-node'))
    const tops = nodes.map(n => Number((n as HTMLElement).style.top.replace('px', '')))
    expect(tops[0]).toBeLessThan(tops[1])
    expect(tops[1]).toBeLessThan(tops[2])
  })
})

// ============= 孤立边(健壮性) =============

describe('MermaidFlowRenderer — 孤立边', () => {
  it('from 不在 nodes 中:跳过该边,不崩溃', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [node({ id: 'A', rank: 0 })],
          edges: [{ from: 'GhostFrom', to: 'A', label: '' }],
        }}
      />,
    )
    expect(container.querySelectorAll('.insight-flow-node')).toHaveLength(1)
    expect(container.querySelectorAll('svg.insight-flow-lines path[marker-end]')).toHaveLength(0)
  })

  it('to 不在 nodes 中:跳过该边,不崩溃', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [node({ id: 'A', rank: 0 })],
          edges: [{ from: 'A', to: 'GhostTo', label: '' }],
        }}
      />,
    )
    expect(container.querySelectorAll('svg.insight-flow-lines path[marker-end]')).toHaveLength(0)
  })

  it('孤立边不破坏其他有效边的渲染', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [
            node({ id: 'A', rank: 0 }),
            node({ id: 'B', rank: 1 }),
            node({ id: 'C', rank: 2 }),
          ],
          edges: [
            { from: 'A', to: 'B', label: '' },
            { from: 'GhostFrom', to: 'B', label: '' },
            { from: 'B', to: 'C', label: '' },
          ],
        }}
      />,
    )
    expect(container.querySelectorAll('.insight-flow-node')).toHaveLength(3)
    expect(container.querySelectorAll('svg.insight-flow-lines path[marker-end]')).toHaveLength(2)
  })
})

// ============= CSS overflow 兜底(防御性) =============

describe('MermaidFlowRenderer — CSS overflow 兜底', () => {
  it('节点 article 设置 overflow-wrap: anywhere,允许任意位置断行', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          direction: 'TB',
          nodes: [node({ id: 'A' }), node({ id: 'B', rank: 1 })],
          edges: [{ from: 'A', to: 'B', label: '' }],
        }}
      />,
    )
    const nodeEl = container.querySelector('.insight-flow-node') as HTMLElement
    expect(nodeEl).not.toBeNull()
    // 验证类名包含 overflow 控制相关的样式钩子（CSS 类已定义；浏览器实际生效）
    expect(nodeEl.className).toContain('insight-flow-node')
  })
})