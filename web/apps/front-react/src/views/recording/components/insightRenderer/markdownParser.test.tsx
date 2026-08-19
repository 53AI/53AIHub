/**
 * markdownParser.ts 解析行为测试
 *
 * 重点验证：带 [脆弱假设] / [因果链] 等 flow_diagram 标记、
 * 但 body 内只有 - 列表项（无 ### 子标题）时，列表项不应被丢弃。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseInsightMarkdown, stripMarkdownCodeFence } from './markdownParser';
import { renderMarkdownText } from './richText';
import { renderBlock } from './blockRenderers';

/** 读取 insightRenderer/__fixtures__/test.md（接口真实返回的洞察样本） */
const REAL_FIXTURE_MD = readFileSync(
  resolve(__dirname, '__fixtures__/test.md'),
  'utf8',
)

/** 包裹一个完整的 markdown 文档（顶部带 # 标题），便于测试 ## 段落的解析 */
const wrap = (sectionBody: string) => ['# 会议纪要', '', sectionBody].join('\n')

describe('stripMarkdownCodeFence — 围栏代码块预处理', () => {
  it('去掉 ```markdown 围栏，让 # 标题能被识别', () => {
    const fenced = [
      '```markdown',
      '# 测试战役进入倒计时：时间表锁定，但数据与边缘用例仍是命门',
      '',
      '## [风险] 占位',
      '正文',
      '```',
    ].join('\n')
    expect(stripMarkdownCodeFence(fenced)).toBe(
      [
        '# 测试战役进入倒计时：时间表锁定，但数据与边缘用例仍是命门',
        '',
        '## [风险] 占位',
        '正文',
      ].join('\n'),
    )
  })

  it('也识别 ```md 和裸 ```（无语言标识）', () => {
    const mdFence = '```md\n# 标题\n\n正文\n```'
    const bareFence = '```\n# 标题\n\n正文\n```'
    expect(stripMarkdownCodeFence(mdFence)).toBe('# 标题\n\n正文')
    expect(stripMarkdownCodeFence(bareFence)).toBe('# 标题\n\n正文')
  })

  it('去掉围栏后 parseInsightMarkdown 能正确解析首行标题', () => {
    const fenced = '```markdown\n# 测试战役进入倒计时\n\n## [风险] 占位\n正文\n```'
    const { pageTitle, blocks } = parseInsightMarkdown(stripMarkdownCodeFence(fenced))
    expect(pageTitle).toBe('测试战役进入倒计时')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('risk_list')
  })

  it('没有围栏时原样返回（不误伤普通 markdown）', () => {
    const md = '# 标题\n\n## [风险] 占位\n正文'
    expect(stripMarkdownCodeFence(md)).toBe(md)
  })

  it('首尾有空白 / \\r\\n 时也能正确剥掉围栏', () => {
    const fenced = '  \n```markdown\r\n# 标题\r\n```\n  '
    expect(stripMarkdownCodeFence(fenced)).toBe('# 标题')
  })
})

