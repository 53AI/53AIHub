/**
 * Markdown 语义标记解析器
 *
 * ```mermaid``` 围栏**不在解析阶段抽取**，而是留在源字符串字段里（`content` /
 * `intro` / `outro` / `steps[].description` / `items[].content` ...），由
 * renderMarkdownText 原地解析并以 MermaidDiagram inline 渲染。这样图作为源段落
 * 正文的一部分渲染在同一个卡片里，避免被拆成独立 block 漂在源段落外面造成视觉割裂。
 */

// ============= Preprocessing =============

/**
 * 去掉 Markdown 围栏代码块的外壳（``` ... ```）。
 *
 * 后端有时会把整段 markdown 用 ```markdown … ``` 包起来返回（类似 LLM 输出）。
 * 围栏既不是页面标题也不属于任何 ## 段落，必须先剥掉，否则：
 * - 首行不再是 # 标题，parseInsightMarkdown 取不到 pageTitle
 * - 列表描述提取会泄漏 ```markdown 字样
 *
 * 只识别整段被一个围栏包裹的情况（trim 后整段在 ```…``` 之间），
 * 中间嵌套或部分围栏的内容不动。
 */
export function stripMarkdownCodeFence(md: string): string {
  const trimmed = md.replace(/\r\n/g, '\n').trim()
  // 开头 ``` 后面可选一个语言标识（字母数字下划线连字符），然后换行
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/)
  return match ? match[1] : md
}

// ============= 常量映射 =============

/** 语义标记 → block type 映射 */
const MARKER_TO_BLOCK_TYPE: Record<string, string> = {
  '核心判断': 'hero_judgment',
  '战略定调': 'decision_banner',
  '已形成决定': 'decision_banner',
  '观点与讨论': 'section',
  '风险': 'risk_list',
  '脆弱假设': 'assumption_chain',
  '因果链': 'flow_diagram',
  '历史提醒': 'section',
  '提醒': 'section',
  '关键节点': 'timeline',
  '时间线': 'timeline',
  '行动': 'action_list',
  '门禁': 'red_line',
  '决策边界': 'red_line',
  '边界': 'red_line',
  '对比': 'comparison',
  '待验证': 'verification_list',
  '引用': 'callout',
  '深度分析': 'section',
  '破局点': 'section',
  '洞察': 'section',
}

/** block type → eyebrow 默认文案 */
const BLOCK_TYPE_EYEBROW: Record<string, string> = {
  'hero_judgment': '核心判断',
  'decision_banner': '会议决定',
  'section': '分析说明',
  'paragraph': '分析说明',
  'callout': '风险提醒',
  'quote': '会议原话',
  'risk_list': '风险提示',
  'action_list': '行动清单',
  'verification_list': '待验证',
  'flow_diagram': '假设链路',
  'assumption_chain': '脆弱假设',
  'timeline': '关键节点',
  'comparison': '对比判断',
  'red_line': '决策边界',
}

// ============= Helper 函数 =============

/**
 * 列表项前缀：无序 `-` / `*` / `•`，或有序 `1.` / `1)`，后跟至少一个空白。
 *
 * 关键：marker 后**必须**有空白，才能与 `**bold**` / `*italic*` 区分开
 * （`**假设：…**` 的开头是 `*` 紧跟 `*`，无空白，不会被误判为列表项）。
 * 有序前缀要求"数字 + . 或 )"，也不会误伤 `3.5 版本` 这类文本（`.` 后无空白）。
 * 与渲染层 renderMarkdownText 的列表识别规则保持一致，避免解析/渲染两边不一致。
 */
const LIST_ITEM_PREFIX_RE = /^(?:[-*•]|\d+[.)])\s+/

/** 从 Markdown body 中提取段落文本（去掉 ### 子标题、列表、> 引用，只留纯文本段落） */
function extractParagraphs(body: string): string[] {
  return body
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('###') && !LIST_ITEM_PREFIX_RE.test(l) && !l.startsWith('>') && !l.startsWith('#'))
}

/**
 * 从 Markdown body 中丢弃纯 `---` 分隔线（不参与任何渲染）。
 * 在 part 内部 body 解析处调用：避免"## 标题 + 单独 ---"这种只有标题没正文的 section
 * 渲染出 content="---" → 视觉上的"矮空白卡片"。
 * 不处理 > 引用块（交给 renderMarkdownText 在渲染层处理，避免重复逻辑）。
 */
function dropHrLines(body: string): string {
  return body
    .split('\n')
    .filter(l => !/^---+$/.test(l.trim()))
    .join('\n')
}

/** 从 Markdown body 中提取列表项（-/*\/• 或 有序 1. 开头） */
function extractListItems(body: string): string[] {
  return body
    .split('\n')
    .map(l => l.trim())
    .filter(l => LIST_ITEM_PREFIX_RE.test(l))
    .map(l => l.replace(LIST_ITEM_PREFIX_RE, '').trim())
}

