/**
 * mermaidDiagramRenderer 渲染冒烟测试
 *
 * 只验证"结构化数据 → 可见 DOM"这一层：
 * 具体像素排版由布局常量决定，不做像素断言（否则调样式就会红一片）。
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MermaidDiagram } from './mermaidDiagramRenderer'
import { parseMermaidDiagram } from './mermaidDiagramParser'

/** 解析并渲染，返回 container；解析失败直接让测试失败 */
function renderSource(source: string) {
  const parsed = parseMermaidDiagram(source)
  expect(parsed).not.toBeNull()
  return render(<MermaidDiagram diagram={parsed!} />).container
}

describe('MermaidDiagram — sequence', () => {
  const container = () =>
    renderSource([
      'sequenceDiagram',
      'participant A as 用户',
      'participant B as 服务端',
      'A->>B: 提交请求',
      'B-->>A: 返回结果',
      'Note over A,B: 双方确认',
      'loop 每分钟',
      'A->>A: 自检',
      'end',
    ].join('\n'))

  it('画出参与者头部与消息文本', () => {
    const c = container()
    expect(c.querySelector('.insight-mermaid-sequence svg')).not.toBeNull()
    expect(c.textContent).toContain('用户')
    expect(c.textContent).toContain('服务端')
    expect(c.textContent).toContain('提交请求')
    expect(c.textContent).toContain('返回结果')
  })

  it('备注与分组标签一起渲染', () => {
    const c = container()
    expect(c.textContent).toContain('双方确认')
    expect(c.textContent).toContain('LOOP')
  })

  it('虚线消息使用 strokeDasharray', () => {
    const c = container()
    const dashed = Array.from(c.querySelectorAll('line')).filter(
      l => l.getAttribute('stroke-dasharray') === '5 4',
    )
    expect(dashed.length).toBeGreaterThan(0)
  })

  it('自环消息画成折线 path', () => {
    const c = container()
    expect(c.querySelectorAll('path').length).toBeGreaterThan(0)
    expect(c.textContent).toContain('自检')
  })
})

describe('MermaidDiagram — pie', () => {
  it('每个分片一个扇形 + 图例显示百分比', () => {
    const c = renderSource('pie title 时间分配\n"编码" : 50\n"会议" : 30\n"其它" : 20')
    expect(c.querySelector('.insight-mermaid-pie-title')?.textContent).toBe('时间分配')
    expect(c.querySelectorAll('.insight-mermaid-pie-legend li')).toHaveLength(3)
    expect(c.querySelectorAll('svg path')).toHaveLength(3)
    expect(c.textContent).toContain('50.0%')
  })

  it('showData 时同时显示原始数值', () => {
    const c = renderSource('pie showData\n"a" : 1\n"b" : 3')
    expect(c.textContent).toContain('1 · 25.0%')
  })

  it('单一分片占满整圆时画 circle 而不是 arc', () => {
    const c = renderSource('pie\n"唯一" : 10')
    expect(c.querySelectorAll('svg circle')).toHaveLength(1)
    expect(c.querySelectorAll('svg path')).toHaveLength(0)
  })
})

describe('MermaidDiagram — gantt', () => {
  it('section / 任务名 / 日期区间都渲染出来', () => {
    const c = renderSource([
      'gantt',
      'title 项目排期',
      'dateFormat YYYY-MM-DD',
      'section 设计',
      '需求梳理 :a1, 2024-01-01, 5d',
      '原型 :after a1, 3d',
    ].join('\n'))
    expect(c.querySelector('.insight-mermaid-gantt-title')?.textContent).toBe('项目排期')
    expect(c.querySelector('.insight-mermaid-gantt-section-name')?.textContent).toBe('设计')
    expect(c.querySelectorAll('.insight-mermaid-gantt-row')).toHaveLength(2)
    expect(c.textContent).toContain('需求梳理')
    expect(c.textContent).toContain('2024-01-01')
  })

  it('crit / done 状态映射到不同 class', () => {
    const c = renderSource([
      'gantt',
      'section s',
      '已完成 :done, 2024-01-01, 1d',
      '关键 :crit, 2024-01-02, 1d',
      '上线 :milestone, 2024-01-05, 0d',
    ].join('\n'))
    expect(c.querySelector('.insight-mermaid-gantt-bar.is-done')).not.toBeNull()
    expect(c.querySelector('.insight-mermaid-gantt-bar.is-crit')).not.toBeNull()
    expect(c.querySelector('.insight-mermaid-gantt-bar.is-milestone')).not.toBeNull()
  })
})

