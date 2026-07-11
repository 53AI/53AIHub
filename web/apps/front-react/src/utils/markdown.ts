/**
 * Markdown 处理工具函数
 */

/**
 * 检测代码块开始 - 判断行是否为代码块的开始标记
 */
const isCodeBlockStart = (line: string): boolean => {
  return line.trim().startsWith('```')
}

/**
 * 检测代码块结束 - 判断行是否为代码块的结束标记
 */
const isCodeBlockEnd = (line: string): boolean => {
  return line.trim() === '```'
}

/**
 * 检测 HTML 注释开始 - 行内任一位置出现 `<!--`
 */
const isHtmlCommentStart = (line: string): boolean => {
  return line.includes('<!--')
}

/**
 * 检测 HTML 注释结束 - 行内任一位置出现 `-->`
 * 注意：当注释只是单行 `<!---->` 的退化形态时，
 * 同一行内 start 和 end 会同时成立，需要在同一行内一并处理。
 */
const isHtmlCommentEnd = (line: string): boolean => {
  return line.includes('-->')
}

/**
 * 检测markdown表格 - 判断行是否为表格行或表格分隔符
 */
const isMarkdownTable = (line: string): boolean => {
  const trimmedLine = line.trim()
  const isTableRow = trimmedLine.includes('|') && trimmedLine.split('|').length >= 3
  const isTableSeparator = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(trimmedLine)
  return isTableRow || isTableSeparator
}

/**
 * 检测markdown标题 - 判断行是否为markdown标题（H1-H6）
 */
const isMarkdownHeading = (line: string): boolean => {
  const trimmedLine = line.trim()
  return /^#{1,6}\s+/.test(trimmedLine)
}

/**
 * 检测markdown列表 - 判断行是否为列表项
 */
const isMarkdownList = (line: string): boolean => {
  const trimmedLine = line.trim()
  const isUnorderedList = /^[-*+]\s+/.test(trimmedLine)
  const isOrderedList = /^\d+\.\s+/.test(trimmedLine)
  const isTaskList = /^[-*+]\s+\[[ x]\]\s+/.test(trimmedLine)
  return isUnorderedList || isOrderedList || isTaskList
}

/**
 * 检测markdown引用块
 */
const isMarkdownBlockquote = (line: string): boolean => {
  return line.trim().startsWith('>')
}

/**
 * 检测markdown分隔线
 */
const isMarkdownHorizontalRule = (line: string): boolean => {
  const trimmedLine = line.trim()
  return /^(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)
}

/**
 * 检测markdown数学公式块
 */
const isMarkdownMathBlock = (line: string): boolean => {
  return line.trim() === '$$'
}

/**
 * 检测HTML块
 */
const isHtmlBlock = (line: string): boolean => {
  const trimmedLine = line.trim()
  return /^<[a-zA-Z][^>]*>/.test(trimmedLine) || /^<\/[a-zA-Z][^>]*>$/.test(trimmedLine)
}

/**
 * 智能分割markdown内容
 */
