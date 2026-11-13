import { describe, expect, it } from "vitest";
import { findMessageSourceChunk } from "./useChatMessages";

describe("findMessageSourceChunk", () => {
  it("finds citations in document_search.chunks when top-level chunks are absent", () => {
    const chunk = { source_key: "[Source:1-2]", content: "引用内容" };
    const message = { rag_stats: { document_search: { chunks: [chunk] } } };

    expect(findMessageSourceChunk(message, "1", "2")).toBe(chunk);
  });

  it("prefers top-level chunks when both chunk lists are present", () => {
    const chunk = { source: "[Source:1-2]", content: "主列表" };
    const message = {
      rag_stats: {
        chunks: [chunk],
        document_search: { chunks: [{ source_key: "[Source:1-2]" }] },
      },
    };

    expect(findMessageSourceChunk(message, "1", "2")).toBe(chunk);
  });
});
