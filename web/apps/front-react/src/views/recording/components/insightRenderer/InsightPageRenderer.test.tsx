/**
 * InsightPageRenderer 整页渲染测试
 *
 * 覆盖 B 范围修的"hasBlockContent false 时 wrapper 不渲染"行为：
 * 用 test.md fixture 跑通整页，断言：
 *   - "核心论点"section（title 在但 content 已被 dropHrLines 丢弃为空）不渲染空卡片
 *   - "行动指令与门禁"section 的 > 引用块正确渲染为 blockquote
 *   - "行动指令与门禁"section 的 ### 子标题正确渲染为 h4
 */
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { InsightPageRenderer } from './index'
import { parseInsightMarkdown, stripMarkdownCodeFence } from './markdownParser'

const REAL_FIXTURE_MD = readFileSync(
  resolve(__dirname, '__fixtures__/test.md'),
  'utf8',
)

describe('InsightPageRenderer — test.md 整页渲染（B 范围）', () => {
  // setup.ts 注册了 afterEach(cleanup)，每个 it 之间 DOM 会被卸载；
  // 用 beforeEach 重新 render，避免 describe 顶层 render 引用失效。
  let container: HTMLElement

  beforeEach(() => {
    ;({ container } = render(
      <InsightPageRenderer pageJson={{ _markdown: stripMarkdownCodeFence(REAL_FIXTURE_MD) }} />,
    ))
  })

  it('"核心论点"section 不应渲染空 wrapper（title 在但 content 已被 dropHrLines 丢弃）', () => {
    const allText = container.textContent ?? ''
    // title 文字"核心论点：因为智谱授权短期无解"应该完全不出现
    expect(allText).not.toContain('因为智谱授权短期无解')
    // 空 insight-card 不应该存在
    const emptyCards = [...container.querySelectorAll('.insight-card')].filter(c => c.children.length === 0)
    expect(emptyCards.length).toBe(0)
  })

  it('"行动指令与门禁"section 渲染 title 卡片', () => {
    const allText = container.textContent ?? ''
    expect(allText).toContain('行动指令与门禁')
  })

  it('"行动指令与门禁"section 的 ### 子标题渲染为 h4', () => {
    const h4s = [...container.querySelectorAll('h4')].map(h => h.textContent ?? '')
    expect(h4s.some(t => t.includes('给智谱线下最后通牒'))).toBe(true)
    expect(h4s.some(t => t.includes('借牌造课'))).toBe(true)
    expect(h4s.some(t => t.includes('敲门砖'))).toBe(true)
  })

  it('"行动指令与门禁"section 的 > 引用块渲染为 blockquote（止损条件等）', () => {
    const blockquotes = [...container.querySelectorAll('blockquote')].map(b => b.textContent ?? '')
    expect(blockquotes.some(t => t.includes('止损条件'))).toBe(true)
    expect(blockquotes.some(t => t.includes('一票否决'))).toBe(true)
    expect(blockquotes.some(t => t.includes('改判条件'))).toBe(true)
  })
})
