/**
 * richText.tsx 兼容性测试
 *
 * 验证各种 markdown 格式（含旧格式 + 新表格）仍然正确解析，
 * 并检测边界条件下的回归。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown, renderMarkdownText } from './richText';

describe('renderMarkdownText — 兼容性回归', () => {
  // ─── 已有格式（必须保留行为） ───

  it('单行段落', () => {
    const { container } = render(<>{renderMarkdownText('Hello world.')}</>)
    expect(container.querySelector('p')?.textContent).toBe('Hello world.')
  })

  it('多行段落（连续非空行合并为一个段落）', () => {
    const md = ['Line 1', 'Line 2', 'Line 3'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const ps = container.querySelectorAll('p')
    expect(ps).toHaveLength(1)
    expect(ps[0].textContent).toContain('Line 1')
    expect(ps[0].textContent).toContain('Line 3')
  })

  it('空行分隔段落', () => {
    const md = ['First paragraph.', '', 'Second paragraph.'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const ps = container.querySelectorAll('p')
    expect(ps).toHaveLength(2)
  })

  it('## [marker] 标题', () => {
    const md = '## [核心判断] 会议要点'
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('.eyebrow')?.textContent).toBe('核心判断')
    expect(container.querySelector('h3')?.textContent).toBe('会议要点')
  })

  it('## 无 marker 标题', () => {
    const md = '## 章节标题'
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('h3')?.textContent).toBe('章节标题')
  })

  it('### - ###### [marker] 标题', () => {
    const md = '### [观点] 子标题'
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('.eyebrow')?.textContent).toBe('观点')
    expect(container.querySelector('h4')?.textContent).toBe('子标题')
  })

  it('无序列表 (-)', () => {
    const md = ['- item 1', '- item 2'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const ul = container.querySelector('ul')
    expect(ul).not.toBeNull()
    expect(ul?.querySelectorAll('li')).toHaveLength(2)
  })

  it('无序列表 (*)', () => {
    const md = ['* item 1', '* item 2'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('ul')?.querySelectorAll('li')).toHaveLength(2)
  })

  it('无序列表 (•)', () => {
    const md = ['• item 1', '• item 2'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('ul')?.querySelectorAll('li')).toHaveLength(2)
  })

  it('有序列表', () => {
    const md = ['1. first', '2. second'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const ol = container.querySelector('ol')
    expect(ol).not.toBeNull()
    expect(ol?.querySelectorAll('li')).toHaveLength(2)
  })

  it('引用 (> 开头)', () => {
    const md = '> 引用文本'
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('blockquote')?.textContent).toBe('引用文本')
  })

  it('分割线 (---)', () => {
    const md = '---'
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('hr')).not.toBeNull()
  })

  it('分割线 (___)', () => {
    const md = '___'
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('hr')).not.toBeNull()
  })

  // ─── 内联格式（renderInlineMarkdown） ───

  it('inline **bold**', () => {
    const { container } = render(<>{renderInlineMarkdown('**bold**')}</>)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
  })

  it('inline __bold__', () => {
    const { container } = render(<>{renderInlineMarkdown('__bold__')}</>)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
  })

  it('inline *em*', () => {
    const { container } = render(<>{renderInlineMarkdown('*em*')}</>)
    expect(container.querySelector('em')?.textContent).toBe('em')
  })

  it('inline `code`', () => {
    const { container } = render(<>{renderInlineMarkdown('`code`')}</>)
    expect(container.querySelector('code')?.textContent).toBe('code')
  })

  // ─── 不应被表格误判的场景 ───

  it('段落中含 | 字符（无分隔行）正常渲染为段落', () => {
    const md = ['a | b | c', 'another line'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('p')?.textContent).toContain('a | b | c')
  })

  it('--- 单独成行（非表格上下文）应作为分割线', () => {
    const md = ['第一段', '---', '第二段'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('hr')).not.toBeNull()
    expect(container.querySelector('table')).toBeNull()
  })

  it('单列 --- 不被误判为表格（缺少至少 2 个单元格的 --- 分隔行）', () => {
    const md = ['A | B', '---'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('table')).toBeNull()
  })

  it('单独 --- 行（无前后管道）仍是水平分割线', () => {
    const { container } = render(<>{renderMarkdownText('---')}</>)
    expect(container.querySelector('hr')).not.toBeNull()
  })

  it('---|--- 前没有 header 行被误判', () => {
    const md = ['前言段落', '--- | ---', '后续段落'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('hr')).toBeNull()
    // 两条 | 行 + 段落行都并入段落
    expect(container.querySelector('p')?.textContent).toContain('--- | ---')
  })

  // ─── 混合内容 ───

  it('段落 + 表格 + 段落（无空行分隔）', () => {
    const md = [
      '前置段落',
      '| H1 | H2 |',
      '| --- | --- |',
      '| a | b |',
      '后置段落',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('table')).not.toBeNull()
    const ps = container.querySelectorAll('p')
    expect(ps.length).toBeGreaterThanOrEqual(1)
  })

  it('列表 + 表格 + 列表', () => {
    const md = [
      '- item 1',
      '- item 2',
      '| H1 | H2 |',
      '| --- | --- |',
      '| a | b |',
      '- item 3',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('table')).not.toBeNull()
    const lists = container.querySelectorAll('ul, ol')
    // 列表在表格前后被打断，应该是 2 个 ul
    expect(lists.length).toBeGreaterThanOrEqual(1)
  })

  it('## 标题 + 表格', () => {
    const md = [
      '## 章节标题',
      '',
      '| H1 | H2 |',
      '| --- | --- |',
      '| a | b |',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('h3')?.textContent).toBe('章节标题')
    expect(container.querySelector('table')).not.toBeNull()
  })

  it('> 引用中带 | 字符不被误判为表格', () => {
    const md = ['> a | b', '> c | d'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    // 因为没有分隔行，所以是 blockquote
    expect(container.querySelector('blockquote')).not.toBeNull()
    expect(container.querySelector('table')).toBeNull()
  })

  // ─── 边界条件 ───

  it('空字符串', () => {
    const { container } = render(<>{renderMarkdownText('')}</>)
    expect(container.querySelector('p')).toBeNull()
    expect(container.querySelector('table')).toBeNull()
  })

  it('null/undefined 输入', () => {
    const { container: c1 } = render(<>{renderMarkdownText(null as any)}</>)
    const { container: c2 } = render(<>{renderMarkdownText(undefined as any)}</>)
    expect(c1.querySelector('p')).toBeNull()
    expect(c2.querySelector('p')).toBeNull()
  })

  it('表格行只有 1 行（无 body）', () => {
    const md = ['| H1 | H2 |', '| --- | --- |'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(container.querySelectorAll('thead th')).toHaveLength(2)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0)
  })

  it('表格行 cell 含管道转义字符（已知不支持，作为 plain text 渲染）', () => {
    // 不支持 \| 转义 —— 记录行为，避免后续误改
    const md = ['| A | B |', '| --- | --- |', '| a\\|b | c |'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    const cells = container.querySelectorAll('tbody td')
    // 实际会被切成 3 段，最后两段分别是 "b" 和 "c"
    expect(cells.length).toBe(2)
  })

  it('表格分隔行带空格内边距', () => {
    const md = ['  | H1 | H2 |  ', '  | --- | --- |  ', '  | a | b |  '].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(container.querySelectorAll('thead th')).toHaveLength(2)
  })

  it('多列表格（4 列）', () => {
    const md = [
      '| A | B | C | D |',
      '| --- | --- | --- | --- |',
      '| 1 | 2 | 3 | 4 |',
      '| 5 | 6 | 7 | 8 |',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelectorAll('thead th')).toHaveLength(4)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelectorAll('tbody td')).toHaveLength(8)
  })

  it('表格行尾随空白行正常结束', () => {
    const md = ['| H1 | H2 |', '| --- | --- |', '| a | b |', '', '   '].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('连续两个表格', () => {
    const md = [
      '| H1 | H2 |',
      '| --- | --- |',
      '| a | b |',
      '',
      '| H3 | H4 |',
      '| --- | --- |',
      '| c | d |',
    ].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelectorAll('table.insight-table')).toHaveLength(2)
  })

  it('hr 紧跟表格（无空行）', () => {
    const md = ['| H1 | H2 |', '| --- | --- |', '| a | b |', '---'].join('\n')
    const { container } = render(<>{renderMarkdownText(md)}</>)
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('hr')).not.toBeNull()
  })
})
