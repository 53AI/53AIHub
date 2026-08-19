/**
 * mermaidDiagramParser / mermaidGraphParsers 测试
 *
 * 覆盖：方言识别、sequence/pie/gantt/timeline 解析、
 * state/class/mindmap → MermaidFlowDiagram 归一化、失败降级。
 */
import { describe, expect, it } from 'vitest'
import {
  detectMermaidType,
  parseGanttDiagram,
  parseMermaidDiagram,
  parsePieChart,
  parseSequenceDiagram,
  parseTimelineDiagram,
} from './mermaidDiagramParser'
import { parseClassDiagram, parseMindmap, parseStateDiagram } from './mermaidGraphParsers'

describe('detectMermaidType', () => {
  it('识别各方言头部（不区分大小写、跳过注释）', () => {
    expect(detectMermaidType('flowchart TB\nA-->B')).toBe('flowchart')
    expect(detectMermaidType('graph LR\nA-->B')).toBe('flowchart')
    expect(detectMermaidType('sequenceDiagram\nA->>B: hi')).toBe('sequence')
    expect(detectMermaidType('pie showData\n"a" : 1')).toBe('pie')
    expect(detectMermaidType('gantt\ntitle x')).toBe('gantt')
    expect(detectMermaidType('timeline\ntitle x')).toBe('timeline')
    expect(detectMermaidType('stateDiagram-v2\n[*] --> A')).toBe('state')
    expect(detectMermaidType('classDiagram\nA <|-- B')).toBe('class')
    expect(detectMermaidType('mindmap\n  root((x))')).toBe('mindmap')
    expect(detectMermaidType('%% 注释\nSEQUENCEDIAGRAM\nA->>B: hi')).toBe('sequence')
  })

  it('未知方言返回 unknown', () => {
    expect(detectMermaidType('erDiagram\nA ||--o{ B : has')).toBe('unknown')
    expect(detectMermaidType('')).toBe('unknown')
  })
})

describe('parseSequenceDiagram', () => {
  it('解析参与者、消息与虚线箭头', () => {
    const d = parseSequenceDiagram([
      'sequenceDiagram',
      'participant A as 用户',
      'participant B as 服务端',
      'A->>B: 提交请求',
      'B-->>A: 返回结果',
    ].join('\n'))
    expect(d.kind).toBe('sequence')
    expect(d.participants.map(p => [p.id, p.label])).toEqual([['A', '用户'], ['B', '服务端']])
    expect(d.items).toHaveLength(2)
    expect(d.items[0]).toMatchObject({ kind: 'message', from: 'A', to: 'B', text: '提交请求', dashed: false })
    expect(d.items[1]).toMatchObject({ kind: 'message', dashed: true })
  })

  it('未声明的参与者按出现顺序自动建出', () => {
    const d = parseSequenceDiagram('sequenceDiagram\nAlice->>Bob: hi\nBob->>Carol: hey')
    expect(d.participants.map(p => p.id)).toEqual(['Alice', 'Bob', 'Carol'])
  })

  it('autonumber 给消息编号', () => {
    const d = parseSequenceDiagram('sequenceDiagram\nautonumber\nA->>B: x\nB->>A: y')
    expect(d.items.map(i => (i.kind === 'message' ? i.index : -1))).toEqual([1, 2])
  })

  it('note / loop / alt 被保留为独立条目', () => {
    const d = parseSequenceDiagram([
      'sequenceDiagram',
      'A->>B: x',
      'Note over A,B: 双方确认',
      'loop 每分钟',
      'A->>B: ping',
      'end',
      'alt 成功',
      'B-->>A: ok',
      'end',
    ].join('\n'))
    const kinds = d.items.map(i => i.kind)
    expect(kinds).toEqual(['message', 'note', 'group', 'message', 'group', 'message'])
    const note = d.items[1]
    expect(note).toMatchObject({ kind: 'note', placement: 'over', targets: ['A', 'B'], text: '双方确认' })
    expect(d.items[2]).toMatchObject({ kind: 'group', keyword: 'loop', label: '每分钟' })
  })

  it('activate/deactivate 等控制语句被忽略', () => {
    const d = parseSequenceDiagram('sequenceDiagram\nA->>B: x\nactivate B\ndeactivate B')
    expect(d.items).toHaveLength(1)
  })

  it('自环消息（A->>A）保留', () => {
    const d = parseSequenceDiagram('sequenceDiagram\nA->>A: 自检')
    expect(d.items[0]).toMatchObject({ from: 'A', to: 'A', text: '自检' })
  })

  it('没有参与者时抛错', () => {
    expect(() => parseSequenceDiagram('sequenceDiagram\n%% 空图')).toThrow()
  })
})

