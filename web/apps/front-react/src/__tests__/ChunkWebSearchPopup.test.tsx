import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { ChatConfigProvider } from "../../../../packages/shared-business/src/chat/i18n";
import Chunk, { type ChunkRef } from "../../../../packages/shared-business/src/chat/components/source/popups/Chunk";

describe("Chunk web search popup", () => {
  it("shows a stable icon and page title without a remote library icon", async () => {
    const ref = createRef<ChunkRef>();
    render(
      <ChatConfigProvider lang="zh-cn">
        <Chunk ref={ref} />
      </ChatConfigProvider>,
    );

    await act(async () => {
      ref.current?.setLibraryInfo({
        chunk_id: "web-1",
        chunk_type: "web_page",
        file_name: "Example search result",
        file_path: "https://example.com/article",
        content: "Search summary",
      });
    });

    expect(await screen.findByRole("heading", { name: "Example search result" })).toBeTruthy();
    expect(document.querySelector(".ant-popover .ant-popover-content img")).toBeNull();
  });
});