describe('parseInsightMarkdown — flow_diagram 边界', () => {
  it('[脆弱假设] 含 - 列表（无 ### 子标题）渲染为 risk_list 卡片网格：前提→intro，论据→卡片，结论→outro', () => {
    const body = [
      '## [脆弱假设] 2+1+1模式的合规落地',
      '',
      '**假设：将学生放在校外由企业工程师授课+做项目，能通过教育部评估。**',
      '- 民办本科面临合格评估与五年审核评估，对培养方案、师资资质（高级职称教师比例）、过程性文件（教案、考勤、考核记录）要求极严',
      '- 双方均承认这是最大变量，但尚未找到可复制的解决方案',
      '- 若无法突破，则模式仅能适用于民办高职，或需提前一年修改培养方案报省教育厅审批',
      '',
      '**现状：** 该假设是合作能否走通的关键卡点，需通过具体院校的合规预沟通验证。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    // 无 ### 但有 - 列表 → 复用 risk_list 卡片网格样式，保留 [脆弱假设] eyebrow
    expect(block.type).toBe('risk_list')
    expect(block.data.eyebrow).toBe('脆弱假设')
    expect(block.data.title).toBe('2+1+1模式的合规落地')
    // 前提假设（列表前散文）→ intro
    expect(block.data.intro).toContain('**假设：')
    expect(block.data.intro).not.toContain('**现状：**')
    // 三条论据 → 卡片 items（无 **标题：** 模式，整段作为 title）
    expect(block.data.items).toHaveLength(3)
    expect(block.data.items[0].title).toContain('民办本科面临合格评估')
    expect(block.data.items[1].title).toContain('双方均承认这是最大变量')
    expect(block.data.items[2].title).toContain('若无法突破')
    // 结论（列表后散文）→ outro
    expect(block.data.outro).toContain('**现状：**')
    expect(block.data.outro).not.toContain('假设：')
  })

  it('[因果链] 含 ### 子标题时仍走 flow_diagram，保留原行为', () => {
    const body = [
      '## [因果链] 推导过程',
      '',
      '### 起点',
      '初始条件 A',
      '',
      '### 推演',
      '中间过程 B',
      '',
      '### 结果',
      '最终结论 C',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('flow_diagram')
    expect(block.data.eyebrow).toBe('因果链')
    expect(block.data.title).toBe('推导过程')
    expect(block.data.nodes).toHaveLength(3)
    expect(block.data.nodes[0]).toEqual({ label: '起点', description: '初始条件 A' })
    expect(block.data.nodes[1]).toEqual({ label: '推演', description: '中间过程 B' })
    expect(block.data.nodes[2]).toEqual({ label: '结果', description: '最终结论 C' })
  })

  it('[因果链] sub-section 描述文字不应同时出现在 intro 和 nodes（避免重复渲染）', () => {
    const body = [
      '## [因果链] 揭开"课程化描述"这个脆弱假设',
      '### 假设：按功能拆成课程名称就能体现价值',
      '当前标书将复杂的生产平台功能，简化为"60秒真人制作流程"之类的一门门课程。',
      '### 后果：主动为低价竞争者敞开大门',
      '广军老师点出关键："别人他低价就可以低价用掉了啊。"',
      '### 决策：反向操作，用生产复杂度构建控标参数',
      '标书行文重心将从"我们有什么课"转向"支撑这门课的系统有多复杂"。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('flow_diagram')
    expect(block.data.nodes).toHaveLength(3)
    // intro 必须为空（或只包含 sub-section 之外的散文），不能重复 nodes 的 description
    expect(block.data.intro).not.toContain('当前标书将复杂的生产平台功能')
    expect(block.data.intro).not.toContain('广军老师点出关键')
    expect(block.data.intro).not.toContain('标书行文重心将')
    // 但 description 应正确归属到对应 node
    expect(block.data.nodes[0].description).toContain('当前标书将复杂的生产平台功能')
    expect(block.data.nodes[1].description).toContain('广军老师点出关键')
    expect(block.data.nodes[2].description).toContain('标书行文重心将')
  })

  it('[因果链] 含 sub-section + sub-section 之前的 intro 散文时，intro 只保留散文部分', () => {
    const body = [
      '## [因果链] 推导过程',
      '',
      '先说明背景：这是一个测试。',
      '',
      '### 起点',
      '初始条件 A',
      '',
      '### 结果',
      '最终结论 C',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('flow_diagram')
    // intro 必须包含 sub-section 之前的散文
    expect(block.data.intro).toContain('先说明背景：这是一个测试。')
    // intro 不能重复 nodes 的 description
    expect(block.data.intro).not.toContain('初始条件 A')
    expect(block.data.intro).not.toContain('最终结论 C')
  })

  it('[脆弱假设] body 全为段落（无列表无子标题）时降级为 section', () => {
    const body = [
      '## [脆弱假设] 空内容',
      '',
      '**仅一个加粗段落。**',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].data.content).toContain('**仅一个加粗段落。**')
  })

  // ──────────────────────────────────────────────
  // ```mermaid 围栏识别
  // ──────────────────────────────────────────────

  it('[因果链] + ```mermaid flowchart TB：围栏保留在 content，由 renderMarkdownText 原地渲染', () => {
    // 之前会把 mermaid 抽走生成独立 flow_diagram block；
    // 改成不抽走后，围栏原样留在 section.content 里，渲染时由 renderMarkdownText 解析为 MermaidDiagram inline。
    // :::info / :::warning 后缀仍由 parseMermaidDiagram 正确解析（在渲染时发生）。
    const body = [
      '## [因果链] 认知降维如何导致工具吃灰',
      '',
      '```mermaid',
      'flowchart TB',
      '    A["认知降维"]:::info',
      '    B["执行幻觉"]:::warning',
      '    A --> B',
      '```',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    // flow_diagram case 没有 ### 子标题也不是列表 → 降级为 section
    expect(blocks[0].type).toBe('section')
    // 围栏源码完整保留在 content 里
    expect(blocks[0].data.content).toContain('```mermaid')
    expect(blocks[0].data.content).toContain('flowchart TB')
    expect(blocks[0].data.content).toContain(':::info')
    expect(blocks[0].data.content).toContain(':::warning')
  })

  it('[因果链] + ```mermaid flowchart LR：方向信息留在源码中，由渲染层处理', () => {
    const body = [
      '## [因果链] 横向推演',
      '',
      '```mermaid',
      'flowchart LR',
      '    X --> Y',
      '```',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].data.content).toContain('flowchart LR')
  })

  it('[因果链] + ```mermaid 时序图：sequenceDiagram 源码原样保留', () => {
    const body = [
      '## [因果链] 交互时序',
      '',
      '```mermaid',
      'sequenceDiagram',
      '    A->>B: hi',
      '```',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].data.content).toContain('sequenceDiagram')
    expect(blocks[0].data.content).toContain('A->>B: hi')
  })

  it('[因果链] + ```mermaid 未支持方言（erDiagram）：围栏同样原样保留，渲染时再决定兜底', () => {
    const body = [
      '## [因果链] 复杂图',
      '',
      '```mermaid',
      'erDiagram',
      '    CUSTOMER ||--o{ ORDER : places',
      '```',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    // content 仍包含 ```mermaid 围栏源码 → 由 renderMarkdownText 兜底为代码块
    expect(blocks[0].data.content).toContain('```mermaid')
    expect(blocks[0].data.content).toContain('erDiagram')
  })

  // ── 关键场景：mermaid 也可能出现在非 [因果链] 段（用户提醒） ──

  it('[风险] + ```mermaid：围栏留在 intro / outro 散文里，跟前后文字一起渲染', () => {
    // 之前会把 mermaid 抽走生成独立 flow_diagram block（导致图漂在 [风险] 卡片外面）。
    // 改成不抽走后，围栏留在 risk_list.intro 里，渲染时由 renderMarkdownText 原地解析为图，
    // 与前后散文一起在 risk_list 卡片内展示。
    const body = [
      '## [风险] 风险传导',
      '',
      '风险如何一步步放大：',
      '',
      '```mermaid',
      'flowchart TB',
      '    A["初始风险"]',
      '    B["传导"]',
      '    C["放大"]',
      '    A --> B --> C',
      '```',
      '',
      '**影响：** 三步放大导致业务连锁崩溃。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    // 单个 risk_list，mermaid 仍在 intro 字符串里（不再抽走）
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('risk_list')
    expect(blocks[0].data.eyebrow).toBe('风险')
    expect(blocks[0].data.intro).toContain('风险如何一步步放大')
    expect(blocks[0].data.intro).toContain('影响：')
    // 围栏源码原样保留：渲染时由 renderMarkdownText 处理
    expect(blocks[0].data.intro).toContain('```mermaid')
    expect(blocks[0].data.intro).toContain('flowchart TB')
    // 不再生成额外 flow_diagram block
    expect(blocks.filter(b => b.type === 'flow_diagram')).toHaveLength(0)
  })

  it('[行动] + ```mermaid：围栏留在 intro 字符串里，跟 items 一起渲染', () => {
    const body = [
      '## [行动] 行动流',
      '',
      '```mermaid',
      'flowchart TB',
      '    A["步骤 1"]',
      '    B["步骤 2"]',
      '    A --> B',
      '```',
      '',
      '- **负责人**：张三',
      '- **复核**：李四',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    // 单个 action_list；mermaid 留在 intro 里，items 不受影响
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('action_list')
    expect(blocks[0].data.items).toHaveLength(2)
    expect(blocks[0].data.items[0].title).toBe('负责人')
    expect(blocks[0].data.intro).toContain('```mermaid')
    expect(blocks[0].data.intro).toContain('flowchart TB')
    // 不再生成额外 flow_diagram block
    expect(blocks.filter(b => b.type === 'flow_diagram')).toHaveLength(0)
  })

  it('[因果链] 含多个 ```mermaid``` 围栏：全部留在 source.content 里，按出现顺序在卡片内 inline 渲染', () => {
    const body = [
      '## [因果链] 多个图',
      '',
      '```mermaid',
      'flowchart TB',
      '    A --> B',
      '```',
      '',
      '中间散文一段。',
      '',
      '```mermaid',
      'flowchart LR',
      '    X --> Y',
      '```',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    // 两个围栏都保留，按出现顺序留在 content
    const content = blocks[0].data.content as string
    const fences = content.match(/```mermaid/g) || []
    expect(fences).toHaveLength(2)
    expect(content).toContain('flowchart TB')
    expect(content).toContain('flowchart LR')
    expect(content).toContain('中间散文一段。')
    // 不再生成额外 flow_diagram block
    expect(blocks.filter(b => b.type === 'flow_diagram')).toHaveLength(0)
  })

  it('[脆弱假设] 散文 + mermaid + ### 子标题：围栏留在 intro，与 ### 后的 step 并列在 assumption_chain 卡片内', () => {
    // 用户实际场景：脆弱假设的引言段里嵌入 mermaid，### 子标题再展开一个对比表格。
    // 之前会被抽走成独立 flow_diagram block，漂在 assumption_chain 卡片外面；
    // 现在 mermaid 留在 intro，与 steps 一同渲染在 assumption_chain 卡片内。
    const body = [
      '## [脆弱假设] 记忆是双刃剑：生效成本极高，失效代价只需一次误判',
      '「减脂期点去酱汉堡」等 Showcase 细节动人，但隐含一个核心假设。',
      '',
      '```mermaid',
      'flowchart TB',
      '    A["用户行为碎片"]:::neutral',
      '    B["AI记忆调用"]:::info',
      '    A --> B',
      '    B --> C["意图一致"]:::positive',
      '    B --> D["意图错位"]:::danger',
      '```',
      '',
      '### 对比：传统工具与记忆 AI 的用户容忍度',
      '| 维度 | 传统 AI | 记忆 AI |',
      '| --- | --- | --- |',
      '| 容忍度 | 每次重说 | 出错即失望 |',
      '',
      '记忆让 AI 从「你告诉他」进化到「他理解你」。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    // 单个 assumption_chain：mermaid 在 intro，table + closing 在 steps[0].description
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('assumption_chain')
    // intro 包含 mermaid 围栏源码 + 引言散文
    expect(blocks[0].data.intro).toContain('Showcase 细节动人')
    expect(blocks[0].data.intro).toContain('```mermaid')
    expect(blocks[0].data.intro).toContain('flowchart TB')
    // steps[0].description 包含对比子标题下的表格 + 收尾散文
    expect(blocks[0].data.steps).toHaveLength(1)
    expect(blocks[0].data.steps[0].label).toContain('对比')
    expect(blocks[0].data.steps[0].description).toContain('容忍度')
    expect(blocks[0].data.steps[0].description).toContain('记忆让 AI')
    // 不再生成额外 flow_diagram block
    expect(blocks.filter(b => b.type === 'flow_diagram')).toHaveLength(0)
  })

  it('[脆弱假设] ### 子标题内的 ```mermaid：围栏留在 steps[].description 里', () => {
    // 回归：mermaid 常写在 ### 子标题下，解析后落在 steps[].description（嵌套字段）。
    // 早期实现只扫顶层字符串字段，导致图不渲染、源码泄漏在卡片正文里。
    // 现在保留源码在 steps[].description，渲染时由 renderMarkdownText 原地解析为图。
    const body = [
      '## [脆弱假设] 记忆的尺子与信任的台阶',
      '',
      '### 信任分级暗藏一步踏空的脆弱点',
      '从"全程确认"到"结果验收"的信任分级，逻辑自洽。',
      '',
      '```mermaid',
      'flowchart TB',
      '    A["信任分级机制 | 从全程确认到结果验收"]:::neutral',
      '    B["脆弱假设 | AI基础任务表现稳定"]:::pending',
      '    B --> A',
      '    A --> D["频繁出错"]:::warning',
      '    D --> E["信任破产 | 后续阶梯无人敢走"]:::danger',
      '```',
      '',
      '**信任一旦在起点破产，后面所有的阶梯都成了摆设**。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks.map(b => b.type)).toEqual(['assumption_chain'])
    const step = blocks[0].data.steps[0]
    // 围栏源码原样保留在 step.description 里
    expect(step.description).toContain('```mermaid')
    expect(step.description).toContain('flowchart TB')
    // 散文同样保留
    expect(step.description).toContain('逻辑自洽')
    expect(step.description).toContain('信任一旦在起点破产')
    // 不再生成额外 flow_diagram block
    expect(blocks.filter(b => b.type === 'flow_diagram')).toHaveLength(0)
  })

  it('[风险] items[].content 内的 ```mermaid：围栏留在 outro 散文里，跟标题一起渲染', () => {
    const body = [
      '## [风险] 列表内嵌图',
      '导语一句。',
      '',
      '- **交付风险**：排期紧张。',
      '',
      '```mermaid',
      'flowchart LR',
      '    X --> Y',
      '```',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('risk_list')
    // 围栏在 bullet 之后 → 落在 outro 字符串里（parseRiskListData 按位置切散文）
    expect(blocks[0].data.outro).toContain('```mermaid')
    expect(blocks[0].data.outro).toContain('flowchart LR')
    // 不再生成额外 flow_diagram block
    expect(blocks.filter(b => b.type === 'flow_diagram')).toHaveLength(0)
  })

  it('section 块（plain header）含 ```mermaid：围栏留在 section.content 里', () => {
    const body = [
      '## 通用说明',
      '',
      '```mermaid',
      'flowchart TB',
      '    A --> B',
      '```',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].data.content).toContain('```mermaid')
    expect(blocks[0].data.content).toContain('flowchart TB')
    // 不再生成额外 flow_diagram block
    expect(blocks.filter(b => b.type === 'flow_diagram')).toHaveLength(0)
  })

  it('[脆弱假设] 散文 + > 引用（无列表）→ section，引用渲染为带 insight-blockquote 样式的引用块', () => {
    const body = [
      '## [脆弱假设] 智谱品牌授权：整个蓝图的基石仍悬而未决',
      '目前整个计划卡在智谱内部流程的"最后一公里"，如果这一步无法走通，后续设想都是空中楼阁。',
      '',
      '> "上周我还问他了……销售嘛拉不通……他公司想做这个事必须得拉通。"',
      '',
      // 追加一节，确保上面那节不是最后一节（否则末尾 > 会被提取为 closing 块）
      '## [风险] 收尾占位',
      '占位正文。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    const block = blocks[0]
    expect(block.type).toBe('section')
    // content 保留 > 引用行
    expect(block.data.content).toContain('> ')
    // 渲染：引用被解析成带 insight-blockquote class 的 <blockquote>（统一样式，所有分类通用）
    const { container } = render(<>{renderBlock(block as any, 0)}</>)
    const quote = container.querySelector('blockquote.insight-blockquote')
    expect(quote).not.toBeNull()
    expect(quote?.textContent).toContain('销售嘛拉不通')
    // 引用前的散文仍是独立 <p>
    const p = container.querySelector('p')
    expect(p?.textContent).toContain('最后一公里')
  })
})

describe('parseInsightMarkdown — assumption_chain 边界', () => {
  it('[脆弱假设] 含 ### 子标题时走 assumption_chain：steps 分类 tone，#待验证 提取为 validationTag', () => {
    const body = [
      '## [脆弱假设] 追平竞品=填补功能缺口？',
      '对抗仅追功能的思维，揭示补齐样式可能解决不了内容臃肿的根本问题。',
      '',
      '### 假设的危险性',
      '如果只加新卡片，而底层 AI 输出依然是铺满文字的"数据陈列"，最终只是多了一种丑法。',
      '',
      '### 过往教训',
      '我们曾在颜色规范上掉进"讨论完就忘"的坑——生图规则、排版层级、叙事顺序必须输入设计系统的"不可变层"。',
      '',
      '### 错判 AI 生图',
      '在信息过载场景下，一张清晰的 AI 导图是帮老板"秒懂"的入口——它是决策界面的呼吸点，不是装饰。',
      '',
      '#待验证 是否真的需要这 3 项？',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('assumption_chain')
    expect(block.data.eyebrow).toBe('脆弱假设')
    expect(block.data.title).toBe('追平竞品=填补功能缺口？')
    // intro 是 ### 之前的散文
    expect(block.data.intro).toContain('对抗仅追功能的思维')
    // 三条 ### → 三个 steps，按标签关键字分类 tone
    expect(block.data.steps).toHaveLength(3)
    expect(block.data.steps[0].label).toBe('假设的危险性')
    expect(block.data.steps[0].tone).toBe('fragility')
    expect(block.data.steps[1].label).toBe('过往教训')
    expect(block.data.steps[1].tone).toBe('fragility')
    expect(block.data.steps[2].label).toBe('错判 AI 生图')
    expect(block.data.steps[2].tone).toBe('fragility')
    // intro 不应重复 step 的描述
    expect(block.data.intro).not.toContain('如果只加新卡片')
    // validationTag 被提取出来
    expect(block.data.validationTag).toBe('是否真的需要这 3 项？')
  })

  it('[脆弱假设] ### 子标题按 tone 分类：claim / fragility / alternative', () => {
    const body = [
      '## [脆弱假设] 课程化描述',
      '',
      '### 假设命题',
      '复杂功能拆成"60秒真人制作"等课程名就能体现价值。',
      '',
      '### 后果：主动为低价竞争者敞开大门',
      '广军老师点出关键："别人他低价就可以低价用掉了啊。"',
      '',
      '### 替代解释',
      '反向操作，用生产复杂度构建控标参数。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('assumption_chain')
    expect(block.data.steps).toHaveLength(3)
    expect(block.data.steps[0].tone).toBe('claim')
    expect(block.data.steps[1].tone).toBe('fragility')
    expect(block.data.steps[2].tone).toBe('alternative')
  })

  it('[脆弱假设] 含 - 列表（无 ### 子标题）依然降级为 risk_list 卡片网格（向后兼容）', () => {
    const body = [
      '## [脆弱假设] 2+1+1模式的合规落地',
      '',
      '- 民办本科面临合格评估',
      '- 双方均承认这是最大变量',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('risk_list')
    expect(blocks[0].data.eyebrow).toBe('脆弱假设')
  })

  it('[脆弱假设] body 仅含段落（无列表无子标题）时降级为 section', () => {
    const body = [
      '## [脆弱假设] 纯段落',
      '',
      '只是一段说明文字。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
  })

  it('[脆弱假设] #待验证 行可以出现在 steps 中间，依然被提取为 validationTag', () => {
    const body = [
      '## [脆弱假设] 论点',
      '',
      '### 论据 A',
      '这是 A 的内容。',
      '',
      '#待验证 推理链是否完整？',
      '',
      '### 论据 B',
      '这是 B 的内容。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('assumption_chain')
    expect(block.data.validationTag).toBe('推理链是否完整？')
    // #待验证 行不应泄漏到 intro 或 step 描述里
    expect(block.data.intro).not.toContain('#待验证')
    expect(block.data.steps[0].description).not.toContain('#待验证')
    expect(block.data.steps[1].description).not.toContain('#待验证')
  })

  it('plain header ## 假设链 同样解析为 assumption_chain', () => {
    const body = [
      '## 假设链 推导过程',
      '',
      '### 起点',
      '初始条件',
      '',
      '### 脆弱',
      '薄弱环节',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('assumption_chain')
    expect(block.data.eyebrow).toBe('脆弱假设')
    expect(block.data.title).toBe('假设链 推导过程')
    expect(block.data.steps).toHaveLength(2)
    expect(block.data.steps[0].tone).toBe('note')
    expect(block.data.steps[1].tone).toBe('fragility')
  })

  it('[脆弱假设] bullet 形式（- **标题：** 内容）也走 assumption_chain：每条 bullet 解析为 step', () => {
    // 用户原始 markdown：用 bullet 形式暴露三条脆弱点
    const body = [
      '## [脆弱假设] 追平竞品=填补功能缺口？',
      '对抗仅追功能的思维，揭示补齐样式可能解决不了内容臃肿的根本问题。',
      '',
      '- **假设的危险性**：如果只加新卡片，而底层AI输出依然是铺满文字的"数据陈列"，最终只是多了一种丑法。',
      '- **过往教训**：我们曾在颜色规范上掉进"讨论完就忘"的坑。没有把这次生图规则、排版层级、叙事顺序输入设计系统的"不可变层"，下一次面对新竞品仍然会重新破防。',
      '- **错判AI生图**：认为AI生图是锦上添花是危险的。在信息过载的场景下，一张清晰的AI导图是帮老板"秒懂"的唯一入口。它不是插图，而是决策界面的呼吸点。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('assumption_chain')
    expect(block.data.eyebrow).toBe('脆弱假设')
    expect(block.data.title).toBe('追平竞品=填补功能缺口？')
    // intro = bullet 之前的散文
    expect(block.data.intro).toContain('对抗仅追功能的思维')
    // 三条 bullet → 三个 steps，**标题** 作为 label，剩余作为 description
    expect(block.data.steps).toHaveLength(3)
    expect(block.data.steps[0].label).toBe('假设的危险性')
    expect(block.data.steps[0].description).toContain('如果只加新卡片')
    expect(block.data.steps[0].tone).toBe('fragility')
    expect(block.data.steps[1].label).toBe('过往教训')
    expect(block.data.steps[1].tone).toBe('fragility')
    expect(block.data.steps[2].label).toBe('错判AI生图')
    expect(block.data.steps[2].tone).toBe('fragility')
    // intro 不应重复 step 的描述
    expect(block.data.intro).not.toContain('只补卡片')
  })

  it('[脆弱假设] bullet 形式 + bullet 之后散文：散文归 outro', () => {
    const body = [
      '## [脆弱假设] 三段论证',
      '',
      '导语段落。',
      '',
      '- **一个论据**：描述一。',
      '- **另一个论据**：描述二。',
      '',
      '结尾总结段落。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('assumption_chain')
    expect(block.data.intro).toBe('导语段落。')
    expect(block.data.steps).toHaveLength(2)
    expect(block.data.steps[0].label).toBe('一个论据')
    expect(block.data.steps[1].label).toBe('另一个论据')
    expect(block.data.outro).toBe('结尾总结段落。')
  })

  it('[脆弱假设] bullet 形式 + #待验证 也被提取为 validationTag', () => {
    const body = [
      '## [脆弱假设] 待验证场景',
      '',
      '- **判断 A**：理由一。',
      '- **判断 B**：理由二。',
      '',
      '#待验证 这两个判断是否互斥？',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('assumption_chain')
    expect(block.data.validationTag).toBe('这两个判断是否互斥？')
    // #待验证 行不应泄漏到 outro 或 step 描述里
    expect(block.data.outro).not.toContain('#待验证')
    expect(block.data.steps[0].description).not.toContain('#待验证')
  })
})

describe('parseInsightMarkdown — risk_list 边界', () => {
  it('[风险] 段落+列表+段落：列表前散文→intro，bullets→items，列表后散文→outro（保证阅读顺序）', () => {
    const body = [
      '## [风险] 产业项目来源与学生交付能力',
      '',
      '**甲骨文不直接发包，所有项目需从市场获取。** 会议提出的FDE模式（免费MVP验证）在逻辑上可行——由学生+老师小组为企业提供低门槛验证，但：',
      '- 项目来源能否持续？OPC社区3000+需求是表面数字还是可交付场景？',
      '- 学生经2-3个月系统培训后，能否产出可交付MVP？杨总的经验基于顶尖高校，民办高校基础更差，不可直接类比',
      '',
      '**影响：** 若项目来源或交付能力未达预期，整个模式的可持续性将受严重质疑。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('risk_list')
    expect(block.data.eyebrow).toBe('风险')
    // bullets 提取为 items（无标题 → title 为原文，content 空）
    expect(block.data.items).toHaveLength(2)
    expect(block.data.items[0].title).toContain('项目来源能否持续')
    expect(block.data.items[1].title).toContain('学生经2-3个月系统培训后')
    // 列表前的散文 → intro
    expect(block.data.intro).toContain('**甲骨文不直接发包')
    expect(block.data.intro).not.toContain('**影响：**')
    // 列表后的散文 → outro（关键：影响段在列表下方）
    expect(block.data.outro).toContain('**影响：**')
    expect(block.data.outro).not.toContain('甲骨文不直接发包')
  })

  it('[风险] 列表项带 **标题：** 模式时提取为独立 risk items', () => {
    const body = [
      '## [风险] 业务风险',
      '',
      '- **风险一**：项目来源不稳定',
      '- **风险二**：交付能力不足',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('risk_list')
    expect(block.data.items).toHaveLength(2)
    expect(block.data.items[0].title).toBe('风险一')
    expect(block.data.items[0].content).toBe('项目来源不稳定')
    expect(block.data.items[1].title).toBe('风险二')
    expect(block.data.items[1].content).toBe('交付能力不足')
    // 无环绕散文时 intro/outro 均为空
    expect(block.data.intro).toBe('')
    expect(block.data.outro).toBe('')
  })

  it('[风险] 渲染端到端：intro → risk items → outro 的顺序（影响段在列表下方）', () => {
    const body = [
      '## [风险] 产业项目来源与学生交付能力',
      '',
      '**甲骨文不直接发包，所有项目需从市场获取。** ...但：',
      '- 项目来源能否持续？',
      '- 学生经2-3个月系统培训后，能否产出可交付MVP？',
      '',
      '**影响：** 若项目来源或交付能力未达预期，整个模式的可持续性将受严重质疑。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    const { container } = render(<>{renderBlock(blocks[0] as any, 0)}</>)

    // 结构：intro（.insight-section-intro）→ 风险卡片（.insight-risk-grid）→ outro（.insight-section-intro）
    const intros = container.querySelectorAll('.insight-section-intro')
    const grid = container.querySelector('.insight-risk-grid')
    expect(intros).toHaveLength(2)
    expect(grid).not.toBeNull()
    // 第一个 intro 是开头段
    expect(intros[0].textContent).toContain('甲骨文不直接发包')
    // 第二个 intro 是影响段（outro）
    expect(intros[1].textContent).toContain('影响：')
    // DOM 顺序：intro[0] 在 grid 之前，intro[1](outro) 在 grid 之后
    const gridPos = grid!.compareDocumentPosition(intros[1])
    expect(gridPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // risk 卡片有两条
    expect(grid?.querySelectorAll('.insight-item')).toHaveLength(2)
  })

  it('[风险] 无 - 列表项时 intro 包含正文，items/outro 为空（不渲染 risk-grid 外壳）', () => {
    const body = [
      '## [风险] 算力积分验收仍是最大付款堵点',
      '18万算力积分的交付与验收凭证，目前完全悬空。学校资产处从未采购过此类服务，必须拿出实物般的物理凭证。',
      '当前探讨的几个路径——转账凭证、后台积分截图、供应方订单——均未获得校方确认。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('risk_list')
    // 没有列表项时：intro 包含正文，items/outro 必须为空（不渲染 risk-grid 外壳）
    expect(block.data.intro).toContain('18万算力积分')
    expect(block.data.intro).toContain('当前探讨的几个路径')
    expect(block.data.items).toEqual([])
    expect(block.data.outro).toBe('')
  })
})

// ────────────────────────────────────────────────────────────────────
// 新增：其它 block 类型的回归测试（修复过程中同步覆盖）
// ────────────────────────────────────────────────────────────────────

describe('parseInsightMarkdown — hero_judgment', () => {
  it('## [核心判断] 不再被静默丢弃（之前 switch 里没有此 case）', () => {
    const body = [
      '## [核心判断] 短期靠 1+N 补足开课能力',
      '',
      '**核心观点：** 必须先用 1+N 模式撑住开课能力，再考虑 2+1+1。',
      '#标签1',
      '@责任人',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('hero_judgment')
    expect(blocks[0].data.label).toBe('核心判断')
    expect(blocks[0].data.headline).toBe('短期靠 1+N 补足开课能力')
    // 整段 body 必须保留（不被切碎或丢弃）
    expect(blocks[0].data.content).toContain('**核心观点：**')
    expect(blocks[0].data.content).toContain('必须先用 1+N 模式')
    // 标签行（# / @ 开头）应被提取到 tags
    expect(blocks[0].data.tags).toContain('标签1')
    expect(blocks[0].data.tags).toContain('责任人')
  })

  it('[核心判断] 即使没有标签行也能正常解析', () => {
    const body = [
      '## [核心判断] 短期靠 1+N',
      '',
      '**核心观点：** 必须先用 1+N 模式。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('hero_judgment')
    expect(blocks[0].data.tags).toEqual([])
    expect(blocks[0].data.content).toContain('**核心观点：**')
  })
})

describe('parseInsightMarkdown — decision_banner', () => {
  it('[战略定调] / [已形成决定] 解析为 decision_banner', () => {
    const body = [
      '## [战略定调] 走 1+N 路径',
      '',
      '已决定优先走 1+N 模式快速落地，2+1+1 作为长期目标。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('decision_banner')
    expect(blocks[0].data.eyebrow).toBe('战略定调')
    expect(blocks[0].data.headline).toBe('走 1+N 路径')
    expect(blocks[0].data.content).toContain('已决定优先走 1+N 模式')
  })
})

describe('parseInsightMarkdown — section (通用 section 类 markers)', () => {
  it('[观点与讨论] 整段 body 保留为 content', () => {
    const body = [
      '## [观点与讨论] 2+1+1 模式可行性',
      '',
      '杨老师认为 2+1+1 模式适合民办本科的实际情况。',
      '- 项目来源稳定',
      '- 师资团队成熟',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].data.eyebrow).toBe('观点与讨论')
    expect(blocks[0].data.title).toBe('2+1+1 模式可行性')
    // 段落和列表都应保留在 content 里（由 renderMarkdownText 渲染）
    expect(blocks[0].data.content).toContain('杨老师认为')
    expect(blocks[0].data.content).toContain('- 项目来源稳定')
  })

  it('[深度分析] / [破局点] / [洞察] / [历史提醒] / [提醒] 都解析为 section', () => {
    const markers = ['深度分析', '破局点', '洞察', '历史提醒', '提醒']
    for (const marker of markers) {
      const body = `## [${marker}] 章节标题\n\n正文内容。`
      const { blocks } = parseInsightMarkdown(wrap(body))
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('section')
      expect(blocks[0].data.eyebrow).toBe(marker)
      expect(blocks[0].data.content).toBe('正文内容。')
    }
  })

  it('[历史提醒] 含列表时渲染为血泪史警示卡片网格（tone: history），前后散文分列 intro/outro', () => {
    const body = [
      '## [历史提醒] 厂商直销的血泪史',
      '博思云代表用一连串踩坑经验，倒逼出第一性原则。',
      '',
      '* 网易有道：把代理商"拐死"、口碑做烂。',
      '* 腾讯云：教育部门裁撤，合作烂尾。',
      '* 科大讯飞：直销团队驻点到学校，没有第三方空间。',
      '',
      '结论：**"只要有直销我们就不干了。"**',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    // 含列表 → 复用 risk_list 卡片网格结构，并打上 tone:history 供渲染层套棕红配色
    expect(block.type).toBe('risk_list')
    expect(block.data.tone).toBe('history')
    expect(block.data.eyebrow).toBe('历史提醒')
    // 列表前散文 → intro，列表后散文 → outro
    expect(block.data.intro).toContain('倒逼出第一性原则')
    expect(block.data.outro).toContain('只要有直销我们就不干了')
    // 三条踩坑 → 卡片
    expect(block.data.items).toHaveLength(3)
    expect(block.data.items[0].title).toContain('网易有道')

    // 渲染：grid 带 tone-history class
    const { container } = render(<>{renderBlock(block as any, 0)}</>)
    const grid = container.querySelector('.insight-risk-grid.tone-history')
    expect(grid).not.toBeNull()
    expect(grid?.querySelectorAll('.insight-item')).toHaveLength(3)
  })

  it('[历史提醒] 无列表（纯散文）时仍解析为普通 section', () => {
    const body = '## [历史提醒] 纯提醒\n\n仅一段提醒文字，没有列表。'
    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].data.content).toContain('仅一段提醒文字')
  })
})

describe('parseInsightMarkdown — callout', () => {
  it('[引用] 整段 body 保留', () => {
    const body = [
      '## [引用] 王老师的关键发言',
      '',
      '民办本科必须走差异化路线。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('callout')
    expect(blocks[0].data.title).toBe('王老师的关键发言')
    expect(blocks[0].data.content).toContain('民办本科必须走差异化路线')
  })
})

describe('parseInsightMarkdown — red_line', () => {
  it('[门禁] / [决策边界] / [边界] 解析为 red_line', () => {
    const markers = ['门禁', '决策边界', '边界']
    for (const marker of markers) {
      const body = `## [${marker}] 教育部审批是底线\n\n教育部评估未通过前不进入实施阶段。`
      const { blocks } = parseInsightMarkdown(wrap(body))
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('red_line')
      expect(blocks[0].data.label).toBe(marker)
      expect(blocks[0].data.headline).toBe('教育部审批是底线')
      expect(blocks[0].data.content).toContain('教育部评估未通过前')
    }
  })
})

describe('parseInsightMarkdown — timeline 边界', () => {
  it('[关键节点] 无 ### 子标题时降级为 section，保留列表项', () => {
    const body = [
      '## [关键节点] 落地里程碑',
      '',
      '**未来三个月的关键节点如下：**',
      '- 第1个月：完成首批学生选拔',
      '- 第2个月：师资培训',
      '- 第3个月：项目交付',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].data.eyebrow).toBe('关键节点')
    expect(blocks[0].data.title).toBe('落地里程碑')
    expect(blocks[0].data.content).toContain('- 第1个月：完成首批学生选拔')
    expect(blocks[0].data.content).toContain('- 第3个月：项目交付')
  })

  it('[关键节点] 含 ### 子标题时仍走 timeline，保留原行为', () => {
    const body = [
      '## [关键节点] 时间线',
      '',
      '### 2026-08',
      '试点启动',
      '',
      '### 2026-09',
      '第一批交付',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('timeline')
    expect(blocks[0].data.items).toHaveLength(2)
    expect(blocks[0].data.items[0].date).toBe('2026-08')
    expect(blocks[0].data.items[0].event).toBe('试点启动')
  })

  it('[关键节点] sub-section 描述文字不应同时出现在 intro 和 items（避免重复渲染）', () => {
    const body = [
      '## [关键节点] 落地里程碑',
      '### 第1个月',
      '完成首批学生选拔，启动师资培训。',
      '### 第2个月',
      '第一批项目交付。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('timeline')
    // intro 不能重复 items 的 event
    expect(blocks[0].data.intro).not.toContain('完成首批学生选拔')
    expect(blocks[0].data.intro).not.toContain('第一批项目交付')
    // event 正确归属
    expect(blocks[0].data.items[0].event).toContain('完成首批学生选拔')
    expect(blocks[0].data.items[1].event).toBe('第一批项目交付。')
  })

  it('[关键节点] 含 sub-section 之前的 intro 散文时，intro 只保留散文部分', () => {
    const body = [
      '## [关键节点] 时间线',
      '',
      '以下是三个月的关键节点。',
      '',
      '### 2026-08',
      '试点启动',
      '',
      '### 2026-09',
      '第一批交付',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('timeline')
    expect(blocks[0].data.intro).toContain('以下是三个月的关键节点。')
    expect(blocks[0].data.intro).not.toContain('试点启动')
    expect(blocks[0].data.intro).not.toContain('第一批交付')
  })
})

describe('parseInsightMarkdown — action_list 边界', () => {
  it('[行动] 段落+列表混合：散文作为 intro，列表提取为 items（保持行动卡片样式）', () => {
    const body = [
      '## [行动] 方向性承诺与下一步',
      '',
      '会议未签署协议，但形成明确行动：',
      '',
      '- **甲方代表**：回去内部评估财务与风险，1-2周内决定是否启动合作、选择哪种模式、是否支付45万WDP费用',
      '- **甲骨文方（王总）**：可对接剑桥学院等学校资源供甲方尝试',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('action_list')
    // 散文作为 intro
    expect(block.data.intro).toContain('会议未签署协议，但形成明确行动')
    // 列表项提取为 items（不被散文吞掉）
    expect(block.data.items).toHaveLength(2)
    expect(block.data.items[0].title).toBe('甲方代表')
    expect(block.data.items[0].action).toContain('回去内部评估财务与风险')
    expect(block.data.items[1].title).toBe('甲骨文方（王总）')
    expect(block.data.items[1].action).toContain('可对接剑桥学院等学校资源')
  })

  it('[行动] 纯无标题列表（无环绕散文）时提取为 items（保留数字徽标）', () => {
    const body = [
      '## [行动] 下一步行动',
      '',
      '- 与第一所民办本科签约试点',
      '- 组建师资团队',
      '- 完成首批学生选拔',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('action_list')
    // 纯列表 → 提取为 items，无标题的项 metadata 字段为空
    expect(block.data.items).toHaveLength(3)
    expect(block.data.items[0].title).toBe('')
    expect(block.data.items[0].action).toBe('与第一所民办本科签约试点')
    expect(block.data.items[1].action).toBe('组建师资团队')
  })

  it('[行动] 列表项带 **标题：** + 责任人：/时间：/验收标准：元数据时解析为 items', () => {
    const body = [
      '## [行动] 行动清单',
      '',
      '- **签约试点**：与西安翻译学院签约，责任人：张三，时间：7月底，验收标准：协议签字盖章。',
      '- **启动MVP**：组建团队，责任人：李四，时间：8月15日。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('action_list')
    expect(block.data.items).toHaveLength(2)
    expect(block.data.items[0].title).toBe('签约试点')
    expect(block.data.items[0].owner).toBe('张三')
    expect(block.data.items[0].deadline).toBe('7月底')
    expect(block.data.items[0].acceptance_criteria).toBe('协议签字盖章')
    expect(block.data.items[1].title).toBe('启动MVP')
    expect(block.data.items[1].owner).toBe('李四')
  })

  it('[行动] 两种写法（marker / 无 marker plain header）渲染结构应一致', () => {
    const titledBody = [
      '## [行动] 下一步行动',
      '会议未签署协议，但形成明确行动：',
      '- **甲方代表**：回去内部评估',
      '- **甲骨文方**：可对接资源',
    ].join('\n')

    const plainBody = [
      '## 下一步行动',
      '会议未签署协议，但形成明确行动：',
      '- **甲方代表**：回去内部评估',
      '- **甲骨文方**：可对接资源',
    ].join('\n')

    const { blocks: titledBlocks } = parseInsightMarkdown(wrap(titledBody))
    const { blocks: plainBlocks } = parseInsightMarkdown(wrap(plainBody))

    // 两种写法的结构一致：intro 散文 + items 列表
    expect(plainBlocks[0].type).toBe(titledBlocks[0].type)
    expect(plainBlocks[0].data.eyebrow).toBe(titledBlocks[0].data.eyebrow)
    expect(plainBlocks[0].data.title).toBe(titledBlocks[0].data.title)
    expect(plainBlocks[0].data.intro).toEqual(titledBlocks[0].data.intro)
    expect(plainBlocks[0].data.items).toEqual(titledBlocks[0].data.items)
  })

  it('[行动] 无列表项时 intro 包含正文，items 为空（不渲染 action-grid 外壳）', () => {
    const body = [
      '## [行动] 总体安排',
      '',
      '下一步将根据教育部评估结果决定是否启动试点。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('action_list')
    expect(block.data.intro).toContain('下一步将根据教育部评估结果')
    expect(block.data.items).toEqual([])
  })

  it('[行动] 使用有序列表（1. 2. 3.）+ **标题：** 也能提取为 items', () => {
    const body = [
      '## [行动] 三项关键动作推动破局',
      '1. **升级智谱沟通策略**：由博思云代表联合潘总，形成商业计划书，推动智谱销售高层做决策。',
      '2. **启动联合预研"AI编程教育平台"**：两周内双方深入讨论，产出产品概念草案。',
      '3. **列出目标院校初筛清单**：博思云代表一个月内梳理出至少5-8所广东民办本科院校。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('action_list')
    // 有序列表被正确提取为 items（此前只认 - 短横线，会漏掉全部条目）
    expect(block.data.items).toHaveLength(3)
    expect(block.data.items[0].title).toBe('升级智谱沟通策略')
    expect(block.data.items[0].action).toContain('形成商业计划书')
    expect(block.data.items[1].title).toBe('启动联合预研"AI编程教育平台"')
    expect(block.data.items[2].title).toBe('列出目标院校初筛清单')
  })
})

describe('parseInsightMarkdown — verification_list 边界', () => {
  it('[待验证] 段落+列表混合：散文作为 intro，列表提取为 items', () => {
    const body = [
      '## [待验证] 关键假设',
      '',
      '**需要验证的假设：** 民办本科是否接受 2+1+1 模式。',
      '',
      '- **教育部认可度**：教育部是否认可企业工程师授课',
      '- **审批周期**：培养方案修改审批周期',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('verification_list')
    // 散文作为 intro
    expect(block.data.intro).toContain('**需要验证的假设：**')
    expect(block.data.intro).toContain('民办本科是否接受 2+1+1 模式')
    // 列表提取为 items
    expect(block.data.items).toHaveLength(2)
    expect(block.data.items[0].item).toBe('教育部认可度')
    expect(block.data.items[1].item).toBe('审批周期')
  })

  it('[待验证] 纯无标题列表（无环绕散文）时提取为 items（保留 checkbox 风格）', () => {
    const body = [
      '## [待验证] 待验证事项',
      '',
      '- 教育版改造与待开发模块的详细开发计划与时间节点尚未制定',
      '- 70%技术分能否形成足够压倒性的优势，对冲30%价格分劣势',
      '- 如何将独家能力包装得既有控标力度，又不触碰"指向性"红线',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('verification_list')
    // 纯列表 → 提取为 items，无标题的项 item 留空，content 保留全文
    expect(block.data.items).toHaveLength(3)
    expect(block.data.items[0].item).toBe('')
    expect(block.data.items[0].content).toBe('教育版改造与待开发模块的详细开发计划与时间节点尚未制定')
    expect(block.data.items[1].content).toBe('70%技术分能否形成足够压倒性的优势，对冲30%价格分劣势')
    expect(block.data.items[2].content).toContain('如何将独家能力包装得既有控标力度')
  })

  it('[待验证] 列表项带 **标题：** 时解析为独立 items', () => {
    const body = [
      '## [待验证] 待确认事项',
      '',
      '- **教育部认可度**：教育部是否认可企业工程师授课',
      '- **审批周期**：培养方案修改审批周期',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('verification_list')
    expect(block.data.items).toHaveLength(2)
    expect(block.data.items[0].item).toBe('教育部认可度')
    expect(block.data.items[0].content).toBe('教育部是否认可企业工程师授课')
  })

  it('[待验证] 两种写法（marker / 无 marker plain header）渲染结构应一致', () => {
    const titledBody = [
      '## [待验证] 待验证事项',
      '- **风险A**：内容A',
      '- **风险B**：内容B',
    ].join('\n')

    const plainBody = [
      '## 待验证事项',
      '- **风险A**：内容A',
      '- **风险B**：内容B',
    ].join('\n')

    const { blocks: titledBlocks } = parseInsightMarkdown(wrap(titledBody))
    const { blocks: plainBlocks } = parseInsightMarkdown(wrap(plainBody))

    expect(plainBlocks[0].type).toBe(titledBlocks[0].type)
    expect(plainBlocks[0].data.eyebrow).toBe(titledBlocks[0].data.eyebrow)
    expect(plainBlocks[0].data.title).toBe(titledBlocks[0].data.title)
    expect(plainBlocks[0].data.items).toEqual(titledBlocks[0].data.items)
  })

  it('[待验证] 无列表项时 intro 包含正文，items 为空（不渲染 verify-grid 外壳）', () => {
    const body = [
      '## [待验证] 整体评估',
      '',
      '整体上，民办本科的合规性、教育部评估细则、审批周期都需要进一步确认。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('verification_list')
    expect(block.data.intro).toContain('民办本科的合规性')
    expect(block.data.items).toEqual([])
  })

  it('[待验证] 使用 * 星号列表（而非 - 短横线）也能提取为 items', () => {
    const body = [
      '## 待验证事项',
      '',
      '* 智谱的品牌授权能否在代理商承担前期投入和市场拓展的前提下被打通？',
      '* 由第三方主导的"产品教育化"改造，能否构建起足够的壁垒，不致沦为可随时复制的中间人模式？',
      '* 民办高校"既想上新专业招生，又一毛不拔"的矛盾心态下，分成与投入的财务模型能否在第一个案例中跑通？',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('verification_list')
    // 星号列表被正确提取为 items（此前只认 - 短横线，会漏掉全部条目）
    expect(block.data.items).toHaveLength(3)
    expect(block.data.items[0].content).toContain('智谱的品牌授权能否')
    expect(block.data.items[1].content).toContain('产品教育化')
    expect(block.data.items[2].content).toContain('矛盾心态')
    // 无环绕散文时 intro 为空
    expect(block.data.intro).toBe('')
  })
})

describe('parseInsightMarkdown — comparison 边界', () => {
  it('[对比] 含 ### 子标题分组时仍走 comparison，items 含子标题 + 列表', () => {
    const body = [
      '## [对比] 两种合作模式',
      '',
      '### 场景一：对外',
      '**风险：** 政策合规。',
      '- 审批流程长',
      '- 评估标准严',
      '',
      '### 场景二：对内',
      '**优势：** 落地快。',
      '- 师资灵活',
      '- 学生可参与项目',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    expect(block.type).toBe('comparison')
    expect(block.data.hasSubSections).toBe(true)
    expect(block.data.items).toHaveLength(2)
    expect(block.data.items[0].label).toBe('场景一：对外')
    expect(block.data.items[0].items).toEqual(['审批流程长', '评估标准严'])
    expect(block.data.items[1].label).toBe('场景二：对内')
    expect(block.data.items[1].items).toEqual(['师资灵活', '学生可参与项目'])
  })

  it('[对比] sub-section 描述文字不应同时出现在 intro 和 items.content（避免重复渲染）', () => {
    const body = [
      '## [对比] 两种合作模式',
      '### 场景一：对外',
      '政策合规风险较高，审批周期长。',
      '### 场景二：对内',
      '落地快，师资灵活。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('comparison')
    expect(blocks[0].data.hasSubSections).toBe(true)
    // intro 不能重复 items 的 content
    expect(blocks[0].data.intro).not.toContain('政策合规风险较高')
    expect(blocks[0].data.intro).not.toContain('落地快，师资灵活')
    // content 正确归属
    expect(blocks[0].data.items[0].content).toBe('政策合规风险较高，审批周期长。')
    expect(blocks[0].data.items[1].content).toBe('落地快，师资灵活。')
  })

  it('[对比] 无 ### 子标题，但有带标题列表项时解析为 items', () => {
    const body = [
      '## [对比] 现状与调整',
      '',
      '- **现状**：民办本科面临评估压力',
      '- **调整方向**：引入企业工程师分担核心课',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('comparison')
    expect(blocks[0].data.hasSubSections).toBe(false)
    expect(blocks[0].data.items).toHaveLength(2)
    expect(blocks[0].data.items[0].label).toBe('现状')
    expect(blocks[0].data.items[1].label).toBe('调整方向')
  })

  it('[对比] 无 ### 子标题，无带标题列表项时降级为 section', () => {
    const body = [
      '## [对比] 两种方案的取舍',
      '',
      '**方案 A：** 短期可行但评估压力大。',
      '**方案 B：** 长期可持续但落地慢。',
    ].join('\n')

    const { blocks } = parseInsightMarkdown(wrap(body))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('section')
    expect(blocks[0].data.eyebrow).toBe('对比')
    expect(blocks[0].data.content).toContain('**方案 A：**')
    expect(blocks[0].data.content).toContain('**方案 B：**')
  })
})

describe('parseInsightMarkdown — plain header 路径与 marker 路径一致', () => {
  it('## 待验证（无 marker）行为与 ## [待验证] 一致', () => {
    const titledBody = [
      '## [待验证] 待验证事项',
      '- **风险A**：内容A',
      '- **风险B**：内容B',
    ].join('\n')

    const { blocks: titledBlocks } = parseInsightMarkdown(wrap(titledBody))

    const plainBody = [
      '## 待验证事项',
      '- **风险A**：内容A',
      '- **风险B**：内容B',
    ].join('\n')

    const { blocks: plainBlocks } = parseInsightMarkdown(wrap(plainBody))

    // 两种写法的 block type、items、eyebrow、title 都应一致
    expect(plainBlocks[0].type).toBe(titledBlocks[0].type)
    expect(plainBlocks[0].data.eyebrow).toBe(titledBlocks[0].data.eyebrow)
    expect(plainBlocks[0].data.title).toBe(titledBlocks[0].data.title)
    expect(plainBlocks[0].data.items).toEqual(titledBlocks[0].data.items)
  })

  it('## 下一步行动（无 marker）行为与 ## [行动] 一致', () => {
    const titledBody = [
      '## [行动] 下一步行动',
      '- **任务1**：责任人：张三',
      '- **任务2**：责任人：李四',
    ].join('\n')

    const { blocks: titledBlocks } = parseInsightMarkdown(wrap(titledBody))

    const plainBody = [
      '## 下一步行动',
      '- **任务1**：责任人：张三',
      '- **任务2**：责任人：李四',
    ].join('\n')

    const { blocks: plainBlocks } = parseInsightMarkdown(wrap(plainBody))

    expect(plainBlocks[0].type).toBe(titledBlocks[0].type)
    expect(plainBlocks[0].data.eyebrow).toBe(titledBlocks[0].data.eyebrow)
    expect(plainBlocks[0].data.title).toBe(titledBlocks[0].data.title)
    expect(plainBlocks[0].data.items).toEqual(titledBlocks[0].data.items)
  })
})

/**
 * test.md 是接口真实返回的样本，原先被放在 src/views/recording/test.md
 * （源码目录，会被 Vite 扫到；本测试 fixture 已迁到 insightRenderer/__fixtures__/test.md）。
 *
 * 期望 firstPart 解析：
 *   - pageTag  单独抽出"外部镜像验证 / 产业学院合作模式"（H1 下方的 **标签**：xxx 行）
 *   - pageSubtitle 不应包含 "标签"、"---"、或顶部引用块内容（这些是特殊行）
 *   - 顶部 > 引用块单独作为 quote block 出现在 blocks 数组里
 *   - "核心论点" section 的 content 不应是孤零零的 "---"
 */
describe('parseInsightMarkdown — firstPart 解析（__fixtures__/test.md 真实样本）', () => {
  const { pageTitle, pageTag, pageSubtitle, blocks } = parseInsightMarkdown(
    stripMarkdownCodeFence(REAL_FIXTURE_MD),
  )

  it('pageTag 单独抽出标签行，不再混进 pageSubtitle', () => {
    expect(pageTag).toBe('外部镜像验证 / 产业学院合作模式')
  })

  it('pageSubtitle 不含 "标签" 文字、不含 "---"、不含顶部引用块', () => {
    expect(pageSubtitle).not.toContain('标签')
    expect(pageSubtitle).not.toContain('---')
    expect(pageSubtitle).not.toContain('智谱品牌授权现场确认拉不通')
  })

  it('pageTitle 正确（H1 主标题）', () => {
    expect(pageTitle).toBe(
      '别等了，授权拉不通：53AI的产业学院之路是"借牌造课"，不是"等牌卖课"',
    )
  })

  it('blocks 第一项是顶部引用块（type=quote，text 包含智谱品牌...）', () => {
    expect(blocks[0].type).toBe('quote')
    expect(blocks[0].data.text).toContain('智谱品牌授权现场确认拉不通')
  })

  it('blocks 中没有孤零零的 content="---" section（核心论点的 --- 不该被当内容）', () => {
    const hrOnly = blocks.find(
      (b) => typeof b.data?.content === 'string' && b.data.content.trim() === '---',
    )
    expect(hrOnly).toBeUndefined()
  })

  /**
   * 诊断：part 5（"## 四、[行动指令与门禁]"）的 body 实际内容，
   * 验证 renderMarkdownText 应该看得到 ### / > 引用 / --- / *斜体* 全部。
   * 如果 content 已经被某个上游环节吃掉，那根因在解析层。
   */
  it('part 5（"行动指令与门禁"）正确解析：type=section、title 不跨行抓 ### 子标题、content 含全部 ### 和 > 引用', () => {
    // 关键回归点：marker regex 修后，## 四、[行动指令与门禁] 这种带序号的
    // 应该走 marker 路径，title 不能跨行抓到"### 1. xxx"
    const actionSection = blocks.find(
      (b) => typeof b.data?.title === 'string' && b.data.title.startsWith('行动指令与门禁'),
    )
    expect(actionSection).toBeDefined()
    expect(actionSection!.type).toBe('section')
    expect(actionSection!.data.title).toBe('行动指令与门禁：')  // 标题是 marker + 空 sectionTitle，不含 ###

    const content = String(actionSection!.data.content ?? '')
    // 关键标记全部应在 content 里（renderMarkdownText 渲染层处理）
    expect(content).toContain('### 1.')
    expect(content).toContain('止损条件')
    expect(content).toContain('改判条件')
    expect(content).toContain('代理商的命根子')
    expect(content).toMatch(/\*来源/)
  })
})