export const smartSplitMarkdown = (content: string): string[] => {
  const lines = content.split('\n')
  const results: string[] = []
  let currentBlock: string[] = []
  let inCodeBlock = false
  let inMathBlock = false
  let inHtmlComment = false
  let inHtmlBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (isCodeBlockStart(line) && !inCodeBlock && !inMathBlock) {
      if (currentBlock.length > 0) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      inCodeBlock = true
      currentBlock.push(line)
      continue
    }
    if (isCodeBlockEnd(line) && inCodeBlock) {
      currentBlock.push(line)
      results.push(currentBlock.join('\n'))
      currentBlock = []
      inCodeBlock = false
      continue
    }

    // HTML 注释块: 必须把跨行的 <!-- ... --> 整体识别为一个 block,
    // 否则会被按行拆开, 落到 chunk 切分逻辑时可能被截断到不同 chunk,
    // 渲染器(vditor) 见不到配对的 <!-- ... -->, 把注释里的标签当可见内容渲染
    if (isHtmlCommentStart(line) && !inHtmlComment && !inCodeBlock && !inMathBlock) {
      if (currentBlock.length > 0) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      inHtmlComment = true
      currentBlock.push(line)
      if (isHtmlCommentEnd(line)) {
        // 单行注释 <!-- foo -->: 直接关闭, 落盘
        results.push(currentBlock.join('\n'))
        currentBlock = []
        inHtmlComment = false
      }
      continue
    }
    if (inHtmlComment) {
      currentBlock.push(line)
      if (isHtmlCommentEnd(line)) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
        inHtmlComment = false
      }
      continue
    }

    if (isMarkdownMathBlock(line) && !inCodeBlock) {
      if (!inMathBlock) {
        if (currentBlock.length > 0) {
          results.push(currentBlock.join('\n'))
          currentBlock = []
        }
        inMathBlock = true
        currentBlock.push(line)
      } else {
        currentBlock.push(line)
        results.push(currentBlock.join('\n'))
        currentBlock = []
        inMathBlock = false
      }
      continue
    }

    if (inCodeBlock || inMathBlock) {
      currentBlock.push(line)
      continue
    }

    if (isMarkdownTable(line)) {
      if (currentBlock.length > 0) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      const tableLines = [line]
      while (i + 1 < lines.length && isMarkdownTable(lines[i + 1])) {
        i++
        tableLines.push(lines[i])
      }
      results.push(tableLines.join('\n'))
      continue
    }

    if (isMarkdownHeading(line)) {
      if (currentBlock.length > 0) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      results.push(line)
      continue
    }

    if (isMarkdownHorizontalRule(line)) {
      if (currentBlock.length > 0) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      results.push(line)
      continue
    }

    if (isMarkdownList(line)) {
      if (currentBlock.length > 0 && !isMarkdownList(currentBlock[currentBlock.length - 1])) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      currentBlock.push(line)
      if (
        i + 1 >= lines.length ||
        (!isMarkdownList(lines[i + 1]) && !lines[i + 1].trim().startsWith('  '))
      ) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      continue
    }

    if (isMarkdownBlockquote(line)) {
      if (currentBlock.length > 0 && !isMarkdownBlockquote(currentBlock[currentBlock.length - 1])) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      currentBlock.push(line)
      if (i + 1 >= lines.length || !isMarkdownBlockquote(lines[i + 1])) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      continue
    }

    // 多行 HTML 元素块 (CommonMark type-6 风格):
    // 进入 on a line that starts with a tag, 退出 on a blank line.
    // 这是为了避免 <details>...<summary>...</summary>\n...</details> 这种块被按行切碎,
    // 否则落到 splitMarkdownIntoChunks 时若被 splitLongText 横切,
    // 渲染器见不到闭合标签, 把中间内容暴露到界面上 (跟 HTML 注释同一个 bug 类).
    if (isHtmlBlock(line) && !inHtmlBlock && !inCodeBlock && !inMathBlock && !inHtmlComment) {
      if (currentBlock.length > 0) {
        results.push(currentBlock.join('\n'))
        currentBlock = []
      }
      inHtmlBlock = true
      currentBlock.push(line)
      continue
    }
    if (inHtmlBlock) {
      currentBlock.push(line)
      if (line.trim() === '') {
        results.push(currentBlock.join('\n'))
        currentBlock = []
        inHtmlBlock = false
      }
      continue
    }

    if (currentBlock.length > 0) {
      results.push(currentBlock.join('\n'))
      currentBlock = []
    }
    results.push(line)
  }

  if (currentBlock.length > 0) {
    results.push(currentBlock.join('\n'))
  }

  return results.filter((block) => block.trim().length > 0)
}

/**
 * 判断一个块是否为需要保持完整性的块级元素
 */
const isBlockElement = (block: string): boolean => {
  const trimmed = block.trim()
  return (
    trimmed.startsWith('```') ||
    trimmed.startsWith('<!--') ||
    trimmed === '$$' ||
    isMarkdownTable(trimmed.split('\n')[0]) ||
    isMarkdownHeading(trimmed.split('\n')[0]) ||
    isMarkdownList(trimmed.split('\n')[0]) ||
    isMarkdownBlockquote(trimmed.split('\n')[0]) ||
    isMarkdownHorizontalRule(trimmed.split('\n')[0]) ||
    isHtmlBlock(trimmed.split('\n')[0])
  )
}

