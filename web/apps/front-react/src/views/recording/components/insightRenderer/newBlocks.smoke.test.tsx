/**
 * 新增 block 类型 + mermaid-flow.v1 的烟测。
 * 仅在本地手动运行确认渲染不崩溃。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderBlock } from './blockRenderers';
import type { DecisionPageBlock, MermaidFlowDiagram } from '@/api/modules/recording/types';

const baseBlock = (overrides: Partial<DecisionPageBlock> = {}): DecisionPageBlock => ({
  id: overrides.id || 'b1',
  type: overrides.type || 'section',
  importance: 0,
  source_unit_ids: [],
  variant: 'neutral',
  data: overrides.data || {},
  ...overrides,
})

describe('新增 block 类型烟测', () => {
  it('key_points:渲染编号 + title/content', () => {
    const block = baseBlock({
      type: 'key_points',
      data: {
        eyebrow: '要点',
        title: '本次会议要点',
        items: [
          { title: '营收模式', content: '先验证订阅意愿，再扩展产品' },
          { title: '组织能力', content: '需要增设增长负责人' },
        ],
      },
    })
    const { container } = render(<>{renderBlock(block, 0)}</>)
    expect(container.querySelector('.insight-key-points')).not.toBeNull()
    const items = container.querySelectorAll('.key-point-item')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('营收模式')
    expect(items[0].textContent).toContain('订阅意愿')
    expect(items[1].querySelector('.key-point-bullet')?.textContent).toBe('2')
  })

  it('long_analysis:有 sections 时按分段渲染', () => {
    const block = baseBlock({
      type: 'long_analysis',
      data: {
        title: '战略分析',
        intro: '整体趋势向好',
        sections: [
          { label: '市场', content: '赛道宽广但同质化严重' },
          { label: '组织', content: '需要 30 人扩到 80 人' },
        ],
      },
    })
    const { container } = render(<>{renderBlock(block, 0)}</>)
    const sections = container.querySelectorAll('.la-section')
    expect(sections).toHaveLength(2)
    expect(sections[0].querySelector('.la-section-label')?.textContent).toBe('市场')
    expect(sections[1].querySelector('.la-section-body')?.textContent).toContain('80 人')
  })

  it('long_analysis:无 sections 时回退到 content 渲染', () => {
    const block = baseBlock({
      type: 'long_analysis',
      data: { title: '补充', content: '这段没有分段' },
    })
    const { container } = render(<>{renderBlock(block, 0)}</>)
    expect(container.querySelectorAll('.la-section')).toHaveLength(0)
    expect(container.querySelector('.la-section-body')?.textContent).toContain('没有分段')
  })

  it('insight_stack:多张洞察卡', () => {
    const block = baseBlock({
      type: 'insight_stack',
      data: {
        title: '三条洞察',
        items: [
          { title: 'A', content: '原因一' },
          { title: 'B', content: '原因二' },
          { title: '', content: '无标题项' },
        ],
      },
    })
    const { container } = render(<>{renderBlock(block, 0)}</>)
    const stack = container.querySelector('.insight-insight-stack')
    expect(stack).not.toBeNull()
    const items = container.querySelectorAll('.stack-item')
    expect(items).toHaveLength(3)
    expect(items[2].querySelector('.stack-item-title')?.textContent).toBeFalsy()
    expect(items[2].textContent).toContain('无标题项')
  })

  it('breakthrough:破局点 + cta', () => {
    const block = baseBlock({
      type: 'breakthrough',
      data: {
        eyebrow: '破局点',
        headline: '优先做增量订阅',
        content: '把核心资源倾斜到边际成本最低的 SKU',
        cta: '本周内出方案',
      },
    })
    const { container } = render(<>{renderBlock(block, 0)}</>)
    expect(container.querySelector('.insight-breakthrough')).not.toBeNull()
    expect(container.querySelector('h3')?.textContent).toBe('优先做增量订阅')
    expect(container.querySelector('.breakthrough-content')?.textContent).toContain('SKU')
    expect(container.querySelector('.breakthrough-foot')?.textContent).toContain('本周内出方案')
  })

  it('callout:variant=warning/info/danger 三档样式生效', () => {
    const baseData = { title: '标题', content: '正文' }
    const variants = ['warning', 'info', 'danger']
    for (const v of variants) {
      const block = baseBlock({
        type: 'callout',
        data: { ...baseData, variant: v, label: v },
      })
      const { container } = render(<>{renderBlock(block, 0)}</>)
      const el = container.querySelector('.insight-callout')
      expect(el?.classList.contains(v)).toBe(true)
    }
  })

  it('callout:缺省 variant 走中性样式（不带任何 variant class）', () => {
    const block = baseBlock({
      type: 'callout',
      data: { title: '标题', content: '正文' },
    })
    const { container } = render(<>{renderBlock(block, 0)}</>)
    const el = container.querySelector('.insight-callout')
    expect(el?.className).toBe('insight-card insight-callout')
  })
})

describe('flow_diagram mermaid-flow.v1', () => {
  const sampleDiagram: MermaidFlowDiagram = {
    direction: 'TB',
    nodes: [
      { id: 'A', title: '需求发散', content: '流程不标准', tone: 'neutral', rank: 0 },
      { id: 'B', title: '定制抽取层', content: '消耗研发工时', tone: 'warning', rank: 1 },
      { id: 'C', title: '管控缺位', content: '规则失效', tone: 'critical', rank: 1 },
      { id: 'D', title: '后果', content: '线上事故', tone: 'critical', rank: 2 },
    ],
    edges: [
      { from: 'A', to: 'B', label: '推动' },
      { from: 'A', to: 'C', label: '允许' },
      { from: 'B', to: 'D', label: '' },
      { from: 'C', to: 'D', label: '' },
    ],
  }

  it('data.diagram 存在时：渲染 SVG 边层 + HTML 节点卡片,且节点数 = diagram.nodes.length', () => {
    const block = baseBlock({
      type: 'flow_diagram',
      data: { eyebrow: '因果链', title: '推演路径', diagram: sampleDiagram },
    })
    const { container } = render(<>{renderBlock(block, 0)}</>)
    const svg = container.querySelector('.insight-mermaid-flow svg')
    expect(svg).not.toBeNull()
    // 新结构（仿 meeting-recorder）：节点是 HTML <article> 卡片，边走 SVG <path marker-end>
    // 4 节点 → 4 张 .insight-flow-node article
    expect(container.querySelectorAll('.insight-mermaid-flow .insight-flow-node')).toHaveLength(4)
    // 4 条边 → 4 个带箭头的 <path>
    expect(container.querySelectorAll('.insight-mermaid-flow svg path[marker-end]')).toHaveLength(4)
    // 边标签：2 条带 label 的边 → 2 个 <text class="insight-flow-edge-label">
    expect(container.querySelectorAll('.insight-flow-edge-label')).toHaveLength(2)
  })

  it('没有 data.diagram 时：fallback 到 items（兼容 {title,content} 形状）', () => {
    const block = baseBlock({
      type: 'flow_diagram',
      data: {
        eyebrow: '因果链',
        title: '推演路径',
        items: [
          { title: 'A', content: '原因一' },
          { title: 'B', content: '原因二' },
        ],
      },
    })
    const { container } = render(<>{renderBlock(block, 0)}</>)
    expect(container.querySelector('.insight-mermaid-flow')).toBeNull()
    expect(container.querySelector('.insight-flow')).not.toBeNull()
    const nodes = container.querySelectorAll('.insight-flow-node')
    expect(nodes).toHaveLength(2)
  })

  it('items 用 {label,description} 旧形状也能被 normalizeItems 解析', () => {
    const block = baseBlock({
      type: 'flow_diagram',
      data: {
        eyebrow: '因果链',
        title: '推演路径',
        items: [
          { label: 'A', description: '原因一' },
          { label: 'B', description: '原因二' },
        ],
      },
    })
    const { container } = render(<>{renderBlock(block, 0)}</>)
    const nodes = container.querySelectorAll('.insight-flow-node')
    expect(nodes).toHaveLength(2)
    expect(nodes[0].textContent).toContain('原因一')
  })
})