/**
 * 从 Markdown body 中提取"段落性 intro 行"。
 *
 * 与 extractParagraphs 的关键区别：**保留段落间的空行作为分隔符**，
 * 这样下游 renderMarkdownText 仍能正确渲染出多个独立 <p>，
 * 而不是把所有非列表行拼成一个 <br> 段落。
 *
 * 过滤掉：
 *   - `- ` 列表项（交给 extractListItems / 独立逻辑处理）
 *   - `#` / `###` 标题
 *   - `>` 引用
 *
 * 不过滤空行 — 空行作为段落分隔符被保留下来。
 */
function extractIntroLines(body: string): string[] {
  return body
    .split('\n')
    .map(l => l.trim())
    .filter(l => !LIST_ITEM_PREFIX_RE.test(l) && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('###'))
}

/**
 * 把 intro 行拼回 markdown 字符串。
 * 默认保留段落空行分隔符；不需要段落分隔时可传 `{ collapse: true }`。
 */
function buildIntro(body: string, opts?: { collapse?: boolean }): string {
  const lines = extractIntroLines(body)
  const filtered = opts?.collapse ? lines.filter(l => l.length > 0) : lines
  return filtered.join('\n')
}

/**
 * 从 body 中提取 intro 行，自动排除已分配到 sub-sections 的描述行，
 * 避免 flow_diagram / timeline / comparison 等 block 的描述文字同时出现在
 * intro 和 nodes 中造成重复渲染。
 */
function buildIntroOutsideSubSections(
  body: string,
  subSections: Array<{ content: string }>,
): string {
  if (subSections.length === 0) {
    return buildIntro(body, { collapse: true })
  }
  // 收集所有 sub-section content 的非空行（trim 后比较）
  const consumed = new Set<string>()
  for (const sub of subSections) {
    for (const line of sub.content.split('\n')) {
      const t = line.trim()
      if (t) consumed.add(t)
    }
  }
  // 走原始扫描逻辑，但排除被 sub-section 消耗的行
  const result: string[] = []
  for (const raw of body.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (LIST_ITEM_PREFIX_RE.test(trimmed) || trimmed.startsWith('#') || trimmed.startsWith('>')) continue
    if (consumed.has(trimmed)) continue
    result.push(trimmed)
  }
  return result.join('\n').trim()
}

/**
 * 判断一组 `- ` 列表项是否全部带 `**标题：**` 模式（即都是结构化条目）。
 * 列表为空时返回 false（不属于"全为有标题条目"）。
 */
function allBulletsAreTitled(items: string[]): boolean {
  return items.length > 0 && items.every(raw => /^\*\*(.+?)\*\*[：:]\s*/.test(raw))
}

/**
 * 把带 `**标题：**` 的列表项解析为 `{ title, content }`。
 * 不带该模式的项退化为 `{ title: '', content: raw }`。
 */
function parseTitledBullets(items: string[]): Array<{ title: string; content: string }> {
  return items.map(raw => {
    const match = raw.match(/^\*\*(.+?)\*\*[：:]\s*(.*)/)
    return match ? { title: match[1], content: match[2] } : { title: '', content: raw }
  })
}

/**
 * 解析 action_list 项的结构化字段（责任人/时间/验收/交付物/前置/禁止）。
 * 接受带 `**标题：**` 模式的内容字符串，输出对应字段（找不到则为空字符串）。
 */
function parseActionMetadata(content: string): Record<string, string> {
  const result: Record<string, string> = {
    owner: '',
    deliverable: '',
    acceptance_criteria: '',
    deadline: '',
    prerequisite: '',
    prohibition: '',
  }
  const patterns = [
    { key: 'owner', re: /责任人[：:]\s*([^，,。]+)/ },
    { key: 'deadline', re: /时间[：:]\s*([^，,。]+)/ },
    { key: 'acceptance_criteria', re: /验收标准[：:]\s*([^，,。]+)/ },
    { key: 'deliverable', re: /交付物[：:]\s*([^，,。]+)/ },
    { key: 'prerequisite', re: /前置条件[：:]\s*([^，,。]+)/ },
    { key: 'prohibition', re: /禁止[：:]\s*([^。]+)/ },
  ]
  for (const p of patterns) {
    const m = content.match(p.re)
    if (m) result[p.key] = m[1].trim()
  }
  return result
}

/** 从 Markdown body 中提取 ### 子标题及其后续内容 */
function extractSubSections(body: string): Array<{ label: string; content: string }> {
  const lines = body.split('\n')
  const sections: Array<{ label: string; content: string }> = []
  let current: { label: string; content: string } | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    const subHeader = trimmed.match(/^###\s+(.+)/)
    if (subHeader) {
      if (current) sections.push(current)
      current = { label: subHeader[1].trim(), content: '' }
    } else if (current && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('>')) {
      current.content += (current.content ? '\n' : '') + trimmed
    }
  }
  if (current) sections.push(current)
  return sections
}