describe('MermaidDiagram — timeline', () => {
  it('分组、时间点与事件条目都渲染', () => {
    const c = renderSource([
      'timeline',
      'title 产品演进',
      'section 起步期',
      '2021 : 立项 : 原型',
      'section 增长期',
      '2023 : 商业化',
    ].join('\n'))
    expect(c.querySelector('.insight-mermaid-timeline-title')?.textContent).toBe('产品演进')
    expect(c.querySelectorAll('.insight-mermaid-timeline-section')).toHaveLength(2)
    expect(c.querySelectorAll('.insight-mermaid-timeline-event')).toHaveLength(2)
    expect(c.querySelectorAll('.insight-mermaid-timeline-item')).toHaveLength(3)
    expect(c.textContent).toContain('2021')
    expect(c.textContent).toContain('商业化')
  })
})

describe('MermaidDiagram — flow 家族复用流程图渲染器', () => {
  it('stateDiagram 走 MermaidFlowRenderer', () => {
    const c = renderSource('stateDiagram-v2\n[*] --> 待处理\n待处理 --> 处理中 : 领取')
    expect(c.querySelector('.insight-mermaid-flow svg')).not.toBeNull()
    expect(c.textContent).toContain('待处理')
    expect(c.textContent).toContain('领取')
  })

  it('classDiagram 走 MermaidFlowRenderer', () => {
    const c = renderSource('classDiagram\nAnimal <|-- Duck\nAnimal : +int age')
    expect(c.querySelector('.insight-mermaid-flow svg')).not.toBeNull()
    expect(c.textContent).toContain('Animal')
    expect(c.textContent).toContain('Duck')
  })

  it('mindmap 走 MermaidFlowRenderer（LR）', () => {
    const c = renderSource('mindmap\n  root((知识库))\n    来源\n    应用')
    expect(c.querySelector('.insight-mermaid-flow svg')).not.toBeNull()
    expect(c.textContent).toContain('知识库')
    expect(c.textContent).toContain('来源')
  })
})

describe('MermaidDiagram — viewport wrapper & overflow guards', () => {
  it('每个方言都包了一层 .insight-mermaid-viewport 提供横向滚动', () => {
    const sources: Array<[string, string]> = [
      ['flowchart TB\nA-->B', '.insight-mermaid-flow'],
      ['sequenceDiagram\nA->>B: hi', '.insight-mermaid-sequence'],
      ['pie\n"a":1\n"b":2', '.insight-mermaid-pie'],
      ['gantt\nsection s\nt :a, 2024-01-01, 1d', '.insight-mermaid-gantt'],
      ['timeline\ntitle t\n2024 : x', '.insight-mermaid-timeline'],
    ]
    for (const [src, innerCls] of sources) {
      const c = renderSource(src)
      const viewports = c.querySelectorAll('.insight-mermaid-viewport')
      expect(viewports.length).toBeGreaterThan(0)
      // viewport 之内必须是方言特定的容器
      expect(viewports[0].querySelector(innerCls)).not.toBeNull()
    }
  })

  it('长标签仍能渲染（截断/换行兜底）', () => {
    const c = renderSource(
      'sequenceDiagram\nparticipant A as 这是一个非常长的参与者名称用来测试截断行为\nA->>B: 一段很长的消息文本用来测试溢出处理应当被合理截断并保留 tooltip',
    )
    expect(c.textContent).toContain('非常长的参与者')
    // 完整文本以 SVG <title> 子节点形式兜底存在（参与者名 + 消息文本）
    const titles = c.querySelectorAll('svg title')
    const titleTexts = Array.from(titles).map(t => t.textContent || '').join('|')
    expect(titleTexts).toContain('非常长的参与者名称')
    expect(titleTexts).toContain('很长的消息文本')
  })

  it('饼图扇区带 SVG <title> 悬浮提示', () => {
    const c = renderSource('pie\n"代码评审": 40\n"联调测试": 30\n"其它": 30')
    const titles = c.querySelectorAll('svg title')
    const joined = Array.from(titles).map(t => t.textContent || '').join('|')
    expect(joined).toContain('代码评审')
    expect(joined).toMatch(/\d+\.\d+/)
  })

  it('甘特图长任务名允许换行而不是被砍掉', () => {
    const c = renderSource(
      'gantt\ntitle 项目排期\nsection 设计\n一个非常非常长的任务名称用来测试换行处理 :a1, 2024-01-01, 5d',
    )
    const label = c.querySelector('.insight-mermaid-gantt-label')
    expect(label?.textContent).toContain('一个非常非常长的任务名称')
  })
})
