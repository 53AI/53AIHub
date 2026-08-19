/**
 * richText.tsx 渲染函数测试
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMarkdownText } from './richText';

describe('renderMarkdownText', () => {
  it('renders markdown table as <table> with thead/tbody', () => {
    const md = [
      '| Name | Score |',
      '| --- | --- |',
      '| Alice | 90 |',
      '| Bob | 75 |',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const table = container.querySelector('table.insight-table')
    expect(table).not.toBeNull()
    const headers = container.querySelectorAll('thead th')
    expect(headers).toHaveLength(2)
    expect(headers[0].textContent).toBe('Name')
    expect(headers[1].textContent).toBe('Score')
    const rows = container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Alice')
    expect(rows[0].textContent).toContain('90')
    expect(rows[1].textContent).toContain('Bob')
    expect(rows[1].textContent).toContain('75')
  })

  it('renders table without surrounding pipes', () => {
    const md = [
      'A | B',
      '--- | ---',
      '1 | 2',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const headers = container.querySelectorAll('thead th')
    expect(headers).toHaveLength(2)
    expect(headers[0].textContent).toBe('A')
    expect(headers[1].textContent).toBe('B')
    const rows = container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('1')
    expect(rows[0].textContent).toContain('2')
  })

  it('parses alignment markers in separator row', () => {
    const md = [
      '| Left | Center | Right |',
      '| :--- | :---: | ---: |',
      '| a | b | c |',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const headers = container.querySelectorAll('thead th')
    expect(headers[0].style.textAlign).toBe('left')
    expect(headers[1].style.textAlign).toBe('center')
    expect(headers[2].style.textAlign).toBe('right')
    const cells = container.querySelectorAll('tbody td')
    expect(cells[0].style.textAlign).toBe('left')
    expect(cells[1].style.textAlign).toBe('center')
    expect(cells[2].style.textAlign).toBe('right')
  })

  it('processes inline markdown within cells', () => {
    const md = [
      '| Key | Value |',
      '| --- | --- |',
      '| **bold** | `code` |',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const cell = container.querySelector('tbody td')!
    expect(cell.querySelector('strong')?.textContent).toBe('bold')
    const codeCell = container.querySelectorAll('tbody td')[1]
    expect(codeCell.querySelector('code')?.textContent).toBe('code')
  })

  it('passes paragraph through when no table', () => {
    const md = 'Just a plain paragraph.'
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe('Just a plain paragraph.')
  })

  it('stops table at first non-pipe line', () => {
    const md = [
      '| H1 | H2 |',
      '| --- | --- |',
      '| a | b |',
      '',
      'paragraph after table',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('table')).not.toBeNull()
    const rows = container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(container.querySelector('p')?.textContent).toBe('paragraph after table')
  })

  it('renders empty cell as empty string', () => {
    const md = [
      '| A | B |',
      '| --- | --- |',
      '|  | x |',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const cells = container.querySelectorAll('tbody td')
    expect(cells[0].textContent).toBe('')
    expect(cells[1].textContent).toBe('x')
  })
})

describe('renderMarkdownText — 围栏代码块', () => {
  it('```lang 围栏渲染为 <pre.insight-code-block>，带 language-X class', () => {
    const md = ['```js', 'const x = 1', 'const y = 2', '```'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const pre = container.querySelector('pre.insight-code-block')
    expect(pre).not.toBeNull()
    const code = pre!.querySelector('code.language-js')
    expect(code).not.toBeNull()
    expect(code!.textContent).toBe('const x = 1\nconst y = 2')
  })

  it('```mermaid 围栏渲染为 MermaidDiagram（inline 模式，不再拆走为独立 block）', () => {
    // 之前会把 mermaid 在 markdownParser 阶段抽走，能落回到 renderMarkdownText 的
    // 是解析失败 / 兜底场景；现在围栏原地解析为 MermaidDiagram inline 渲染，
    // 图作为源段落正文的一部分，与前后散文一起在同一张卡片里展示。
    const md = ['```mermaid', 'flowchart TB', '    A --> B', '```'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    // .insight-mermaid-flow 是 MermaidFlowRenderer 的根 class，证明解析成功 + inline 渲染
    const flow = container.querySelector('.insight-mermaid-flow')
    expect(flow).not.toBeNull()
    // 同时套了 viewport 外壳（拿负 margin 等样式）
    expect(container.querySelector('.insight-mermaid-viewport')).not.toBeNull()
    // 不应再渲染为代码块（除非解析失败兜底）
    expect(container.querySelector('pre.insight-code-block')).toBeNull()
  })

  it('```mermaid 围栏前后段落与图 inline 共存：散文→图→散文，按文档顺序渲染', () => {
    const md = ['前置散文。', '', '```mermaid', 'flowchart LR', '    X --> Y', '```', '', '后置散文。'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs.length).toBeGreaterThanOrEqual(2)
    expect(paragraphs[0].textContent).toBe('前置散文。')
    expect(paragraphs[paragraphs.length - 1].textContent).toBe('后置散文。')
    // 围栏渲染为 viewport 内的 MermaidFlowRenderer，前后 <p> 都存在
    expect(container.querySelector('.insight-mermaid-viewport')).not.toBeNull()
    expect(container.querySelector('.insight-mermaid-flow')).not.toBeNull()
  })

  it('```mermaid 未支持方言：解析失败时降级为 <pre><code>，保留源码供排查', () => {
    const md = ['```mermaid', 'erDiagram', '    CUSTOMER ||--o{ ORDER : places', '```'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    // parseMermaidDiagram 失败 → 走兜底代码块
    const pre = container.querySelector('pre.insight-code-block')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain('erDiagram')
    expect(pre!.textContent).toContain('CUSTOMER')
  })

  it('```mermaid 时序图：inline 渲染为 sequence renderer', () => {
    const md = ['```mermaid', 'sequenceDiagram', '    A->>B: hi', '```'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    // sequence renderer 的根 class
    const seq = container.querySelector('.insight-mermaid-sequence')
    expect(seq).not.toBeNull()
    expect(container.querySelector('.insight-mermaid-viewport')).not.toBeNull()
  })

  it('裸 ```（无语言）也识别', () => {
    const md = ['```', 'plain text', '```'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const pre = container.querySelector('pre.insight-code-block')
    expect(pre).not.toBeNull()
    const code = pre!.querySelector('code')
    expect(code?.className).toBe('')
  })

  it('多行代码块保留换行（white-space: pre）', () => {
    const md = ['```ts', 'line1', 'line2', 'line3', '```'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const code = container.querySelector('pre.insight-code-block code')!
    expect(code.textContent).toBe('line1\nline2\nline3')
  })

  it('代码块前后段落不与代码块混排', () => {
    const md = ['前置段落', '', '```py', 'print(1)', '```', '', '后置段落'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const pre = container.querySelector('pre.insight-code-block')
    expect(pre).not.toBeNull()
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs.length).toBeGreaterThanOrEqual(2)
    expect(paragraphs[0].textContent).toBe('前置段落')
    expect(paragraphs[paragraphs.length - 1].textContent).toBe('后置段落')
  })
})
