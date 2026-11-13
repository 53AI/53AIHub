import { describe, expect, it } from "vitest";
import { formatRagStats } from "./useRagStats";

describe("formatRagStats document sources", () => {
  it("keeps full-document sources so answer citations can resolve them", () => {
    const source = {
      chunk_type: "document_full",
      file_id: "4C9aOl",
      file_name: "华为管理手册——客户关系管理.pdf",
      source_key: "[Source:1-1]",
      reference_id: "1-1",
    };

    const formatted = formatRagStats(
      { document_search: { chunks: [source] } },
    );

    expect(formatted?.chunks).toHaveLength(1);
    expect(formatted?.chunks[0].source_key).toBe("[Source:1-1]");
  });
});