// ============= Block 解析函数（供 marker / plain header 两条路径复用） =============

/**
 * 判断 body 是否包含"环绕列表的散文行"（非空、非列表、非标题、非引用）。
 * 用于区分两种语义：
 * - 纯列表（无环绕散文）→ 列表项就是结构化条目，应该提取为 items
 * - 段落 + 列表 + 段落 → 列表项是叙事一部分，应保留为 markdown 渲染
 */
function hasProseAroundBullets(body: string): boolean {
  return extractIntroLines(body).some(l => l.length > 0)
}

/** 解析 risk_list block data。
 *
 * 结构：
 * - intro = 列表 **之前** 的段落（开头导语）
 * - items = 列表项（提取为带标题的 risk 卡片，红色样式）
 * - outro = 列表 **之后** 的段落（如"影响："总结）
 *
 * 这是用户确认的"需要的样式"：风险列表总是把 bullets 提取为 items 卡片，
 * 散文作为段落渲染。关键在于**按位置切分散文**——列表前的散文渲染在
 * items 上方（intro），列表后的散文渲染在 items 下方（outro），
 * 保留"导语 → 风险条目 → 影响总结"的自然阅读顺序。
 *
 * 注：intro/outro 各自用单 `\n` 连接（让多段合并成一个 `<p>` 块，段间 `<br>`）。
 */
function parseRiskListData(eyebrow: string, title: string, body: string) {
  const rawLines = body.split('\n').map(l => l.trim())
  const listItems: string[] = []
  const introLines: string[] = []
  const outroLines: string[] = []
  let seenBullet = false

  for (const line of rawLines) {
    if (!line || line.startsWith('#') || line.startsWith('>')) continue
    if (LIST_ITEM_PREFIX_RE.test(line)) {
      seenBullet = true
      listItems.push(line.replace(LIST_ITEM_PREFIX_RE, '').trim())
      continue
    }
    // 散文行：根据是否已出现 bullet，归入 intro（列表前）或 outro（列表后）
    if (seenBullet) {
      outroLines.push(line)
    } else {
      introLines.push(line)
    }
  }

  // bullets 总是被提取为 items
  const items = listItems.map(raw => {
    const match = raw.match(/^\*\*(.+?)\*\*[：:]\s*(.*)/)
    if (match) {
      return { title: match[1], content: match[2], severity: 'high' }
    }
    return { title: raw, content: '', severity: 'high' }
  })

  return {
    eyebrow,
    title,
    intro: introLines.join('\n').trim(),
    outro: outroLines.join('\n').trim(),
    items,
  }
}

/** 解析 action_list block data。
 *
 * 语义区别于 risk_list：action_list 的列表项就是结构化的行动条目，
 * 总是应被提取为 items；环绕的散文（如导语）作为 intro 单独渲染。
 *
 * - 有列表项 → 提取为 items（含元数据），散文作为 intro
 * - 无列表项 → 整段内容作为 intro 渲染
 */
function parseActionListData(eyebrow: string, title: string, body: string) {
  const listItems = extractListItems(body)
  const baseIntro = buildIntro(body)

  if (listItems.length === 0) {
    return { eyebrow, title, intro: baseIntro, items: [] as Array<Record<string, string>> }
  }
  // 列表项总是被提取为 items；散文作为 intro 单独渲染
  const items = listItems.map(raw => {
    const match = raw.match(/^\*\*(.+?)\*\*[：:]\s*(.*)/)
    if (match) {
      const meta = parseActionMetadata(match[2])
      return {
        title: match[1],
        action: match[2],
        ...meta,
      }
    }
    // 无标题的列表项 → 整段作为 action 字段，metadata 为空
    return {
      title: '',
      action: raw,
      ...parseActionMetadata(''),
    }
  })
  return { eyebrow, title, intro: baseIntro.trim(), items }
}

/** 解析 verification_list block data。
 *
 * 与 action_list 一致：列表项总是被提取为 items，散文作为 intro。
 * （区别于 risk_list — 风险讨论常需要"段落 + 列表 + 段落"叙事结构）
 */
function parseVerificationListData(eyebrow: string, title: string, body: string) {
  const listItems = extractListItems(body)
  const baseIntro = buildIntro(body)

  if (listItems.length === 0) {
    return { eyebrow, title, intro: baseIntro, items: [] as Array<{ item: string; content: string }> }
  }
  // 列表项总是被提取为 items；散文作为 intro 单独渲染
  const items = parseTitledBullets(listItems).map(b => ({ item: b.title, content: b.content }))
  return { eyebrow, title, intro: baseIntro, items }
}

/**
 * 从 body 中提取 `#待验证 XXX` 行（一个或多个），并返回清理过的 body。
 * 配合 assumption_chain 使用：让"待验证"标签成为独立的视觉钩子，
 * 而不是被丢弃或当成 H1 渲染（避免 silent content loss）。
 */
