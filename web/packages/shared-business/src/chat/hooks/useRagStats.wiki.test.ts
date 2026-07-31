import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRagStats } from "./useRagStats";

const wikiSource = (wikiPageId: string, sourceKey?: string) => ({
  chunk_id: `wiki-${wikiPageId}`,
  chunk_type: "wiki",
  wiki_page_id: wikiPageId,
  url: `/api/wiki/pages/${wikiPageId}`,
  library_id: "lib-1",
  library_name: "Wiki Lib",
  library_icon: "/icons/wiki.png",
  source_key: sourceKey ?? `wiki-${wikiPageId}`,
  space_id: "space-1",
  space_name: "Space",
});

const knowledgeSearchRecord = (sources: any[]) => ({
  step_code: "knowledge_search",
  status: "completed",
  data: JSON.stringify({ sources }),
});

describe("useRagStats - wiki fallback", () => {
  it("应把 processRecords 里的 wiki 合并进 files_search", () => {
    const { result } = renderHook(() => useRagStats());
    const wiki = wikiSource("page-1");
    const ragStats = {} as any;
    const processRecords = [knowledgeSearchRecord([wiki])];

    const formatted = result.current.formatRagStats(ragStats, processRecords);

    expect(formatted).not.toBeNull();
    expect(formatted!.files_search.length).toBe(1);
    expect(formatted!.files_search[0].chunk_type).toBe("wiki");
    expect(formatted!.files_search[0].wiki_page_id).toBe("page-1");
    expect(formatted!.files_search[0].file_id).toBe("page-1");
    expect(formatted!.files_search[0].file_name).toBe("Wiki Lib");
  });

  it("应把 wiki_page_id 填进 file_quotations，使 Quotation 渲染", () => {
    const { result } = renderHook(() => useRagStats());
    const ragStats = {} as any;
    const processRecords = [
      knowledgeSearchRecord([wikiSource("page-A"), wikiSource("page-B")]),
    ];

    const formatted = result.current.formatRagStats(ragStats, processRecords);

    expect(formatted!.file_quotations.length).toBe(2);
    expect(formatted!.file_quotations.map((q: any) => q.file_id)).toEqual([
      "page-A",
      "page-B",
    ]);
    expect(formatted!.file_quotations.every((q: any) => q.chunk_type === "wiki")).toBe(true);
  });

  it("应按 wiki_page_id 去重，document_search 已有的不重复", () => {
    const { result } = renderHook(() => useRagStats());
    const wikiInChunks = wikiSource("page-1");
    const ragStats = {
      document_search: { chunks: [wikiInChunks] },
    } as any;
    const processRecords = [
      knowledgeSearchRecord([wikiSource("page-1"), wikiSource("page-2")]),
    ];

    const formatted = result.current.formatRagStats(ragStats, processRecords);

    // page-1 已经在 chunks 里，page-2 来自 processRecords
    expect(formatted!.files_search.length).toBe(2);
    expect(formatted!.files_search.map((f: any) => f.wiki_page_id).sort()).toEqual([
      "page-1",
      "page-2",
    ]);
    // file_quotations 已经有了（即使后端不写），不重复填充
  });

  it("file_quotations 后端已有时不覆盖", () => {
    const { result } = renderHook(() => useRagStats());
    const ragStats = {
      file_quotations: ["file-A", "file-B"],
    } as any;
    const processRecords = [knowledgeSearchRecord([wikiSource("page-1")])];

    const formatted = result.current.formatRagStats(ragStats, processRecords);

    // 后端给的 file_quotations 保留，不会被 wiki 覆盖
    expect(formatted!.file_quotations.length).toBe(0);
  });

  it("knowledgeSearchRecord 不存在时不抛错，wiki 也不出现", () => {
    const { result } = renderHook(() => useRagStats());
    const ragStats = {} as any;
    const formatted = result.current.formatRagStats(ragStats, []);

    expect(formatted).not.toBeNull();
    expect(formatted!.files_search.length).toBe(0);
    expect(formatted!.file_quotations.length).toBe(0);
  });
});
