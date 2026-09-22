const tolerantSourceRegex =
  /\[\s*(?:source|引用|ref)\s*[:：]+\s*(\d+)\s*[-–—~]\s*(\d+)\s*\]/gi;
const legacySourceRegex = /\[Source[:_]([A-Za-z0-9]+)[_-]([A-Za-z0-9-]+)\]/gi;
// 合法格式转换后，剩余 source/ref/引用 标签均无法安全定位引用，直接隐藏。
const invalidSourceRegex =
  /\[\s*(?:source|引用|ref)\s*[:：]+[^\]\r\n]*\]/gi;
// 兼容模型偶发的裸引用拼写错误，如 [sourcc001]，但不误伤普通文本。
const malformedBareSourceRegex =
  /\[\s*sourc(?:e|c)\s*[-_:：]?\s*(?:c\d+|\d+)\s*\]/gi;
// Wiki 内链只有在 Wiki 适配器拥有 space/slug 上下文时才能转换；问答中无上下文则隐藏。
const unresolvedWikiLinkRegex = /\[\[[^\]\r\n]*\]\]/g;

const buildSourceRegex = (sourceRegex?: RegExp | string) => {
  if (!sourceRegex) return tolerantSourceRegex;
  if (sourceRegex instanceof RegExp) {
    const flags = sourceRegex.flags.includes("g")
      ? sourceRegex.flags
      : `${sourceRegex.flags}g`;
    return new RegExp(sourceRegex.source, flags);
  }
  return new RegExp(sourceRegex, "g");
};

const normalizeAllowedSourceId = (value: string) =>
  String(value ?? "")
    .trim()
    .replace(/^\[\s*source\s*:/i, "")
    .replace(/^source\s*:/i, "")
    .replace(/\]$/, "")
    .replace(/\\_/g, "_")
    .replace(/_/g, "-")
    .toLowerCase();

export const renderSourceMarkup = (
  text: string,
  renderSource?: (sourceType: string, sourceNumber: string) => string,
  sourceRegex?: RegExp | string,
  allowedSourceIds?: readonly string[],
) => {
  const regex = buildSourceRegex(sourceRegex);
  const allowed = allowedSourceIds
    ? new Set(allowedSourceIds.map(normalizeAllowedSourceId))
    : undefined;

  const replaceWithMarkup = (input: string, matcher: RegExp) => {
    return input.replace(matcher, (...args) => {
      const matchGroups = args.slice(1, -2);
      const sourceType = String(matchGroups[0] ?? "").trim();
      const sourceNumberRaw = String(matchGroups[1] ?? "").trim();
      const sourceId = normalizeAllowedSourceId(`${sourceType}-${sourceNumberRaw}`);
      if (allowed && !allowed.has(sourceId)) return "";
      const display = renderSource
        ? renderSource(sourceType, sourceNumberRaw)
        : sourceType;
      const content = display == null ? sourceType : String(display);

      return content ? `<span class="source-reference" data-source-type="${sourceType}" data-source-number="${sourceNumberRaw}">${content}</span>` : "";
    });
  };

  // 先用 tolerantSourceRegex（或传入的 sourceRegex）替换
  let result = replaceWithMarkup(text, regex);
  // 再用 legacySourceRegex 替换（处理未被第一种正则匹配的格式，如 [Source:G-1]）
  result = replaceWithMarkup(result, legacySourceRegex);
  // LLM 偶尔会输出无法定位来源的裸 chunk 标识；静默移除，避免把内部标签展示给用户。
  return result
    .replace(invalidSourceRegex, "")
    .replace(malformedBareSourceRegex, "")
    .replace(unresolvedWikiLinkRegex, "");
};

export const applySourceReferences = (
  content: string,
  renderSource?: (sourceType: string, sourceNumber: string) => string,
  sourceRegex?: RegExp | string,
  allowedSourceIds?: readonly string[],
) => {
  const fenceRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const chunks: string[] = [];

  while ((match = fenceRegex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    chunks.push(renderSourceMarkup(before, renderSource, sourceRegex, allowedSourceIds));
    chunks.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    chunks.push(
      renderSourceMarkup(content.slice(lastIndex), renderSource, sourceRegex, allowedSourceIds),
    );
  }

  return chunks.join("");
};