function extractValidationTag(body: string): { tag: string; cleaned: string } {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const tagParts: string[] = []
  const kept: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    // 匹配 "#待验证 XXX" 或 "#待验证：XXX" — 仅取首个匹配，多个并列用 '；' 拼
    const match = trimmed.match(/^#待验证[：:\s]+(.+)/)
    if (match) {
      tagParts.push(match[1].trim())
      continue
    }
    kept.push(line)
  }
  return {
    tag: tagParts.join('；'),
    cleaned: kept.join('\n'),
  }
}

/**
 * 根据 ### 子标题的标签文本，分类该步骤的"语义色调"。
 * - claim：命题/假设本身（被验证的对象）
 * - fragility：暴露脆弱的论据/反驳/教训
 * - alternative：替代解释/真实情况
 * - note：兜底（普通解释节点）
 *
 * 优先级：fragility > alternative > claim。复合词（如"假设的危险性"）通常
 * 不是命题本身，而是"关于假设的脆弱点描述"，所以先匹配 fragility/alternative，
 * 剩下的才回落到 claim，避免误吞复合 fragility 标签。
 */
function classifyAssumptionStepTone(label: string): 'claim' | 'fragility' | 'alternative' | 'note' {
  const text = label.trim()
  // fragility 优先：含"脆弱/危险/危害/错判/后果/教训/反驳..."的复合词
  if (/脆弱|危险|危害|错判|误判|反驳|论据|反对|缺陷|后果|教训|danger|fragility|weakness|risk/i.test(text)) return 'fragility'
  if (/替代|真实|instead|alternative|真相|实际|反面/i.test(text)) return 'alternative'
  // claim：以"假设/命题/断言/claim/assumption/论断"开头（无 fragility/alternative 命中才到这一步）
  if (/^(假设|命题|断言|claim|assumption|论断|假设命题|核心假设)/.test(text)) return 'claim'
  return 'note'
}

/**
 * 解析 assumption_chain block data（### 子标题路径）。
 *
 * 结构：
 * - intro = ### 之前的散文
 * - steps = ### 子标题（按标签分类 tone）
 * - validationTag = body 中任意位置的 `#待验证 XXX` 行
 *
 * 与 flow_diagram 的关键区别：所有 steps 都按"论据节点"对待，
 * 但视觉上根据 tone 套用不同样式（命题框 / 琥珀警告 / 替代解释 / 普通节点），
 * 让"假设 → 脆弱 → 替代"的论证结构在视觉上是连续的论证链，
 * 而不是被压扁成同色的 risk 卡片网格。
 */
function parseAssumptionChainData(eyebrow: string, title: string, body: string) {
  const { tag, cleaned } = extractValidationTag(body)
  const subSections = extractSubSections(cleaned)
  if (subSections.length === 0) {
    return {
      eyebrow,
      title,
      intro: buildIntro(cleaned, { collapse: true }),
      steps: [] as Array<{ label: string; description: string; tone: string }>,
      validationTag: tag,
    }
  }
  const steps = subSections.map(s => ({
    label: s.label,
    description: s.content,
    tone: classifyAssumptionStepTone(s.label),
  }))
  // intro 必须排除 sub-sections 的描述行，否则会与 steps[i].description 重复
  const intro = buildIntroOutsideSubSections(cleaned, subSections)
  return { eyebrow, title, intro, steps, validationTag: tag }
}

/**
 * 解析 assumption_chain block data（bullet 路径）。
 *
 * 用于以下 markdown 写法（与 ### 子标题路径完全等效）：
 * ```
 * - **假设的危险性**：只补卡片，无法解决内容臃肿。
 * - **过往教训**：颜色规范上掉进"讨论完就忘"的坑。
 * ```
 *
 * 提取规则：
 * - 每个 `- **XXX**：YYY` 解析为 { label: 'XXX', description: 'YYY...' }
 * - label 用于 tone 分类（"危险性" → fragility 等）
 * - 没有 **标题：** 模式的 bullet 整段作为 label，description 为空
 * - bullet 之前的散文 → intro；bullet 之后的散文 → outro
 *
 * 这样脆弱假设可以直接用最自然的 bullet 写法展示出"命题 → 论据 → 替代"结构，
 * 不需要用户为每个论点显式写 `###` 子标题。
 */