describe('parsePieChart', () => {
  it('解析标题、分片与总量', () => {
    const d = parsePieChart([
      'pie title 时间分配',
      '"编码" : 50',
      '"会议" : 30',
      '"其它" : 20',
    ].join('\n'))
    expect(d.title).toBe('时间分配')
    expect(d.total).toBe(100)
    expect(d.slices).toEqual([
      { label: '编码', value: 50 },
      { label: '会议', value: 30 },
      { label: '其它', value: 20 },
    ])
  })

  it('showData 标记与独立 title 行', () => {
    const d = parsePieChart('pie showData\ntitle 占比\n"a" : 1\n"b" : 3')
    expect(d.showData).toBe(true)
    expect(d.title).toBe('占比')
    expect(d.total).toBe(4)
  })

  it('无引号标签也能解析', () => {
    const d = parsePieChart('pie\n编码 : 2\n会议 : 8')
    expect(d.slices.map(s => s.label)).toEqual(['编码', '会议'])
  })

  it('没有有效分片时抛错', () => {
    expect(() => parsePieChart('pie\ntitle 空')).toThrow()
    expect(() => parsePieChart('pie\n"a" : 0')).toThrow(/zero/)
  })
})

describe('parseGanttDiagram', () => {
  it('解析 section / 任务 / 日期与时长', () => {
    const d = parseGanttDiagram([
      'gantt',
      'title 项目排期',
      'dateFormat YYYY-MM-DD',
      'section 设计',
      '需求梳理 :a1, 2024-01-01, 5d',
      '原型 :after a1, 3d',
      'section 开发',
      '联调 :crit, 2024-01-10, 2024-01-15',
    ].join('\n'))
    expect(d.title).toBe('项目排期')
    expect(d.hasDates).toBe(true)
    expect(d.sections.map(s => s.name)).toEqual(['设计', '开发'])
    const [first, second] = d.sections[0].tasks
    expect(first.name).toBe('需求梳理')
    expect(second.start).toBe(first.end) // after a1
    expect(second.end - second.start).toBe(3)
    expect(d.sections[1].tasks[0].status).toBe('crit')
  })

  it('milestone 标记被识别', () => {
    const d = parseGanttDiagram('gantt\nsection s\n上线 :milestone, 2024-02-01, 0d')
    expect(d.sections[0].tasks[0].status).toBe('milestone')
  })

  it('无日期时退化为顺序等宽排列，不抛错', () => {
    const d = parseGanttDiagram('gantt\nsection s\n任务一 :done, t1\n任务二 :t2')
    expect(d.hasDates).toBe(false)
    expect(d.sections[0].tasks).toHaveLength(2)
    expect(d.sections[0].tasks[1].start).toBeGreaterThanOrEqual(d.sections[0].tasks[0].end)
  })

  it('没有任务时抛错', () => {
    expect(() => parseGanttDiagram('gantt\ntitle 空排期')).toThrow()
  })
})

describe('parseTimelineDiagram', () => {
  it('解析 section 与多事件行', () => {
    const d = parseTimelineDiagram([
      'timeline',
      'title 产品演进',
      'section 起步期',
      '2021 : 立项 : 原型',
      '2022 : 内测',
      'section 增长期',
      '2023 : 商业化',
    ].join('\n'))
    expect(d.title).toBe('产品演进')
    expect(d.sections).toHaveLength(2)
    expect(d.sections[0].events[0]).toEqual({ time: '2021', items: ['立项', '原型'] })
    expect(d.sections[1].events[0]).toEqual({ time: '2023', items: ['商业化'] })
  })

  it('header 上的 title 与无 section 的事件都支持', () => {
    const d = parseTimelineDiagram('timeline title 简史\n2001 : A')
    expect(d.title).toBe('简史')
    expect(d.sections[0].name).toBe('')
    expect(d.sections[0].events).toHaveLength(1)
  })

  it('没有事件时抛错', () => {
    expect(() => parseTimelineDiagram('timeline\ntitle 空')).toThrow()
  })
})

describe('parseStateDiagram', () => {
  it('[*] 起止被转成开始/结束节点，转移带 label', () => {
    const d = parseStateDiagram([
      'stateDiagram-v2',
      '[*] --> 待处理',
      '待处理 --> 处理中 : 领取',
      '处理中 --> [*]',
    ].join('\n'))
    const titles = d.nodes.map(n => n.title)
    expect(titles).toContain('开始')
    expect(titles).toContain('结束')
    expect(d.edges.find(e => e.to === '处理中')?.label).toBe('领取')
  })

  it('state "描述" as id 用作节点标题', () => {
    const d = parseStateDiagram('stateDiagram-v2\nstate "等待审批" as s1\ns1 --> s2')
    expect(d.nodes.find(n => n.id === 's1')?.title).toBe('等待审批')
  })

  it('direction LR 生效', () => {
    const d = parseStateDiagram('stateDiagram-v2\ndirection LR\nA --> B')
    expect(d.direction).toBe('LR')
  })

  it('rank 沿转移递增', () => {
    const d = parseStateDiagram('stateDiagram-v2\nA --> B\nB --> C')
    expect(d.nodes.map(n => [n.id, n.rank])).toEqual([['A', 0], ['B', 1], ['C', 2]])
  })
})

