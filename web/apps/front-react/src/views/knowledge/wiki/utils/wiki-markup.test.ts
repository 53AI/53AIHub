import { describe, expect, it } from "vitest";

import {
  buildFileIdToSourceMetaResolver,
  markdownLinkToWiki,
  transformWikiInlineMarkup,
  wikiToMarkdownLink,
} from "./wiki-markup";

const hrefBuilder = (slug: string) =>
  `?space_id=test&selected=${encodeURIComponent(slug)}&vd-type=dynamicKnowledge`;

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "";

type SourceTuple = [source_file_id: string, library_id: string, file_name?: string];

const makeResolver = (entries: SourceTuple[]) => {
  const sources = entries.map(([source_file_id, library_id, file_name]) => ({
    source_file_id,
    library_id,
    file_name,
  }));
  return buildFileIdToSourceMetaResolver(sources);
};

describe("transformWikiInlineMarkup — source-reference 转 markdown 链接", () => {
  it("[source: file:NUMBER#chunk] 命中映射且有 file_name 时,显示文本用 file_name", () => {
    const resolver = makeResolver([["123", "lib-A", "品茗年报.pdf"]]);
    const out = transformWikiInlineMarkup("[source: file:123#c000]", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/123?vd-type=knowledge&chunk=c000)`,
    );
  });

  it("[source: file:ALPHANUM#chunk] 字母数字 fileId 也能被识别", () => {
    const resolver = makeResolver([["k6CgKT", "lib-A", "品茗年报.pdf"]]);
    const out = transformWikiInlineMarkup("[source: file:k6CgKT#c000]", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/k6CgKT?vd-type=knowledge&chunk=c000)`,
    );
  });

  it("fileId 命中但没有 file_name 时,降级显示 fileId#chunkId", () => {
    const resolver = makeResolver([["123", "lib-A"]]);
    const out = transformWikiInlineMarkup("[source: file:123#c000]", hrefBuilder, resolver);
    expect(out).toBe(`[123#c000](${ORIGIN}/library/lib-A/file/123?vd-type=knowledge&chunk=c000)`);
  });

  it("fileId 未在 sources 中时,降级保留原始语法(不丢前缀)", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup("[source: file:unknown#c000]", hrefBuilder, resolver);
    expect(out).toBe("[source: file:unknown#c000]");
  });

  it("fileId 未命中时,[file:xxx#c000] 形式保留原语法", () => {
    const resolver = makeResolver([["k6CgKT", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup("[file:unknown#c000]", hrefBuilder, resolver);
    expect(out).toBe("[file:unknown#c000]");
  });

  it("fileId 未命中时,裸引用也保留原语法(含前缀)", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup(
      "前缀 file:unknown#c000 后缀",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe("前缀 file:unknown#c000 后缀");
  });

  it("不带 source: 前缀的 [file:xxx#c000] 同样转 markdown 链接", () => {
    const resolver = makeResolver([["k6CgKT", "lib-A", "品茗年报.pdf"]]);
    const out = transformWikiInlineMarkup("[file:k6CgKT#c000]", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/k6CgKT?vd-type=knowledge&chunk=c000)`,
    );
  });

  it("裸引用 file:xxx#c000 也能匹配并转换", () => {
    const resolver = makeResolver([["k6CgKT", "lib-A", "品茗年报.pdf"]]);
    const out = transformWikiInlineMarkup(
      "前缀 file:k6CgKT#c000 后缀",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe(
      `前缀 [品茗年报.pdf](${ORIGIN}/library/lib-A/file/k6CgKT?vd-type=knowledge&chunk=c000) 后缀`,
    );
  });

  it("<cite>file:xxx#c000</cite> 也能匹配并转换", () => {
    const resolver = makeResolver([["k6CgKT", "lib-A", "品茗年报.pdf"]]);
    const out = transformWikiInlineMarkup("<cite>file:k6CgKT#c000</cite>", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/k6CgKT?vd-type=knowledge&chunk=c000)`,
    );
  });

  it("code block 内的 source 引用不应被转换", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup(
      "```\n[source: file:123#c000]\n```",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe("```\n[source: file:123#c000]\n```");
  });

  it("inline code 内的 source 引用不应被转换", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup(
      "use `[source: file:123#c000]` literal",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe("use `[source: file:123#c000]` literal");
  });

  it("混合场景:有映射的转链接,没映射的保留原语法", () => {
    const resolver = makeResolver([
      ["123", "lib-B", "文档B.pdf"],
      ["k6CgKT", "lib-A", "文档A.pdf"],
    ]);
    const out = transformWikiInlineMarkup(
      "有 [source: file:123#c000] 和 [source: file:k6CgKT#c000] 还有 [source: file:unknown#c000]",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe(
      `有 [文档B.pdf](${ORIGIN}/library/lib-B/file/123?vd-type=knowledge&chunk=c000) 和 [文档A.pdf](${ORIGIN}/library/lib-A/file/k6CgKT?vd-type=knowledge&chunk=c000) 还有 [source: file:unknown#c000]`,
    );
  });

  it("resolver 为 undefined 时(向后兼容),所有 source 引用保留原语法", () => {
    const out = transformWikiInlineMarkup("[source: file:k6CgKT#c000]", hrefBuilder);
    expect(out).toBe("[source: file:k6CgKT#c000]");
  });

  it("wiki 内链 [[slug|label]] 转为 markdown 链接 [label](href) 由解析器渲染", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup("[[my-page|我的页面]]", hrefBuilder, resolver);
    expect(out).toBe(
      "[我的页面](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)",
    );
  });

  it("wiki 内链 [[slug]] 简写形式也转为 markdown 链接", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup("[[my-page]]", hrefBuilder, resolver);
    expect(out).toBe(
      "[my-page](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)",
    );
  });

  it("label 中含 [ 时做最小转义,避免破坏 markdown 语法", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    // wiki 内链 label 不允许含 ](语法边界),所以这里只测 [ 的转义
    const out = transformWikiInlineMarkup("[[my-page|[特殊页面]]", hrefBuilder, resolver);
    expect(out).toBe(
      "[\\[特殊页面](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)",
    );
  });

  it("label 中含 `]` 使用 `\\]` 转义能被匹配,并在 markdown 中正确渲染为字面 `]`", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup(
      "[[my-page|含 \\] 转义]]",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe(
      "[含 \\] 转义](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)",
    );
  });

  it("label 中 `[` 和 `]` 同时使用转义(财会[2018]15 号 风格)能被匹配", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    // 这是 issue 中提到的实际格式:`[2018]` 需要转义才能作为 label 文本
    const out = transformWikiInlineMarkup(
      "[[my-page|财会\\[2018\\]15 号]]",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe(
      "[财会\\[2018\\]15 号](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)",
    );
  });

  it("未转义的 label 含 `]` 也能匹配(原 issue 报告的格式)", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    // 这是 issue 中未转义的原始形式;`]` 后不接 `]` 时不算闭合
    const out = transformWikiInlineMarkup(
      "[[my-page|财会[2018]15 号]]",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe(
      "[财会\\[2018\\]15 号](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)",
    );
  });

  it("issue 原文原样输入(完整 slug)也能匹配", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup(
      "[[concept/accounting-policy-change-caikuai-2018-15| 会计政策变更（财会[2018]15 号）]]",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe(
      "[会计政策变更（财会\\[2018\\]15 号）](?space_id=test&selected=concept%2Faccounting-policy-change-caikuai-2018-15&vd-type=dynamicKnowledge)",
    );
  });

  it("label 中孤立的反斜杠(非紧跟 `[` 或 `]`)按字面保留", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup(
      "[[my-page|路径 C:\\\\data]]",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe(
      "[路径 C:\\\\data](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)",
    );
  });

  // ============ 无 chunk 形态 ============

  it("[source: file:XXX] 无 chunk 也能命中并转换,URL 不带 chunk 参数", () => {
    const resolver = makeResolver([["Ov5KJL", "lib-A", "品茗年报.pdf"]]);
    const out = transformWikiInlineMarkup("[source: file:Ov5KJL]", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/Ov5KJL?vd-type=knowledge)`,
    );
  });

  it("[source: file:XXX] 无 chunk 且无 file_name 时,降级显示 fileId", () => {
    const resolver = makeResolver([["Ov5KJL", "lib-A"]]);
    const out = transformWikiInlineMarkup("[source: file:Ov5KJL]", hrefBuilder, resolver);
    expect(out).toBe(`[Ov5KJL](${ORIGIN}/library/lib-A/file/Ov5KJL?vd-type=knowledge)`);
  });

  it("[source: file:XXX] 无 chunk 未命中 sources 时保留原语法(不丢前缀)", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = transformWikiInlineMarkup("[source: file:Ov5KJL]", hrefBuilder, resolver);
    expect(out).toBe("[source: file:Ov5KJL]");
  });

  it("[file:XXX] 无 chunk 也能命中并转换,URL 不带 chunk 参数", () => {
    const resolver = makeResolver([["Ov5KJL", "lib-A", "品茗年报.pdf"]]);
    const out = transformWikiInlineMarkup("[file:Ov5KJL]", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/Ov5KJL?vd-type=knowledge)`,
    );
  });

  it("<cite>file:XXX</cite> 无 chunk 也能命中并转换", () => {
    const resolver = makeResolver([["Ov5KJL", "lib-A", "品茗年报.pdf"]]);
    const out = transformWikiInlineMarkup("<cite>file:Ov5KJL</cite>", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/Ov5KJL?vd-type=knowledge)`,
    );
  });

  it("裸引用 file:XXX 无 chunk 也能匹配并转换", () => {
    const resolver = makeResolver([["Ov5KJL", "lib-A", "品茗年报.pdf"]]);
    const out = transformWikiInlineMarkup(
      "前缀 file:Ov5KJL 后缀",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe(
      `前缀 [品茗年报.pdf](${ORIGIN}/library/lib-A/file/Ov5KJL?vd-type=knowledge) 后缀`,
    );
  });

  it("混合场景:有/无 chunk 两种形态同时正确处理", () => {
    const resolver = makeResolver([
      ["Ov5KJL", "lib-A", "文档A.pdf"],
      ["QVoRA4", "lib-B", "文档B.pdf"],
    ]);
    const out = transformWikiInlineMarkup(
      "[source: file:Ov5KJL] 和 [source: file:QVoRA4#c000]",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe(
      `[文档A.pdf](${ORIGIN}/library/lib-A/file/Ov5KJL?vd-type=knowledge) 和 [文档B.pdf](${ORIGIN}/library/lib-B/file/QVoRA4?vd-type=knowledge&chunk=c000)`,
    );
  });
});

describe("buildFileIdToSourceMetaResolver", () => {
  it("从 sources 数组建立 fileId→{libraryId, fileName} 映射", () => {
    const resolver = buildFileIdToSourceMetaResolver([
      { source_file_id: "123", library_id: "lib-A", file_name: "A.pdf" },
      { source_file_id: "k6CgKT", library_id: "lib-B", file_name: "B.pdf" },
    ]);
    expect(resolver("123")).toEqual({ libraryId: "lib-A", fileName: "A.pdf" });
    expect(resolver("k6CgKT")).toEqual({ libraryId: "lib-B", fileName: "B.pdf" });
  });

  it("sources 为 undefined / 空数组时,resolver 始终返回 undefined", () => {
    expect(buildFileIdToSourceMetaResolver(undefined)("123")).toBeUndefined();
    expect(buildFileIdToSourceMetaResolver([])("123")).toBeUndefined();
  });

  it("缺少 source_file_id 的项被跳过", () => {
    const resolver = buildFileIdToSourceMetaResolver([
      { source_file_id: "123", library_id: "lib-A", file_name: "A.pdf" },
      { library_id: "no-file", file_name: "X.pdf" },
    ]);
    expect(resolver("123")).toEqual({ libraryId: "lib-A", fileName: "A.pdf" });
    expect(resolver("no-file")).toBeUndefined();
  });

  it("没有 library_id 时仍能查到 fileName(但渲染时无法转链接)", () => {
    const resolver = buildFileIdToSourceMetaResolver([
      { source_file_id: "only-name", file_name: "X.pdf" },
    ]);
    expect(resolver("only-name")).toEqual({ fileName: "X.pdf" });
  });

  it("file_name 为空字符串时不写入 fileName", () => {
    const resolver = buildFileIdToSourceMetaResolver([
      { source_file_id: "empty", library_id: "lib", file_name: "" },
    ]);
    expect(resolver("empty")).toEqual({ libraryId: "lib" });
  });

  it("重复 fileId 时,以后出现的那条为准", () => {
    const resolver = buildFileIdToSourceMetaResolver([
      { source_file_id: "123", library_id: "lib-A", file_name: "A.pdf" },
      { source_file_id: "123", library_id: "lib-B", file_name: "B.pdf" },
    ]);
    expect(resolver("123")).toEqual({ libraryId: "lib-B", fileName: "B.pdf" });
  });
});

describe("markdownLinkToWiki — 保存时反解", () => {
  it("vd-type=knowledge 的 URL 反解为 [source: file:FILEID#chunk]", () => {
    const out = markdownLinkToWiki(
      "[品茗年报.pdf](/library/lib-X/file/28124?vd-type=knowledge&chunk=c000)",
    );
    expect(out).toBe("[source: file:28124#c000]");
  });

  it("URL 中无 chunk 时,反解为不带 chunk 的形式", () => {
    const out = markdownLinkToWiki(
      "[品茗年报.pdf](/library/lib-X/file/28124?vd-type=knowledge)",
    );
    expect(out).toBe("[source: file:28124]");
  });

  it("chunk 参数顺序在 vd-type 之后仍可识别", () => {
    const out = markdownLinkToWiki(
      "[k6CgKT.pdf](/library/lib-A/file/k6CgKT?vd-type=knowledge&chunk=c002)",
    );
    expect(out).toBe("[source: file:k6CgKT#c002]");
  });

  it("vd-type=knowledge 后跟其他 query 参数时仍可识别", () => {
    const out = markdownLinkToWiki(
      "[品茗年报.pdf](/library/lib-A/file/k6CgKT?chunk=c002&vd-type=knowledge)",
    );
    expect(out).toBe("[source: file:k6CgKT#c002]");
  });

  it("混合:vd-type=knowledge 反解为 source,selected=slug 反解为 wiki 内链,其他原样", () => {
    const input =
      "[品茗年报.pdf](/library/L1/file/28124?vd-type=knowledge&chunk=c000) " +
      "[看这里](?space_id=test&selected=a-page&vd-type=dynamicKnowledge) " +
      "[普通链接](https://example.com)";
    const out = markdownLinkToWiki(input);
    expect(out).toBe(
      "[source: file:28124#c000] " +
        "[[a-page|看这里]] " +
        "[普通链接](https://example.com)",
    );
  });

  it("wiki 内链 (selected=slug) 不受 vd-type 反解影响", () => {
    const out = markdownLinkToWiki("[我的页面](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)");
    expect(out).toBe("[[my-page|我的页面]]");
  });

  it("来源 URL 无法解析 fileId 时保持原样", () => {
    const out = markdownLinkToWiki("[name](?vd-type=knowledge&chunk=c000)");
    expect(out).toBe("[name](?vd-type=knowledge&chunk=c000)");
  });

  it("markdown label 中 `\\[` / `\\]` 转义能反解回字面 `[` / `]`,并写回时重新转义", () => {
    const out = markdownLinkToWiki(
      "[财会\\[2018\\]15 号](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)",
    );
    expect(out).toBe("[[my-page|财会\\[2018\\]15 号]]");
  });

  it("markdown label 中仅 `]` 转义也能正确反解", () => {
    const out = markdownLinkToWiki(
      "[含 \\] 转义](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)",
    );
    expect(out).toBe("[[my-page|含 \\] 转义]]");
  });

  it("round-trip:转义 wiki 内链 → markdown → wiki 完整还原", () => {
    const original = "[[my-page|财会\\[2018\\]15 号]]";
    const md = transformWikiInlineMarkup(original, hrefBuilder);
    const back = markdownLinkToWiki(md);
    expect(back).toBe(original);
  });

  it("round-trip:未转义 wiki 内链经一次保存后被规范化成转义形式(语义等价)", () => {
    const original = "[[my-page|财会[2018]15 号]]";
    const md = transformWikiInlineMarkup(original, hrefBuilder);
    const back = markdownLinkToWiki(md);
    expect(back).toBe("[[my-page|财会\\[2018\\]15 号]]");
    // 规范化后的形式再 round-trip 应当稳定
    expect(markdownLinkToWiki(transformWikiInlineMarkup(back, hrefBuilder))).toBe(back);
  });
});

describe("wikiToMarkdownLink — 编辑入口转换(同时处理 source 引用与 wiki 内链)", () => {
  it("[source: file:xxx#c000] 命中 sources 时,显示文本用 file_name", () => {
    const resolver = makeResolver([["123", "lib-A", "品茗年报.pdf"]]);
    const out = wikiToMarkdownLink("[source: file:123#c000]", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/123?vd-type=knowledge&chunk=c000)`,
    );
  });

  it("[source: file:ALPHANUM#c000] 字母数字 fileId 也能命中", () => {
    const resolver = makeResolver([["k6CgKT", "lib-A", "品茗年报.pdf"]]);
    const out = wikiToMarkdownLink("[source: file:k6CgKT#c000]", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/k6CgKT?vd-type=knowledge&chunk=c000)`,
    );
  });

  it("命中但无 file_name 时降级显示 fileId#chunkId", () => {
    const resolver = makeResolver([["123", "lib-A"]]);
    const out = wikiToMarkdownLink("[source: file:123#c000]", hrefBuilder, resolver);
    expect(out).toBe(`[123#c000](${ORIGIN}/library/lib-A/file/123?vd-type=knowledge&chunk=c000)`);
  });

  it("[source: file:xxx#c000] 未命中 sources 时,保留原语法(不丢前缀)", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = wikiToMarkdownLink("[source: file:unknown#c000]", hrefBuilder, resolver);
    expect(out).toBe("[source: file:unknown#c000]");
  });

  it("未传 resolver 时(向后兼容),所有 source 引用保留原语法", () => {
    const out = wikiToMarkdownLink("[source: file:123#c000]", hrefBuilder);
    expect(out).toBe("[source: file:123#c000]");
  });

  it("wiki 内链 [[slug|label]] 转为 [label](href)", () => {
    const out = wikiToMarkdownLink("[[my-page|我的页面]]", hrefBuilder);
    expect(out).toBe("[我的页面](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)");
  });

  it("wiki 内链 [[slug]] 简写形式转为 [slug](href)", () => {
    const out = wikiToMarkdownLink("[[my-page]]", hrefBuilder);
    expect(out).toBe("[my-page](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)");
  });

  it("引用 [c123] 保持原样不被转换", () => {
    const out = wikiToMarkdownLink("[c123]", hrefBuilder);
    expect(out).toBe("[c123]");
  });

  it("混合场景:source 链接 + wiki 内链 + 引用 同时正确处理", () => {
    const resolver = makeResolver([["123", "lib-A", "品茗年报.pdf"]]);
    const input = "[source: file:123#c000] [[my-page|看这里]] [c123]";
    const out = wikiToMarkdownLink(input, hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/123?vd-type=knowledge&chunk=c000) [看这里](?space_id=test&selected=my-page&vd-type=dynamicKnowledge) [c123]`,
    );
  });

  it("code block 内 source 引用保留原语法", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = wikiToMarkdownLink(
      "```\n[source: file:123#c000]\n```",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe("```\n[source: file:123#c000]\n```");
  });

  it("inline code 内 source 引用保留原语法", () => {
    const resolver = makeResolver([["123", "lib-A", "name"]]);
    const out = wikiToMarkdownLink(
      "use `[source: file:123#c000]` literal",
      hrefBuilder,
      resolver,
    );
    expect(out).toBe("use `[source: file:123#c000]` literal");
  });

  it("保存反解 roundtrip:有 file_name 时也能完整还原 source 语法", () => {
    const resolver = makeResolver([["123", "lib-A", "品茗年报.pdf"]]);
    const original = "[source: file:123#c000]";
    const toMarkdown = wikiToMarkdownLink(original, hrefBuilder, resolver);
    const back = markdownLinkToWiki(toMarkdown);
    expect(back).toBe(original);
  });

  it("保存反解 roundtrip:字母数字 fileId 也能完整还原", () => {
    const resolver = makeResolver([["k6CgKT", "lib-A", "品茗年报.pdf"]]);
    const original = "[source: file:k6CgKT#c002]";
    const toMarkdown = wikiToMarkdownLink(original, hrefBuilder, resolver);
    const back = markdownLinkToWiki(toMarkdown);
    expect(back).toBe(original);
  });

  it("保存反解 roundtrip:无 file_name 时也能完整还原", () => {
    const resolver = makeResolver([["123", "lib-A"]]);
    const original = "[source: file:123#c000]";
    const toMarkdown = wikiToMarkdownLink(original, hrefBuilder, resolver);
    const back = markdownLinkToWiki(toMarkdown);
    expect(back).toBe(original);
  });

  it("[source: file:XXX] 无 chunk 形态命中 sources 时,显示文本用 file_name 且 URL 不带 chunk", () => {
    const resolver = makeResolver([["Ov5KJL", "lib-A", "品茗年报.pdf"]]);
    const out = wikiToMarkdownLink("[source: file:Ov5KJL]", hrefBuilder, resolver);
    expect(out).toBe(
      `[品茗年报.pdf](${ORIGIN}/library/lib-A/file/Ov5KJL?vd-type=knowledge)`,
    );
  });

  it("保存反解 roundtrip:无 chunk 形态也能完整还原", () => {
    const resolver = makeResolver([["Ov5KJL", "lib-A", "品茗年报.pdf"]]);
    const original = "[source: file:Ov5KJL]";
    const toMarkdown = wikiToMarkdownLink(original, hrefBuilder, resolver);
    const back = markdownLinkToWiki(toMarkdown);
    expect(back).toBe(original);
  });

  it("保存反解 roundtrip:无 chunk 且无 file_name 时也能完整还原", () => {
    const resolver = makeResolver([["Ov5KJL", "lib-A"]]);
    const original = "[source: file:Ov5KJL]";
    const toMarkdown = wikiToMarkdownLink(original, hrefBuilder, resolver);
    const back = markdownLinkToWiki(toMarkdown);
    expect(back).toBe(original);
  });

  it("编辑入口:label 含转义 `\\[` / `\\]` 的 wiki 内链能正确转 markdown", () => {
    const out = wikiToMarkdownLink("[[my-page|财会\\[2018\\]15 号]]", hrefBuilder);
    expect(out).toBe("[财会\\[2018\\]15 号](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)");
  });

  it("编辑入口:label 含未转义 `]`(issue 报告格式)也能转 markdown", () => {
    const out = wikiToMarkdownLink("[[my-page|财会[2018]15 号]]", hrefBuilder);
    expect(out).toBe("[财会\\[2018\\]15 号](?space_id=test&selected=my-page&vd-type=dynamicKnowledge)");
  });

  it("编辑入口 round-trip:转义 wiki 内链 → markdown → wiki 完整还原", () => {
    const original = "[[my-page|财会\\[2018\\]15 号]]";
    const toMarkdown = wikiToMarkdownLink(original, hrefBuilder);
    const back = markdownLinkToWiki(toMarkdown);
    expect(back).toBe(original);
  });
});