/**
 * blockRenderers.tsx 渲染测试
 *
 * 覆盖 action_list 等结构化 block 的渲染输出。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderBlock } from './blockRenderers';
import { InsightPageRenderer } from './index';
import type { DecisionPageBlock } from '@/api/modules/recording/types';

describe('renderBlock — action_list', () => {
  it('有 title 的 item：title 与 num 同行，action 在下方 item-body 中', () => {
    const block: DecisionPageBlock = {
      id: 'a1',
      type: 'action_list',
      data: {
        eyebrow: '行动',
        title: '下一步行动',
        intro: '',
        items: [
          { title: '甲方代表', action: '回去内部评估财务与风险。' },
        ],
      },
    }
    const { container } = render(<>{renderBlock(block, 0)}</>)

    // item-title 容器应同时含 num 和 title
    const title = container.querySelector('.item-title')
    expect(title).not.toBeNull()
    expect(title?.querySelector('.num')?.textContent).toBe('1')
    expect(title?.textContent).toContain('甲方代表')

    // action 内容在 item-body 中（与 title 分行）
    const body = container.querySelector('.item-body')
    expect(body?.textContent).toContain('回去内部评估财务与风险')
  })

  it('无 title 的 item：action 与 num 同行（合并到 item-title），不渲染空 item-body', () => {
    const block: DecisionPageBlock = {
      id: 'a2',
      type: 'action_list',
      data: {
        eyebrow: '行动',
        title: '下一步行动',
        intro: '',
        items: [
          { title: '', action: '甲方代表完成内部评估，明确是否启动合作。' },
          { title: '', action: '甲骨文方在甲方提出需求后提供对接资源。' },
        ],
      },
    }
    const { container } = render(<>{renderBlock(block, 0)}</>)

    // 两个 item 的 title 容器中应有 num + action 内容（合并到一行）
    const titles = container.querySelectorAll('.item-title')
    expect(titles).toHaveLength(2)
    expect(titles[0].querySelector('.num')?.textContent).toBe('1')
    expect(titles[0].textContent).toContain('甲方代表完成内部评估')
    expect(titles[1].querySelector('.num')?.textContent).toBe('2')
    expect(titles[1].textContent).toContain('甲骨文方在甲方提出需求')

    // 不应有 item-body（action 已合并到 item-title，不重复渲染）
    expect(container.querySelector('.item-body')).toBeNull()
  })

  it('混合（有 title + 无 title）的 item 都能正确渲染', () => {
    const block: DecisionPageBlock = {
      id: 'a3',
      type: 'action_list',
      data: {
        eyebrow: '行动',
        title: '混合测试',
        intro: '',
        items: [
          { title: '有标题项', action: '有标题的 action 描述。' },
          { title: '', action: '无标题项的整段描述。' },
        ],
      },
    }
    const { container } = render(<>{renderBlock(block, 0)}</>)

    const titles = container.querySelectorAll('.item-title')
    expect(titles).toHaveLength(2)
    // 第一项：有 title，title 在 item-title 中，action 在 item-body 中
    expect(titles[0].textContent).toContain('有标题项')
    // 第二项：无 title，action 在 item-title 中
    expect(titles[1].textContent).toContain('无标题项的整段描述')
    // 只有一个 item-body（有 title 那项的 action）
    const bodies = container.querySelectorAll('.item-body')
    expect(bodies).toHaveLength(1)
    expect(bodies[0].textContent).toContain('有标题的 action 描述')
  })
})

describe('renderBlock — assumption_chain', () => {
  it('无显式 claim step 时：data.title 不再作为 claim frame 渲染，由外层 wrapper header 展示', () => {
    const block: DecisionPageBlock = {
      id: 'ac1',
      type: 'assumption_chain',
      data: {
        eyebrow: '脆弱假设',
        title: '追平竞品=填补功能缺口？',
        intro: '',
        steps: [
          { label: '假设的危险性', description: '只补卡片，无法解决内容臃肿。', tone: 'fragility' },
          { label: '错判 AI 生图', description: 'AI 导图是决策入口，不是装饰。', tone: 'fragility' },
        ],
        validationTag: '是否真的需要这 3 项？',
      },
    } as any
    const { container } = render(<>{renderBlock(block as any, 0, true)}</>)

    // 关键：标题走外层 wrapper header，卡片内**不再**渲染 claim frame / h3
    expect(container.querySelector('.insight-assumption-claim')).toBeNull()
    expect(container.querySelector('.insight-assumption-claims')).toBeNull()
    expect(container.querySelector('h3')).toBeNull()

    // data.title 在卡片 DOM 中应出现 0 次
    const cardText = container.querySelector('.insight-card')?.textContent || ''
    expect(cardText).not.toContain('追平竞品=填补功能缺口？')

    // 不渲染 eyebrow（标题即卡片 h3，eyebrow 多余）
    expect(container.querySelector('.eyebrow')).toBeNull()

    // 步骤链 2 个 fragility card
    const steps = container.querySelectorAll('.insight-assumption-step.tone-fragility')
    expect(steps).toHaveLength(2)
    expect(steps[0].querySelector('.step-label')?.textContent).toBe('假设的危险性')
    expect(steps[1].querySelector('.step-label')?.textContent).toBe('错判 AI 生图')


    // 待验证 badge
    const validation = container.querySelector('.insight-assumption-validation')
    expect(validation).not.toBeNull()
    expect(validation?.querySelector('.validation-tag')?.textContent).toBe('待验证')
    expect(validation?.querySelector('.validation-text')?.textContent).toContain('是否真的需要这 3 项？')
  })

  it('显式 claim step 与 evidence steps 共存：claim 用 .insight-assumption-claims 网格', () => {
    const block: DecisionPageBlock = {
      id: 'ac2',
      type: 'assumption_chain',
      data: {
        eyebrow: '脆弱假设',
        title: '课程化描述',
        intro: '',
        steps: [
          { label: '假设命题', description: '复杂功能拆成课程名就能体现价值。', tone: 'claim' },
          { label: '后果：敞开大门', description: '别人低价就能用掉。', tone: 'fragility' },
          { label: '替代解释', description: '用生产复杂度构建控标参数。', tone: 'alternative' },
        ],
        validationTag: '',
      },
    } as any
    const { container } = render(<>{renderBlock(block as any, 0)}</>)

    const claimContainer = container.querySelector('.insight-assumption-claims')
    expect(claimContainer).not.toBeNull()
    const claimInGrid = claimContainer?.querySelector('.insight-assumption-claim')
    expect(claimInGrid).not.toBeNull()
    expect(claimInGrid?.textContent).toContain('假设命题')

    // fragility + alternative 走 evidence chain
    const fragilitySteps = container.querySelectorAll('.insight-assumption-step.tone-fragility')
    const altSteps = container.querySelectorAll('.insight-assumption-step.tone-alternative')
    expect(fragilitySteps).toHaveLength(1)
    expect(altSteps).toHaveLength(1)
    expect(fragilitySteps[0].querySelector('.step-tone')?.textContent).toBe('脆弱')
    expect(altSteps[0].querySelector('.step-tone')?.textContent).toBe('替代解释')

    // 没有 validationTag 时不渲染 badge
    expect(container.querySelector('.insight-assumption-validation')).toBeNull()
  })
})

describe('renderBlock — risk_list', () => {
  it('无 title 的 risk item：content 与 item-title 同行（合并显示）', () => {
    const block: DecisionPageBlock = {
      id: 'r1',
      type: 'risk_list',
      data: {
        eyebrow: '风险',
        title: '业务风险',
        intro: '',
        items: [
          { title: '', content: '项目来源不稳定', severity: 'high' },
          { title: '', content: '交付能力不足', severity: 'high' },
        ],
      },
    }
    const { container } = render(<>{renderBlock(block, 0)}</>)

    // 风险 grid 渲染（每个 item 都有 risk-grid 容器）
    const grid = container.querySelector('.insight-risk-grid')
    expect(grid).not.toBeNull()

    const items = container.querySelectorAll('.insight-item')
    expect(items).toHaveLength(2)
    // 无 title 的 risk item 应只渲染 item-body（content 已在 body 中）
    expect(items[0].querySelector('.item-title')?.textContent?.trim()).toBeFalsy()
    expect(items[0].querySelector('.item-body')?.textContent).toContain('项目来源不稳定')
  })
})

describe('renderBlock — verification_list', () => {
  it('无 title 的 verify item：content 与 checkbox 同行（保留 checkbox 风格）', () => {
    const block: DecisionPageBlock = {
      id: 'v1',
      type: 'verification_list',
      data: {
        eyebrow: '待验证',
        title: '待验证事项',
        intro: '',
        items: [
          { item: '', content: '教育版改造与待开发模块的详细开发计划与时间节点尚未制定' },
          { item: '', content: '70%技术分能否形成足够压倒性的优势' },
        ],
      },
    }
    const { container } = render(<>{renderBlock(block, 0)}</>)

    const items = container.querySelectorAll('.insight-verify-item')
    expect(items).toHaveLength(2)
    // checkbox 图标必须保留（无 title 的 verify item 也走 checkbox 风格）
    expect(items[0].querySelector('.insight-checkbox')).not.toBeNull()
    expect(items[0].querySelector('.item-body')?.textContent).toContain('教育版改造')
  })
})

describe('InsightPageRenderer — 段内 mermaid 拆分后的整页渲染', () => {
  const FENCE = '```'
  const MD = [
    '# 洞察页',
    '',
    '## [脆弱假设] 记忆的尺子与信任的台阶',
    '',
    '### 信任分级暗藏一步踏空的脆弱点',
    '从"全程确认"到"结果验收"的信任分级，逻辑自洽，却建在一个脆弱假设上。',
    '',
    `${FENCE}mermaid`,
    'flowchart TB',
    '    A["信任分级机制 | 从全程确认到结果验收"]:::neutral',
    '    B["脆弱假设 | AI基础任务表现稳定"]:::pending',
    '    B --> A',
    '    A --> D["频繁出错"]:::warning',
    FENCE,
    '',
    '**信任一旦在起点破产，后面所有的阶梯都成了摆设**。',
  ].join('\n')

  it('散文全部保留，段落标题只出现一次，图正常渲染', () => {
    const { container } = render(<InsightPageRenderer pageJson={{ _markdown: MD }} />)
    const text = container.textContent || ''

    // 散文没有被"吃掉"
    expect(text).toContain('逻辑自洽')
    expect(text).toContain('后面所有的阶梯都成了摆设')
    // mermaid 源码不泄漏成正文
    expect(text).not.toContain('flowchart TB')
    expect(text).not.toContain(':::neutral')
    // 段落标题只渲染一次（拆出的图 block 不复制标题）
    const headers = Array.from(container.querySelectorAll('.insight-block-header'))
      .map(e => e.textContent || '')
      .filter(t => t.includes('记忆的尺子'))
    expect(headers).toHaveLength(1)
    // 图确实渲染出来
    expect(container.querySelector('.insight-mermaid-flow')).not.toBeNull()
    expect(text).toContain('信任分级机制')
  })
})

describe('InsightPageRenderer — 散文 + mermaid + ### 对比表格，全部留在同一张卡片内', () => {
  // 用户实际场景：[脆弱假设] 引言段嵌入 mermaid，### 子标题再展开一个对比表格，
  // 末尾一段收尾散文。整段应在同一张 assumption_chain 卡片里渲染（不拆为独立 flow_diagram 卡片）。
  const MD = [
    '# 洞察页',
    '',
    '## [脆弱假设] 记忆是双刃剑：生效成本极高，失效代价只需一次误判',
    '「减脂期点去酱汉堡」等 Showcase 细节动人，但隐含一个核心假设：AI 的推理方向与用户当下的隐藏意图始终一致。一旦这个假设不成立，信任崩塌的速度将远快于建立的速度。',
    '',
    '```mermaid',
    'flowchart TB',
    '    A["用户行为碎片"]:::neutral',
    '    B["AI记忆调用"]:::info',
    '    A --> B',
    '    B --> C["意图一致"]:::positive',
    '    B --> D["意图错位"]:::danger',
    '    D --> E["信任崩塌"]:::critical',
    '    E --> F["纠错困难"]:::warning',
    '    F --> G["口碑逆转"]:::danger',
    '```',
    '',
    '### 对比：传统工具与记忆 AI 的用户容忍度',
    '',
    '| 对比维度 | 传统无记忆 AI | Open Bear 记忆 AI |',
    '| --- | --- | --- |',
    '| 用户容忍度 | 每次重说一遍，零预期 | 出错即失望 |',
    '| 纠错成本 | 单次对话修正 | 需修正记忆图谱 |',
    '',
    '记忆让 AI 从「你告诉他」进化到「他理解你」，但也让 AI 从一个听话的工具，变成了一个会自以为是的伙伴。',
  ].join('\n')

  it('整段渲染在单一 assumption_chain 卡片里，mermaid + 表格 + 收尾散文全部 inline', () => {
    const { container } = render(<InsightPageRenderer pageJson={{ _markdown: MD }} />)
    const text = container.textContent || ''

    // 关键：只有一张 assumption_chain 卡片，**没有**独立的 mermaid / flow_diagram 卡片
    const assumptionCards = container.querySelectorAll('.insight-assumption-chain, .insight-assumption-claims')
    // assumption_chain 渲染时外层是 .insight-card 包裹 step 链；本场景没有 claim steps，只渲染 evidence 链
    // 我们只关心：没有"独立的 mermaid 卡片"——也就是 .insight-card 数量应当等于 1（封面 + assumption_chain 各一）
    const insightCards = container.querySelectorAll('.insight-schema > *')
    // 顶层结构：cover 标题 + 1 张 assumption_chain 卡片
    expect(insightCards.length).toBe(2)

    // mermaid 源码渲染成图（不再是源码泄漏）
    expect(container.querySelector('.insight-mermaid-flow')).not.toBeNull()
    expect(text).not.toContain('flowchart TB')
    expect(text).not.toContain(':::neutral')
    // 节点标题出现在图里
    expect(text).toContain('用户行为碎片')
    expect(text).toContain('AI记忆调用')
    expect(text).toContain('信任崩塌')
    expect(text).toContain('口碑逆转')

    // 表格 + 收尾散文都保留
    expect(text).toContain('传统无记忆 AI')
    expect(text).toContain('Open Bear 记忆 AI')
    expect(text).toContain('记忆让 AI')

    // 段落标题只渲染一次（没有"标题 + 独立图块"重复）
    const headers = Array.from(container.querySelectorAll('.insight-block-header'))
      .map(e => e.textContent || '')
      .filter(t => t.includes('记忆是双刃剑'))
    expect(headers).toHaveLength(1)
  })
})