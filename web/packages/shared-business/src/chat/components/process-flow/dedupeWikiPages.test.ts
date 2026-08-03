import { describe, expect, it } from "vitest";
import { dedupeWikiPages } from "./utils";

describe("dedupeWikiPages", () => {
  it("returns empty array for empty input", () => {
    expect(dedupeWikiPages([])).toEqual([]);
  });

  it("ignores sources without chunk_type === 'wiki'", () => {
    const sources = [
      { chunk_type: "knowledge", wiki_page_id: "A" },
      { chunk_type: "web_page", wiki_page_id: "B" },
      { chunk_type: "graph_result", wiki_page_id: "C" },
    ];
    expect(dedupeWikiPages(sources)).toEqual([]);
  });

  it("ignores wiki sources without wiki_page_id", () => {
    const sources = [
      { chunk_type: "wiki", library_name: "无 id" },
      { chunk_type: "wiki", wiki_page_id: "", library_name: "空 id" },
    ];
    expect(dedupeWikiPages(sources)).toEqual([]);
  });

  it("keeps wiki sources with wiki_page_id", () => {
    const sources = [
      { chunk_type: "wiki", wiki_page_id: "A", library_name: "李白" },
      { chunk_type: "wiki", wiki_page_id: "B", library_name: "杜甫" },
    ];
    const result = dedupeWikiPages(sources);
    expect(result).toHaveLength(2);
    expect(result[0].wiki_page_id).toBe("A");
    expect(result[1].wiki_page_id).toBe("B");
  });

  it("dedupes by wiki_page_id, keeping first occurrence", () => {
    const sources = [
      { chunk_type: "wiki", wiki_page_id: "A", library_name: "李白-1" },
      { chunk_type: "wiki", wiki_page_id: "B", library_name: "杜甫-1" },
      { chunk_type: "wiki", wiki_page_id: "A", library_name: "李白-2" },
      { chunk_type: "wiki", wiki_page_id: "A", library_name: "李白-3" },
    ];
    const result = dedupeWikiPages(sources);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ wiki_page_id: "A", library_name: "李白-1" });
    expect(result[1]).toMatchObject({ wiki_page_id: "B", library_name: "杜甫-1" });
  });

  it("returns first-occurrence order regardless of input chunk order", () => {
    const sources = [
      { chunk_type: "knowledge", wiki_page_id: "X" },
      { chunk_type: "wiki", wiki_page_id: "A", library_name: "李白" },
      { chunk_type: "web_page" },
      { chunk_type: "wiki", wiki_page_id: "B", library_name: "杜甫" },
      { chunk_type: "wiki", wiki_page_id: "A", library_name: "李白-重复" },
    ];
    const result = dedupeWikiPages(sources);
    expect(result.map((s) => s.wiki_page_id)).toEqual(["A", "B"]);
  });
});