describe('parseClassDiagram', () => {
  it('类名成节点，成员进 content，继承关系反向建边', () => {
    const d = parseClassDiagram([
      'classDiagram',
      'Animal <|-- Duck',
      'Animal : +int age',
      'class Duck {',
      '+swim()',
      '}',
    ].join('\n'))
    expect(d.nodes.map(n => n.id).sort()).toEqual(['Animal', 'Duck'])
    // <|-- 箭头指向左侧，边方向为 Duck → Animal
    expect(d.edges).toContainEqual({ from: 'Duck', to: 'Animal', label: '' })
    expect(d.nodes.find(n => n.id === 'Animal')?.content).toContain('+int age')
    expect(d.nodes.find(n => n.id === 'Duck')?.content).toContain('+swim()')
  })

  it('关联关系带标签、基数标注被忽略', () => {
    const d = parseClassDiagram('classDiagram\nCustomer "1" --> "*" Ticket : 拥有')
    expect(d.edges).toEqual([{ from: 'Customer', to: 'Ticket', label: '拥有' }])
  })

  it('没有类时抛错', () => {
    expect(() => parseClassDiagram('classDiagram\n%% 空')).toThrow()
  })
})

describe('parseMindmap', () => {
  it('缩进层级转成父子边，方向为 LR', () => {
    const d = parseMindmap([
      'mindmap',
      '  root((知识库))',
      '    来源',
      '      会议记录',
      '      文档',
      '    应用',
    ].join('\n'))
    expect(d.direction).toBe('LR')
    expect(d.nodes.map(n => n.title)).toEqual(['知识库', '来源', '会议记录', '文档', '应用'])
    // 根 rank=0，二级 rank=1，三级 rank=2
    expect(d.nodes.map(n => n.rank)).toEqual([0, 1, 2, 2, 1])
    expect(d.edges).toHaveLength(4)
  })

  it('各种节点外形（[]、()、{{}}、))(( ）都取内部文本', () => {
    const d = parseMindmap([
      'mindmap',
      '  root((中心))',
      '    [方形]',
      '    (圆角)',
      '    {{六边形}}',
      '    ))爆炸((',
    ].join('\n'))
    expect(d.nodes.map(n => n.title)).toEqual(['中心', '方形', '圆角', '六边形', '爆炸'])
  })

  it('::icon 装饰行被忽略', () => {
    const d = parseMindmap('mindmap\n  root((中心))\n    子节点\n    ::icon(fa fa-book)')
    expect(d.nodes).toHaveLength(2)
  })

  it('没有节点时抛错', () => {
    expect(() => parseMindmap('mindmap')).toThrow()
  })
})

describe('parseMermaidDiagram — 统一入口', () => {
  it('flowchart 归一化为 flow wrapper', () => {
    const parsed = parseMermaidDiagram('flowchart TB\nA["起点"]-->B')
    expect(parsed).toMatchObject({ kind: 'flow', dialect: 'flowchart' })
  })

  it('state / class / mindmap 也走 flow wrapper（复用流程图渲染器）', () => {
    expect(parseMermaidDiagram('stateDiagram-v2\n[*] --> A')).toMatchObject({ kind: 'flow', dialect: 'state' })
    expect(parseMermaidDiagram('classDiagram\nA <|-- B')).toMatchObject({ kind: 'flow', dialect: 'class' })
    expect(parseMermaidDiagram('mindmap\n  root((x))\n    y')).toMatchObject({ kind: 'flow', dialect: 'mindmap' })
  })

  it('sequence / pie / gantt / timeline 返回各自的 kind', () => {
    expect(parseMermaidDiagram('sequenceDiagram\nA->>B: x')?.kind).toBe('sequence')
    expect(parseMermaidDiagram('pie\n"a" : 1')?.kind).toBe('pie')
    expect(parseMermaidDiagram('gantt\nsection s\nt :2024-01-01, 1d')?.kind).toBe('gantt')
    expect(parseMermaidDiagram('timeline\n2001 : A')?.kind).toBe('timeline')
  })

  it('未支持方言 / 解析失败一律返回 null（调用方降级代码块）', () => {
    expect(parseMermaidDiagram('erDiagram\nA ||--o{ B : has')).toBeNull()
    expect(parseMermaidDiagram('sequenceDiagram')).toBeNull()
    expect(parseMermaidDiagram('')).toBeNull()
    expect(parseMermaidDiagram('随便一段文字')).toBeNull()
  })
})
