import { describe, expect, it } from "vitest";
import { buildKnowledgeSourcePayload } from "./buildKnowledgeSourcePayload";

describe("buildKnowledgeSourcePayload", () => {
  it("sends web search without model-specific switches", () => {
    const payload = buildKnowledgeSourcePayload({
      state: { allKnowledge: false, networkSearch: true, knowledgeGraph: false, wiki: false },
      graphEnabled: false,
      webSearchEnabled: true,
      wikiEnabled: false,
    });

    expect(payload).toEqual({ web_search_config: { enable: true } });
  });

  it("combines web search with Wiki sources", () => {
    const payload = buildKnowledgeSourcePayload({
      state: { allKnowledge: false, networkSearch: true, knowledgeGraph: false, wiki: true },
      graphEnabled: false,
      webSearchEnabled: true,
      wikiEnabled: true,
      wikis: [
        { id: "space-1", wikiType: "space" },
        { id: "page-1", wikiType: "page", space_id: "space-1" },
      ],
    });

    expect(payload).toEqual({
      web_search_config: { enable: true },
      wiki_search_config: {
        enabled: true,
        space_ids: ["space-1"],
        wiki_page_ids: ["page-1"],
      },
    });
  });

  it("keeps selected Wiki sources when web search is disabled", () => {
    const payload = buildKnowledgeSourcePayload({
      state: { allKnowledge: false, networkSearch: false, knowledgeGraph: false, wiki: true },
      graphEnabled: false,
      webSearchEnabled: true,
      wikiEnabled: true,
      wikis: [{ id: "page-1", wikiType: "page", space_id: "space-1" }],
    });

    expect(payload).toEqual({
      wiki_search_config: { enabled: true, space_ids: ["space-1"], wiki_page_ids: ["page-1"] },
    });
  });
});
