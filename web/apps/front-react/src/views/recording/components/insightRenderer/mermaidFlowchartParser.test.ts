/**
 * mermaidFlowchartParser.ts 解析器测试
 *
 * 覆盖：方向解析、节点 shape、tone、classDef、连接（含链式/多源/label）、
 * rank 分配、未知语法抛出错误。
 */
import { describe, expect, it } from 'vitest'
import {
  isMermaidFlowchart,
  parseMermaidFlowchart,
} from './mermaidFlowchartParser'

describe('isMermaidFlowchart', () => {
  it('识别 flowchart TB / LR / TD / BT / RL（不区分大小写）', () => {
    expect(isMermaidFlowchart('flowchart TB\nA-->B')).toBe(true)
    expect(isMermaidFlowchart('flowchart LR\nA-->B')).toBe(true)
    expect(isMermaidFlowchart('flowchart td\nA-->B')).toBe(true)
    expect(isMermaidFlowchart('FLOWCHART tb\nA-->B')).toBe(true)
  })

  it('第一行是注释（%%）时跳过注释识别 header', () => {
    expect(isMermaidFlowchart('%% 注释\nflowchart TB\nA-->B')).toBe(true)
  })

  it('非 flowchart 类型（sequenceDiagram / classDiagram）返回 false', () => {
    expect(isMermaidFlowchart('sequenceDiagram\nA->>B: hi')).toBe(false)
    expect(isMermaidFlowchart('classDiagram\nclass A')).toBe(false)
  })

  it('空 / 无效输入返回 false，不抛错', () => {
    expect(isMermaidFlowchart('')).toBe(false)
    expect(isMermaidFlowchart('flowchart')).toBe(false)
    expect(isMermaidFlowchart('flowchart XY')).toBe(false)
  })
})

describe('parseMermaidFlowchart — 节点解析', () => {
  it('矩形节点 A["text"] 解析为 title + neutral', () => {
    const d = parseMermaidFlowchart(`flowchart TB\nA["开始节点"]`)
    expect(d.direction).toBe('TB')
    expect(d.nodes).toHaveLength(1)
    expect(d.nodes[0]).toMatchObject({ id: 'A', title: '开始节点', tone: 'neutral' })
  })

  it(':::tone 后缀映射到节点 tone（info / positive / warning / danger / critical / pending）', () => {
    const src = [
      'flowchart TB',
      'A:::info',
      'B["成功"]:::positive',
      'C["警告"]:::warning',
      'D["危险"]:::danger',
      'E["严重"]:::critical',
      'F["待定"]:::pending',
      'A-->B',
      'B-->C',
      'C-->D',
      'D-->E',
      'E-->F',
    ].join('\n')
    const d = parseMermaidFlowchart(src)
    expect(d.nodes.map(n => [n.id, n.tone])).toEqual([
      ['A', 'info'],
      ['B', 'positive'],
      ['C', 'warning'],
      ['D', 'danger'],
      ['E', 'critical'],
      ['F', 'pending'],
    ])
  })

  it('未知 tone 后缀降级为 neutral', () => {
    const d = parseMermaidFlowchart(`flowchart TB\nA["x"]:::myCustomClass`)
    expect(d.nodes[0].tone).toBe('neutral')
    expect(d.nodes[0].title).toBe('x')
  })

  it('圆角/菱形/圆柱/圆形 shape 都被识别', () => {
    const d = parseMermaidFlowchart([
      'flowchart TB',
      'A([圆角])',
      'B{菱形}',
      'C[[梯形]]',
      'D[(圆柱)]',
      'E((圆形))',
    ].join('\n'))
    expect(d.nodes.map(n => n.title)).toEqual(['圆角', '菱形', '梯形', '圆柱', '圆形'])
  })

  it('只出现在边里、没显式定义的节点被自动建出（id 即 title）', () => {
    const d = parseMermaidFlowchart(`flowchart TB\nA-->B`)
    expect(d.nodes.map(n => n.id).sort()).toEqual(['A', 'B'])
    expect(d.nodes.find(n => n.id === 'A')?.title).toBe('A')
  })

  it('classDef myClass + class A myClass → 把 tone 套到节点上（颜色被忽略）', () => {
    const d = parseMermaidFlowchart([
      'flowchart TB',
      'classDef highlight fill:#fef3c7,stroke:#f59e0b',
      'A["主要节点"]',
      'class A highlight',
      'A-->B',
    ].join('\n'))
    expect(d.nodes.find(n => n.id === 'A')?.tone).toBe('neutral') // 未知 class → neutral
    expect(d.nodes.find(n => n.id === 'A')?.title).toBe('主要节点')
  })

  it('class A,B toneName 同时给多个节点套 tone', () => {
    const d = parseMermaidFlowchart([
      'flowchart TB',
      'classDef danger fill:#fef2f2,stroke:#ef4444',
      'A',
      'B',
      'class A,B danger',
      'A-->B',
    ].join('\n'))
    expect(d.nodes.find(n => n.id === 'A')?.tone).toBe('danger')
    expect(d.nodes.find(n => n.id === 'B')?.tone).toBe('danger')
  })
})