function parseAssumptionChainFromBullets(eyebrow: string, title: string, body: string) {
  const { tag, cleaned } = extractValidationTag(body)
  const rawLines = cleaned.split('\n').map(l => l.trim())
  const introLines: string[] = []
  const outroLines: string[] = []
  const bulletRows: string[] = []
  let seenBullet = false

  for (const line of rawLines) {
    if (!line || line.startsWith('#') || line.startsWith('>')) continue
    if (LIST_ITEM_PREFIX_RE.test(line)) {
      seenBullet = true
      bulletRows.push(line.replace(LIST_ITEM_PREFIX_RE, '').trim())
      continue
    }
    // 散文行：按是否已出现 bullet 分流到 intro / outro（与 risk_list 顺序一致）
    if (seenBullet) outroLines.push(line)
    else introLines.push(line)
  }

  const steps = bulletRows.map(raw => {
    const match = raw.match(/^\*\*(.+?)\*\*[：:]\s*(.*)/)
    if (match) {
      return {
        label: match[1].trim(),
        description: match[2].trim(),
        tone: classifyAssumptionStepTone(match[1]),
      }
    }
    return {
      label: raw,
      description: '',
      tone: classifyAssumptionStepTone(raw),
    }
  })

  return {
    eyebrow,
    title,
    intro: introLines.join('\n').trim(),
    outro: outroLines.join('\n').trim(),
    steps,
    validationTag: tag,
  }
}

/**
 * 从 body 末尾提取 markdown 引用块（> 开头的连续行）作为 closing 文案。
 * 仅当引用块出现在 body 末尾（前面有空行分隔，或 body 整体就是引用块）时才提取。
 * 返回 { quote, remaining }，未匹配到时返回 null。
 */
function extractClosingQuote(body: string): { quote: string; remaining: string } | null {
  if (!body) return null
  // 按 \n\n 分段，从末尾向前查找第一段全部由 > 开头（或空行）组成的引用块
  // 这里采用按行扫描的方式，更稳健地处理末尾引用块
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  // 从末尾向前找到第一个非空行
  let endIdx = lines.length - 1
  while (endIdx >= 0 && lines[endIdx].trim() === '') endIdx--
  if (endIdx < 0) return null
  // 末尾必须以 > 开头
  if (!lines[endIdx].trimStart().startsWith('>')) return null
  // 向前扫描连续的引用行（> 开头或空行）
  let startIdx = endIdx
  while (startIdx > 0) {
    const prev = lines[startIdx - 1]
    if (prev.trim() === '' || prev.trimStart().startsWith('>')) {
      startIdx--
    } else {
      break
    }
  }
  // 提取引用文本（去掉每行的 > 前缀，保留内部换行）
  const quoteLines: string[] = []
  for (let i = startIdx; i <= endIdx; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()
    if (trimmed.startsWith('>')) {
      // 去掉 ">" 和可选的一个空格
      const rest = trimmed.replace(/^>\s?/, '')
      quoteLines.push(rest)
    } else {
      // 引用块中间的空行 → 保留为空行
      quoteLines.push('')
    }
  }
  // 去掉首尾空行
  const quote = quoteLines.join('\n').trim()
  if (!quote) return null
  // remaining = body 中引用块之前的部分（去掉分隔的空行）
  const remaining = lines.slice(0, startIdx).join('\n').replace(/\s+$/, '')
  return { quote, remaining }
}

// ============= 主解析函数 =============

