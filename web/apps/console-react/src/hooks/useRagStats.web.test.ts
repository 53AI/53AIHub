import { describe, expect, it } from "vitest";
import { formatRagStats } from "@km/shared-business/chat/hooks/useRagStats";

describe("formatRagStats web citations", () => {
  it("maps only cited web page URLs to the quotation list", () => {
    const citedUrl = "https://example.com/cited";
    const webSource = {
      chunk_id: "web-1",
      chunk_type: "web_page",
      source_type: "web",
      source_key: "[Source:2-1]",
      file_name: "Cited article",
      file_path: citedUrl,
      url: citedUrl,
    };
    const unquotedSource = {
      ...webSource,
      chunk_id: "web-2",
      file_name: "Unquoted article",
      file_path: "https://example.com/unquoted",
      url: "https://example.com/unquoted",
    };

    const formatted = formatRagStats({
      document_search: { chunks: [webSource, unquotedSource] },
      web_page_quotations: [citedUrl],
    });

    expect(formatted?.file_quotations).toEqual([expect.objectContaining(webSource)]);
  });
});