describe('parseMermaidFlowchart — 连接解析', () => {
  it('A --> B 单条边，rank 0→1', () => {
    const d = parseMermaidFlowchart(`flowchart TB\nA-->B`)
    expect(d.edges).toEqual([{ from: 'A', to: 'B', label: '' }])
    expect(d.nodes.find(n => n.id === 'A')?.rank).toBe(0)
    expect(d.nodes.find(n => n.id === 'B')?.rank).toBe(1)
  })

  it('A -->|label| B 带文本标签', () => {
    const d = parseMermaidFlowchart(`flowchart TB\nA-->|推动|B`)
    expect(d.edges).toEqual([{ from: 'A', to: 'B', label: '推动' }])
  })

  it('A & B --> C 多源拆成 2 条边', () => {
    const d = parseMermaidFlowchart(`flowchart TB\nA & B --> C`)
    expect(d.edges).toHaveLength(2)
    expect(d.edges).toContainEqual({ from: 'A', to: 'C', label: '' })
    expect(d.edges).toContainEqual({ from: 'B', to: 'C', label: '' })
  })

  it('A --> B --> C 链式拆成 2 条边（A→B、B→C）', () => {
    const d = parseMermaidFlowchart(`flowchart TB\nA --> B --> C`)
    expect(d.edges).toEqual([
      { from: 'A', to: 'B', label: '' },
      { from: 'B', to: 'C', label: '' },
    ])
  })

  it('A & B --> C --> D 多源 + 链式 → 4 条边（label 只作用于紧邻段）', () => {
    const d = parseMermaidFlowchart(`flowchart TB\nA & B -->|共建| C --> D`)
    expect(d.edges).toHaveLength(3)
    expect(d.edges.filter(e => e.label === '共建')).toHaveLength(2)
    expect(d.edges).toContainEqual({ from: 'C', to: 'D', label: '' })
  })

  it('用户给的真实例子：完整 6 节点链式因果图', () => {
    const src = [
      'flowchart TB',
      'A["认知框架降维 | 关老师用更高级的第一性原理，论证选词是唯一捷径"]:::info',
      'B["建立信任人设 | 痛批其他全自动获客骗局，塑造"唯一清醒者"形象"]:::positive',
      'C["工具价值过度聚焦 | 无限放大解决"没词"的锤子，弱化体系化难题"]:::neutral',
      'D["制造执行幻觉 | 企业主误以为买了工具就等于解决了获客"]:::warning',
      'E["组织真相暴露 | 无人、无体系、无持续产出能力的短板显现"]:::danger',
      'F["系统性挫败 | 账号沉寂，工具卸载，结论：没用"]:::critical',
      'A & B --> C --> D --> E --> F',
    ].join('\n')
    const d = parseMermaidFlowchart(src)
    expect(d.direction).toBe('TB')
    expect(d.nodes).toHaveLength(6)
    // 节点 tone 对应原 :::tone 后缀
    const tones = Object.fromEntries(d.nodes.map(n => [n.id, n.tone]))
    expect(tones).toEqual({
      A: 'info',
      B: 'positive',
      C: 'neutral',
      D: 'warning',
      E: 'danger',
      F: 'critical',
    })
    // ranks：A、B rank=0；C rank=1；D rank=2；E rank=3；F rank=4
    expect(d.nodes.map(n => [n.id, n.rank])).toEqual([
      ['A', 0],
      ['B', 0],
      ['C', 1],
      ['D', 2],
      ['E', 3],
      ['F', 4],
    ])
    // edges：A & B -> C, C -> D, D -> E, E -> F 共 5 条边
    expect(d.edges).toHaveLength(5)
  })
})

describe('parseMermaidFlowchart — 异常输入', () => {
  it('非 flowchart 头抛错', () => {
    expect(() => parseMermaidFlowchart(`sequenceDiagram\nA->>B`)).toThrow(/unsupported mermaid header/)
  })

  it('空源码抛错', () => {
    expect(() => parseMermaidFlowchart('')).toThrow()
    expect(() => parseMermaidFlowchart('\n\n\n')).toThrow()
  })

  it('没有节点定义抛错（只有边但没有节点 id 解析）', () => {
    // 这里所有行都被识别为边，但边里的 id 会被自动建节点；测试"完全没节点"的极端情况
    expect(() => parseMermaidFlowchart('flowchart TB\n%% 纯注释\n%% 没有节点')).toThrow(/no nodes parsed/)
  })
})

describe('parseMermaidFlowchart — 健壮性', () => {
  it('容忍 \r\n 行尾', () => {
    const d = parseMermaidFlowchart('flowchart TB\r\nA["x"]\r\nA-->B\r\n')
    expect(d.nodes).toHaveLength(2)
    expect(d.edges).toHaveLength(1)
  })

  it('省略方向的 flowchart 默认走 TB（header 仍必须是 flowchart + 方向）', () => {
    expect(() => parseMermaidFlowchart('flowchart\nA-->B')).toThrow()
  })

  it('LR 方向：rank 沿 X 轴展开', () => {
    const d = parseMermaidFlowchart(`flowchart LR\nA-->B-->C`)
    expect(d.direction).toBe('LR')
    expect(d.nodes.map(n => [n.id, n.rank])).toEqual([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ])
  })
})