/** 解析 Markdown 语义标记内容为 blocks 数组 */
function parseInsightMarkdown(markdown: string): {
  pageTitle: string
  pageSubtitle: string
  pageTag: string
  blocks: Array<{ type: string; data: Record<string, any> }>
} {
  const parts = markdown.split(/\n(?=##\s+)/)
  let pageTitle = ''
  let pageSubtitle = ''
  let pageTag = ''
  const blocks: Array<{ type: string; data: Record<string, any> }> = []

  // 第一部分：页面标题 + 摘要
  // 解析 H1 标题后，按行类型分类 H1 与下一个 ## 之间的内容：
  //   - **标签**：xxx     → 抽 pageTag（覆盖 H1 方括号 tag，确保独立标签行也能被识别）
  //   - ---              → 丢弃（不参与任何渲染）
  //   - > xxx 连续行     → 抽成独立 quote block 插入到 blocks 开头
  //   - 其他非空行        → 纯段落，累加成 pageSubtitle（空行作为段间分隔）
  const firstPart = parts[0]
  const firstLines = firstPart.replace(/\r\n/g, '\n').split('\n')
  const titleMatch = firstLines[0]?.match(/^#\s+(?:\[([^\]]*)\]\s*)?(.+)/)
  if (titleMatch) {
    if (titleMatch[1]) pageTag = titleMatch[1].trim()
    pageTitle = titleMatch[2].trim()
  }

  const subtitleParagraphs: string[] = []
  let pendingQuoteLines: string[] = []
  const flushQuote = () => {
    if (pendingQuoteLines.length > 0) {
      blocks.push({
        type: 'quote',
        data: { text: pendingQuoteLines.join('\n').trim() },
      })
      pendingQuoteLines = []
    }
  }

  for (let i = 1; i < firstLines.length; i++) {
    const trimmed = firstLines[i].trim()
    if (!trimmed) {
      // 空行：结束当前引用块，段落边界由段落累加逻辑处理
      flushQuote()
      continue
    }
    if (trimmed.startsWith('## ')) break

    // **标签**：xxx（兼容中英文冒号）
    if (!pageTag) {
      const tagMatch = trimmed.match(/^\*\*标签\*\*[：:]\s*(.+)$/)
      if (tagMatch) {
        pageTag = tagMatch[1].trim()
        continue
      }
    }

    // --- 分隔线：丢弃，不渲染
    if (/^---+$/.test(trimmed)) {
      continue
    }

    // > 引用块：累加到 pendingQuoteLines，空行或非 > 行时统一 flush
    if (trimmed.startsWith('>')) {
      pendingQuoteLines.push(trimmed.replace(/^>\s?/, ''))
      continue
    }

    // 纯段落文本：先 flush 引用块，再累加
    flushQuote()
    subtitleParagraphs.push(trimmed)
  }
  flushQuote()
  pageSubtitle = subtitleParagraphs.join('\n')

  // 处理每个段落（最后一段单独处理，用于提取全文末尾引用作为 closing）
  const sectionParts = parts.slice(1)
  const lastIndex = sectionParts.length - 1

  sectionParts.forEach((part, partIdx) => {
    const isLast = partIdx === lastIndex
    const headerMatch = part.match(/^##\s+[^\[]*\[([^\]]+)\](?:[ \t]+(.+))?$/m)
    if (!headerMatch) {
      const plainHeaderMatch = part.match(/^##\s+(.+)/m)
      if (plainHeaderMatch) {
        const sectionTitle = plainHeaderMatch[1].trim()
        let body = part.replace(/^##\s+.*\n?/, '')
        body = dropHrLines(body)
        // 仅在最后一段尝试提取末尾引用作为 closing
        let closingContent = ''
        if (isLast) {
          const closingMatch = extractClosingQuote(body)
          if (closingMatch) {
            body = closingMatch.remaining
            closingContent = closingMatch.quote
          }
        }
        // 无 marker 时，根据标题推断 block type（复用 marker 路径的解析函数，
        // 避免与 switch case 内的逻辑重复，确保两种写法结果一致）
        const isVerificationTitle = /待验证/.test(sectionTitle)
        const isActionTitle = /下一步行动|行动/.test(sectionTitle)
        const isAssumptionTitle = /脆弱假设|假设链|假设论证/.test(sectionTitle)
        if (isVerificationTitle) {
          blocks.push({
            type: 'verification_list',
            data: parseVerificationListData('待验证', sectionTitle, body),
          })
        } else if (isActionTitle) {
          blocks.push({
            type: 'action_list',
            data: parseActionListData('行动', sectionTitle, body),
          })
        } else if (isAssumptionTitle) {
          const subSections = extractSubSections(body)
          if (subSections.length > 0) {
            blocks.push({
              type: 'assumption_chain',
              data: parseAssumptionChainData('脆弱假设', sectionTitle, body),
            })
          } else {
            const listItems = extractListItems(body)
            if (listItems.length > 0) {
              blocks.push({
                type: 'risk_list',
                data: parseRiskListData('脆弱假设', sectionTitle, body),
              })
            } else {
              blocks.push({
                type: 'section',
                data: { eyebrow: '脆弱假设', title: sectionTitle, content: body.trim() },
              })
            }
          }
        } else {
          blocks.push({
            type: 'section',
            data: { title: sectionTitle, content: body.trim() },
          })
        }
        if (closingContent) {
          blocks.push({ type: 'closing', data: { content: closingContent } })
        }
      }
      return
    }

    const marker = headerMatch[1]
    const sectionTitle = (headerMatch[2] || '').trim()
    let body = part.replace(/^##\s+[^\[]*\[[^\]]+\].*\n?/, '')
    body = dropHrLines(body)
    // 仅在最后一段尝试提取末尾引用作为 closing
    let closingContent = ''
    if (isLast) {
      const closingMatch = extractClosingQuote(body)
      if (closingMatch) {
        body = closingMatch.remaining
        closingContent = closingMatch.quote
      }
    }
    const blockType = MARKER_TO_BLOCK_TYPE[marker]
    if (!blockType) {
      // 未识别的 marker 也作为通用 section 处理，避免内容丢失
      blocks.push({
        type: 'section',
        data: { title: `${marker}：${sectionTitle}`, content: body.trim() },
      })
      return
    }

    switch (blockType) {
      case 'hero_judgment': {
        // 原先 switch 里缺失此 case，导致 ## [核心判断] ... 整块被静默丢弃。
        // 现补齐：eyebrow=marker, headline=sectionTitle, content=body, tags=可选标签行
        const tagLines = body.split('\n').map(l => l.trim()).filter(l => /^#\S/.test(l) || /^@\S/.test(l))
        blocks.push({
          type: 'hero_judgment',
          data: {
            label: marker,
            headline: sectionTitle,
            content: body.trim(),
            tags: tagLines.map(l => l.replace(/^[#@]/, '').trim()),
          },
        })
        break
      }

      case 'decision_banner': {
        blocks.push({
          type: 'decision_banner',
          data: {
            eyebrow: marker,
            headline: sectionTitle,
            content: body.trim(),
          },
        })
        break
      }

      case 'section': {
        // 历史提醒 / 提醒：若正文含列表，则把列表项渲染成"血泪史"警示卡片网格
        // （复用 risk_list 结构：列表前散文→intro，列表→卡片，列表后散文→outro），
        // 并打上 tone: 'history' 让渲染层套用棕红配色（区别于风险的正红）。
        const isReminder = marker === '历史提醒' || marker === '提醒'
        if (isReminder && extractListItems(body).length > 0) {
          blocks.push({
            type: 'risk_list',
            data: { ...parseRiskListData(marker, sectionTitle, body), tone: 'history' },
          })
        } else {
          blocks.push({
            type: 'section',
            data: {
              eyebrow: marker,
              title: sectionTitle,
              content: body.trim(),
            },
          })
        }
        break
      }

      case 'risk_list': {
        blocks.push({
          type: 'risk_list',
          data: parseRiskListData(marker, sectionTitle, body),
        })
        break
      }

      case 'action_list': {
        blocks.push({
          type: 'action_list',
          data: parseActionListData(marker, sectionTitle, body),
        })
        break
      }

      case 'flow_diagram': {
        const subSections = extractSubSections(body)
        if (subSections.length > 0) {
          // 有 ### 子标题 → 用作 flow 节点
          // 注意：intro 必须排除 sub-sections 的描述行，否则会与 nodes[i].description 重复
          const nodes = subSections.map(s => ({
            label: s.label,
            description: s.content,
          }))
          const intro = buildIntroOutsideSubSections(body, subSections)
          blocks.push({
            type: 'flow_diagram',
            data: { eyebrow: marker, title: sectionTitle, intro, nodes },
          })
        } else {
          // 无 ### 子标题：
          // - 含 - 列表 → 按"前提假设 → 论据卡片 → 结论"渲染为 risk_list 卡片网格
          //   （复用 parseRiskListData：列表前散文→intro，bullets→卡片，列表后散文→outro；
          //    保留 marker 作为 eyebrow，视觉沿用风险卡片网格）
          // - ```mermaid 围栏 / 纯散文 → 降级为 section，由 renderMarkdownText 原地渲染 mermaid 图
          //   （围栏不抽走，避免图被拆成独立 block 漂到源段落外面）
          const listItems = extractListItems(body)
          if (listItems.length > 0) {
            blocks.push({
              type: 'risk_list',
              data: parseRiskListData(marker, sectionTitle, body),
            })
          } else {
            blocks.push({
              type: 'section',
              data: { eyebrow: marker, title: sectionTitle, content: body.trim() },
            })
          }
        }
        break
      }

      case 'assumption_chain': {
        // 双重入口（按优先级）：
        //   1. ### 子标题路径（结构化、推荐）→ parseAssumptionChainData
        //   2. - **标题：** 内容 bullet 路径（最自然写法）→ parseAssumptionChainFromBullets
        //      这是用户最常用的形态：直接把每条脆弱点写成带粗体标题的列表。
        // 没有 ### 也没有有标题 bullet 时，才退化到旧行为（risk_list / section），
        // 这部分覆盖了"作者从未想用 assumption_chain，只写了普通列表"的边缘情况。
        const subSections = extractSubSections(body)
        if (subSections.length > 0) {
          blocks.push({
            type: 'assumption_chain',
            data: parseAssumptionChainData(marker, sectionTitle, body),
          })
          break
        }
        const listItems = extractListItems(body)
        const titleBullets = listItems.filter(r => /^\*\*(.+?)\*\*[：:]\s*/.test(r))
        if (titleBullets.length > 0) {
          // bullet 形式直接走 assumption_chain（每个 bullet 是 step）
          blocks.push({
            type: 'assumption_chain',
            data: parseAssumptionChainFromBullets(marker, sectionTitle, body),
          })
          break
        }
        if (listItems.length > 0) {
          // 普通 bullet（无 **title：**）→ 沿用旧 risk_list fallback，保持向后兼容
          blocks.push({
            type: 'risk_list',
            data: parseRiskListData(marker, sectionTitle, body),
          })
        } else {
          blocks.push({
            type: 'section',
            data: { eyebrow: marker, title: sectionTitle, content: body.trim() },
          })
        }
        break
      }

      case 'timeline': {
        const subSections = extractSubSections(body)
        if (subSections.length > 0) {
          // 有 ### 子标题 → 用作时间线节点
          // 注意：intro 必须排除 sub-sections 的 event 内容，否则会与 items[i].event 重复
          const items = subSections.map(s => ({
            date: s.label,
            event: s.content,
          }))
          const intro = buildIntroOutsideSubSections(body, subSections)
          blocks.push({
            type: 'timeline',
            data: { eyebrow: marker, title: sectionTitle, intro, items },
          })
        } else {
          // 无 ### 子标题时降级为 section，让 renderMarkdownText 渲染完整正文（保留 - 列表等）
          blocks.push({
            type: 'section',
            data: { eyebrow: marker, title: sectionTitle, content: body.trim() },
          })
        }
        break
      }

      case 'callout': {
        blocks.push({
          type: 'callout',
          data: {
            eyebrow: marker,
            label: marker,
            title: sectionTitle,
            content: body.trim(),
          },
        })
        break
      }

      case 'red_line': {
        blocks.push({
          type: 'red_line',
          data: {
            eyebrow: marker,
            label: marker,
            headline: sectionTitle,
            content: body.trim(),
          },
        })
        break
      }

      case 'comparison': {
        // 优先用 ### 子标题分组（如"场景一：对外"、"场景二：对内"），每组携带其下的列表项
        const subSections = extractSubSections(body)
        const hasSubSections = subSections.length > 0
        let items: Array<{ label: string; content?: string; items?: string[] }> = []

        if (hasSubSections) {
          // 从 body 中提取每个子标题下的纯文本描述 + 列表项（- 开头）
          const subBlocks: Array<{ label: string; content: string; items: string[] }> = []
          const lines = body.replace(/\r\n/g, '\n').split('\n')
          let current: { label: string; contentLines: string[]; items: string[] } | null = null
          for (const line of lines) {
            const trimmed = line.trim()
            const subHeader = trimmed.match(/^###\s+(.+)/)
            if (subHeader) {
              if (current) subBlocks.push({
                label: current.label,
                content: current.contentLines.join('\n').trim(),
                items: current.items,
              })
              current = { label: subHeader[1].trim(), contentLines: [], items: [] }
            } else if (current) {
              if (LIST_ITEM_PREFIX_RE.test(trimmed)) {
                current.items.push(trimmed.replace(LIST_ITEM_PREFIX_RE, '').trim())
              } else if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('>')) {
                // 纯文本描述行（非空、非标题、非引用）
                current.contentLines.push(trimmed)
              }
            }
          }
          if (current) subBlocks.push({
            label: current.label,
            content: current.contentLines.join('\n').trim(),
            items: current.items,
          })
          items = subBlocks.map(b => ({
            label: b.label,
            content: b.content,
            items: b.items,
          }))
          // 注意：intro 必须排除 sub-sections 的描述行，否则会与 items[i].content 重复
          const intro = buildIntroOutsideSubSections(body, subBlocks.map(b => ({ content: b.content })))
          blocks.push({
            type: 'comparison',
            data: { eyebrow: marker, title: sectionTitle, intro, items, hasSubSections: true },
          })
        } else {
          // 无 ### 子标题：按"列表项是否带标题"三向处理
          const listItems = extractListItems(body)
          const baseIntro = buildIntro(body)

          if (allBulletsAreTitled(listItems)) {
            // 所有列表项都带 **标题：** 模式 → 解析为对比条目
            items = parseTitledBullets(listItems).map(b => ({ label: b.title, content: b.content }))
            blocks.push({
              type: 'comparison',
              data: { eyebrow: marker, title: sectionTitle, intro: baseIntro, items, hasSubSections: false },
            })
          } else if (listItems.length > 0) {
            // 无标题的列表项（段落+列表+段落混合）→ 保留整段 body
            // 降级为 section，让 renderMarkdownText 渲染完整结构
            blocks.push({
              type: 'section',
              data: { eyebrow: marker, title: sectionTitle, content: body.trim() },
            })
          } else {
            // 没有列表项：保留整段内容作为 section 段落（不要硬塞空 items 数组）
            blocks.push({
              type: 'section',
              data: { eyebrow: marker, title: sectionTitle, content: body.trim() },
            })
          }
        }
        break
      }

      case 'verification_list': {
        blocks.push({
          type: 'verification_list',
          data: parseVerificationListData(marker, sectionTitle, body),
        })
        break
      }
    }
    // 识别 marker 类型后，若最后一段提取出了 closing 引用，追加到末尾
    if (closingContent) {
      blocks.push({ type: 'closing', data: { content: closingContent } })
    }
  })

  // mermaid 围栏**不再抽走**：留在源字符串字段里（content / intro / steps[].description ...），
  // 由 renderMarkdownText 在原地解析为 MermaidDiagram inline 渲染，避免被拆成独立 block 漂出。
  return { pageTitle, pageSubtitle, pageTag, blocks }
}

export {
  MARKER_TO_BLOCK_TYPE,
  BLOCK_TYPE_EYEBROW,
  extractParagraphs,
  extractListItems,
  extractSubSections,
  extractClosingQuote,
  parseInsightMarkdown,
}