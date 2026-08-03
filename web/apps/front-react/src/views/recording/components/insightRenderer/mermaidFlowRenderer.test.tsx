/**
 * mermaidFlowRenderer.tsx 渲染测试
 *
 * 覆盖：空图守卫、TB/LR 布局、tone 配色、pending 虚线、
 * 边标签、文本截断、孤立边、多 rank 分布、SVG 可达性。
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
    expect(container.querySelector('svg')).toBeNull()
  })

  it('diagram.nodes 为空数组时返回 null', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{ syntax: 'mermaid-flow.v1', direction: 'TB', routing: 'orthogonal', source: '', nodes: [], edges: [] }}
      />,
    )
    expect(container.querySelector('svg')).toBeNull()
  })

  it('diagram.nodes 不是数组时返回 null', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{ syntax: 'mermaid-flow.v1', direction: 'TB', routing: 'orthogonal', source: '', nodes: null as any, edges: [] }}
      />,
    )
    expect(container.querySelector('svg')).toBeNull()
  })
})

// ============= TB 基础布局 =============

describe('MermaidFlowRenderer — TB 基础布局', () => {
  const tbDiagram: MermaidFlowDiagram = {
    syntax: 'mermaid-flow.v1',
    direction: 'TB',
    routing: 'orthogonal',
    source: '',
    nodes: [
      node({ id: 'A', title: '开始', content: '起点', rank: 0 }),
      node({ id: 'B', title: '过程', content: '中段', rank: 1 }),
      node({ id: 'C', title: '结束', content: '终点', rank: 2 }),
    ],
    edges: [
      { from: 'A', to: 'B', label: '' },
      { from: 'B', to: 'C', label: '' },
    ],
  }

  it('渲染 1 个 SVG + 3 个节点 rect + 2 条可见边', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    expect(container.querySelectorAll('svg')).toHaveLength(1)
    expect(container.querySelectorAll('.insight-mermaid-flow svg rect')).toHaveLength(3)
    expect(container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-edge')).toHaveLength(2)
  })

  it('SVG 带 role=img 和 aria-label', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toContain('因果')
  })

  it('箭头 marker 在 <defs> 内且有唯一 id', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    const marker = container.querySelector('svg defs marker')
    expect(marker).not.toBeNull()
    expect(marker?.getAttribute('id')).toBe('insight-mermaid-arrow')
  })

  it('TB 走向：边 path d 属性包含 3 段折线（M+L+L+L）', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    const edgePaths = container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-edge')
    expect(edgePaths).toHaveLength(2)
    for (const p of Array.from(edgePaths)) {
      const d = p.getAttribute('d') || ''
      const mCount = (d.match(/M /g) || []).length
      const lCount = (d.match(/L /g) || []).length
      expect(mCount).toBe(1)
      expect(lCount).toBe(3)
    }
  })

  it('所有边都引用同一个箭头 marker', () => {
    const { container } = render(<MermaidFlowRenderer diagram={tbDiagram} />)
    const edgePaths = container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-edge')
    for (const p of Array.from(edgePaths)) {
      expect(p.getAttribute('marker-end')).toBe('url(#insight-mermaid-arrow)')
    }
  })
})

// ============= LR 布局 =============

describe('MermaidFlowRenderer — LR 布局', () => {
  const lrDiagram: MermaidFlowDiagram = {
    syntax: 'mermaid-flow.v1',
    direction: 'LR',
    routing: 'orthogonal',
    source: '',
    nodes: [
      node({ id: 'A', title: '左', content: '', rank: 0 }),
      node({ id: 'B', title: '中', content: '', rank: 1 }),
    ],
    edges: [{ from: 'A', to: 'B', label: '' }],
  }

  it('LR 走向仍渲染正确数量的节点和边', () => {
    const { container } = render(<MermaidFlowRenderer diagram={lrDiagram} />)
    expect(container.querySelectorAll('svg rect')).toHaveLength(2)
    expect(container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-edge')).toHaveLength(1)
  })

  it('LR 走向：边 path d 仍是 3 段折线', () => {
    const { container } = render(<MermaidFlowRenderer diagram={lrDiagram} />)
    const edgePath = container.querySelector('.insight-mermaid-flow svg .insight-mermaid-edge')
    const d = edgePath?.getAttribute('d') || ''
    expect((d.match(/M /g) || []).length).toBe(1)
    expect((d.match(/L /g) || []).length).toBe(3)
  })
})

// ============= Tone 配色 =============

describe('MermaidFlowRenderer — Tone 配色', () => {
  const tones = ['neutral', 'positive', 'info', 'warning', 'danger', 'critical', 'pending'] as const

  tones.forEach(tone => {
    it(`tone=${tone}:渲染节点带 fill + stroke,且两者不同`, () => {
      const { container } = render(
        <MermaidFlowRenderer
          diagram={{
            syntax: 'mermaid-flow.v1',
            direction: 'TB',
            routing: 'orthogonal',
            source: '',
            nodes: [node({ id: 'X', tone, title: 't', content: 'c' })],
            edges: [],
          }}
        />,
      )
      const rect = container.querySelector('svg rect')
      expect(rect).not.toBeNull()
      const fill = rect!.getAttribute('fill')
      const stroke = rect!.getAttribute('stroke')
      expect(fill).toBeTruthy()
      expect(stroke).toBeTruthy()
      expect(fill).not.toBe(stroke)
    })
  })

  it('pending tone 节点边框是虚线', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [node({ id: 'X', tone: 'pending', title: 't', content: 'c' })],
          edges: [],
        }}
      />,
    )
    const rect = container.querySelector('svg rect')
    expect(rect?.getAttribute('stroke-dasharray')).toBeTruthy()
  })

  it('非 pending tone 节点没有 stroke-dasharray', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [node({ id: 'X', tone: 'critical', title: 't', content: 'c' })],
          edges: [],
        }}
      />,
    )
    const rect = container.querySelector('svg rect')
    expect(rect?.getAttribute('stroke-dasharray')).toBeFalsy()
  })

  it('多个 tone 对应的 fill 颜色应互不相同(至少 5 种)', () => {
    const seen = new Map<string, string>()
    for (const tone of tones) {
      const { container } = render(
        <MermaidFlowRenderer
          diagram={{
            syntax: 'mermaid-flow.v1',
            direction: 'TB',
            routing: 'orthogonal',
            source: '',
            nodes: [node({ id: `X_${tone}`, tone, title: 't', content: 'c' })],
            edges: [],
          }}
        />,
      )
      const fill = container.querySelector('svg rect')!.getAttribute('fill')!
      seen.set(tone, fill)
    }
    const uniqueFills = new Set(Array.from(seen.values()))
    expect(uniqueFills.size).toBeGreaterThanOrEqual(5)
  })
})

// ============= 边标签 =============

describe('MermaidFlowRenderer — 边标签', () => {
  it('带 label 的边渲染为 <text>', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [
            node({ id: 'A', rank: 0 }),
            node({ id: 'B', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '推动' }],
        }}
      />,
    )
    const labelTexts = container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-edge-label')
    expect(labelTexts).toHaveLength(1)
    expect(labelTexts[0].textContent).toBe('推动')
  })

  it('无 label 的边不渲染 label text', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [
            node({ id: 'A', rank: 0 }),
            node({ id: 'B', rank: 1 }),
          ],
          edges: [{ from: 'A', to: 'B', label: '' }],
        }}
      />,
    )
    expect(container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-edge-label')).toHaveLength(0)
  })
})

// ============= 文本截断 =============

describe('MermaidFlowRenderer — 文本截断', () => {
  // TITLE_CHARS=13 / TITLE_LINES=2 → title 上限 26 字符
  // CONTENT_CHARS=19 / CONTENT_LINES=3 → content 上限 57 字符
  // 超过会被省略号 (…)截断

  it('超长 title 末尾带省略号', () => {
    // 40+ 字符的 title 必然被截断
    const longTitle = '这一段超长的节点标题是为了触发文本截断而专门设计的字符串'
    expect(longTitle.length).toBeGreaterThan(26)
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [node({ id: 'A', title: longTitle, content: '' })],
          edges: [],
        }}
      />,
    )
    const titleTexts = container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-node-title')
    const combined = Array.from(titleTexts).map(t => t.textContent || '').join('')
    expect(combined).toMatch(/…/)
  })

  it('超长 content 末尾带省略号', () => {
    const longContent =
      '这一段非常长的内容描述文本是为了触发内容截断而专门设计的,' +
      '正常情况下不应该出现在节点内部,' +
      '但是为了让截断逻辑得到测试覆盖,我们让这段文字远远超过节点框能容纳的容量'
    expect(longContent.length).toBeGreaterThan(57)
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [
            node({
              id: 'A',
              title: '短标题',
              content: longContent,
            }),
          ],
          edges: [],
        }}
      />,
    )
    const contentTexts = container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-node-content')
    const combined = Array.from(contentTexts).map(t => t.textContent || '').join('')
    expect(combined).toMatch(/…/)
  })

  it('长度在上限内的 title 不带省略号', () => {
    const shortTitle = '这是短标题' // 6 字符 < 26
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [node({ id: 'A', title: shortTitle, content: '' })],
          edges: [],
        }}
      />,
    )
    const titleTexts = container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-node-title')
    const combined = Array.from(titleTexts).map(t => t.textContent || '').join('')
    expect(combined).not.toMatch(/…/)
    expect(combined).toBe(shortTitle)
  })

  it('无 title 时退化用 node.id 作为文本', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [node({ id: 'FallbackId', title: '', content: '' })],
          edges: [],
        }}
      />,
    )
    const titleTexts = container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-node-title')
    expect(titleTexts[0].textContent).toBe('FallbackId')
  })
})

// ============= 孤立边(健壮性) =============

describe('MermaidFlowRenderer — 孤立边', () => {
  it('from 不在 nodes 中:跳过该边,不崩溃', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [node({ id: 'A', rank: 0 })],
          edges: [{ from: 'GhostFrom', to: 'A', label: '' }],
        }}
      />,
    )
    expect(container.querySelectorAll('svg rect')).toHaveLength(1)
    expect(container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-edge')).toHaveLength(0)
  })

  it('to 不在 nodes 中:跳过该边,不崩溃', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [node({ id: 'A', rank: 0 })],
          edges: [{ from: 'A', to: 'GhostTo', label: '' }],
        }}
      />,
    )
    expect(container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-edge')).toHaveLength(0)
  })

  it('孤立边不破坏其他有效边的渲染', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
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
    expect(container.querySelectorAll('svg rect')).toHaveLength(3)
    expect(container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-edge')).toHaveLength(2)
  })
})

// ============= 多 rank 分布 =============

describe('MermaidFlowRenderer — 多 rank 分布', () => {
  // 注:jsdom 不做 SVG 布局,getBoundingClientRect() 全返 0。
  // 这里直接断言 SVG 属性 x/y,与布局算法的输出 1:1 对应。

  it('同 rank 多节点沿 X 居中分布(共享 y,不同 x)', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
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
    const rects = container.querySelectorAll('svg rect')
    expect(rects).toHaveLength(4)
    const yB = rects[1].getAttribute('y')
    const yC = rects[2].getAttribute('y')
    const yD = rects[3].getAttribute('y')
    // 同 rank 节点共享 y
    expect(yB).toBe(yC)
    expect(yC).toBe(yD)
    // 但 x 各不相同
    const xB = rects[1].getAttribute('x')
    const xC = rects[2].getAttribute('x')
    const xD = rects[3].getAttribute('x')
    expect(xB).not.toBe(xC)
    expect(xC).not.toBe(xD)
  })

  it('多 rank 节点沿 Y 分布(每 rank 的 y 严格递增)', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
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
    const rects = container.querySelectorAll('svg rect')
    const yA = Number(rects[0].getAttribute('y'))
    const yB = Number(rects[1].getAttribute('y'))
    const yC = Number(rects[2].getAttribute('y'))
    expect(yA).toBeLessThan(yB)
    expect(yB).toBeLessThan(yC)
  })

  it('所有节点尺寸一致(便于对齐网格)', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [
            node({ id: 'A', rank: 0 }),
            node({ id: 'B', rank: 1 }),
          ],
          edges: [],
        }}
      />,
    )
    const rects = container.querySelectorAll('svg rect')
    const w0 = rects[0].getAttribute('width')
    const h0 = rects[0].getAttribute('height')
    const w1 = rects[1].getAttribute('width')
    const h1 = rects[1].getAttribute('height')
    expect(w0).toBe(w1)
    expect(h0).toBe(h1)
  })
})

// ============= 节点文本颜色 =============

describe('MermaidFlowRenderer — 节点文本', () => {
  it('title 用粗体,content 用正常字重', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [node({ id: 'A', title: '标题', content: '正文' })],
          edges: [],
        }}
      />,
    )
    const title = container.querySelector('.insight-mermaid-flow svg .insight-mermaid-node-title')!
    const content = container.querySelector('.insight-mermaid-flow svg .insight-mermaid-node-content')!
    expect(title.getAttribute('font-weight')).toBe('700')
    expect(content.getAttribute('font-weight')).not.toBe('700')
  })

  it('无 content 节点不渲染 content text', () => {
    const { container } = render(
      <MermaidFlowRenderer
        diagram={{
          syntax: 'mermaid-flow.v1',
          direction: 'TB',
          routing: 'orthogonal',
          source: '',
          nodes: [node({ id: 'A', title: '仅有标题', content: '' })],
          edges: [],
        }}
      />,
    )
    expect(container.querySelectorAll('.insight-mermaid-flow svg .insight-mermaid-node-content')).toHaveLength(0)
  })
})