/**
 * 将过长的文本块拆分为多个较小的块
 */
const splitLongText = (text: string, maxLength: number = 5000, maxLines: number = 50): string[] => {
  const lines = text.split('\n')
  const chunks: string[] = []
  let currentChunk: string[] = []
  let currentLength = 0

  for (const line of lines) {
    const lineLength = line.length + 1

    if (
      (currentLength + lineLength > maxLength || currentChunk.length >= maxLines) &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk.join('\n'))
      currentChunk = []
      currentLength = 0
    }

    currentChunk.push(line)
    currentLength += lineLength
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'))
  }

  return chunks
}

/**
 * 智能拆分 markdown 内容为适合渲染的 chunks
 */
export const splitMarkdownIntoChunks = (
  content: string,
  options: {
    maxChunkLength?: number
    maxChunkLines?: number
    minChunkLength?: number
  } = {}
): Array<{ content: string; id: number }> => {
  const {
    maxChunkLength = 5000,
    maxChunkLines = 50,
    minChunkLength = 500
  } = options

  const blocks = smartSplitMarkdown(content)
  const chunks: Array<{ content: string; id: number }> = []
  let chunkIndex = 0
  let textBuffer: string[] = []
  let bufferLength = 0

  const flushTextBuffer = () => {
    if (textBuffer.length === 0) return

    const combinedText = textBuffer.join('\n\n')

    if (combinedText.length > maxChunkLength || combinedText.split('\n').length > maxChunkLines) {
      const splitChunks = splitLongText(combinedText, maxChunkLength, maxChunkLines)
      splitChunks.forEach((chunk) => {
        if (chunk.trim()) {
          chunks.push({ content: chunk, id: chunkIndex++ })
        }
      })
    } else {
      chunks.push({ content: combinedText, id: chunkIndex++ })
    }

    textBuffer = []
    bufferLength = 0
  }

  for (const block of blocks) {
    if (isBlockElement(block)) {
      flushTextBuffer()
      chunks.push({ content: block, id: chunkIndex++ })
      continue
    }

    const blockLength = block.length
    const blockLines = block.split('\n').length

    if (blockLength > maxChunkLength || blockLines > maxChunkLines) {
      flushTextBuffer()
      const splitChunks = splitLongText(block, maxChunkLength, maxChunkLines)
      splitChunks.forEach((chunk) => {
        if (chunk.trim()) {
          chunks.push({ content: chunk, id: chunkIndex++ })
        }
      })
      continue
    }

    if (bufferLength + blockLength + 2 > maxChunkLength) {
      flushTextBuffer()
    }

    if (blockLength < minChunkLength) {
      textBuffer.push(block)
      bufferLength += blockLength + 2
    } else {
      flushTextBuffer()
      chunks.push({ content: block, id: chunkIndex++ })
    }
  }

  flushTextBuffer()

  return chunks.reduce((acc, chunk) => {
    const lastChunk = acc[acc.length - 1]
    if (lastChunk && (lastChunk.content.length + chunk.content.length < maxChunkLength)) {
      lastChunk.content += '\n\n' + chunk.content
    } else {
      acc.push({ content: chunk.content, id: chunk.id })
    }
    return acc
  }, [] as Array<{ content: string; id: number }>)
}

/**
 * 将 markdown 文本转换为纯文本
 */
export const mdToText = (mdText: string) => {
  if (!mdText) return ''
  let text = mdText

  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, '\n$1\n')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[图片$1]')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  let prevText
  let loopCount = 0
  do {
    prevText = text
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
    text = text.replace(/(\*|_)(.*?)\1/g, '$2')
    text = text.replace(/~~(.*?)~~/g, '$1')
    loopCount++
  } while (text !== prevText && loopCount < 5)

  text = text.replace(/^#{1,6}\s+(.*)$/gm, '$1')
  text = text.replace(/^\s*>\s+/gm, '')
  text = text.replace(/^(\s*)[-*+]\s+/gm, '$1• ')
  text = text.replace(/^\s*\|[-:| ]+\|\s*$/gm, '')
  text = text.replace(/^\||\|$/gm, '')
  text = text.replace(/\n{3,}/g, '\n\n').trim()

  return text
}
