import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ChatConfigProvider } from "../../../i18n";
import { Quotation } from "./Quotation";

describe("Quotation web sources", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows and sorts web source numbers by the first source-key segment", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <ChatConfigProvider lang="zh-cn">
          <Quotation
            files={[
              { chunk_id: "4", chunk_type: "web_page", file_name: "第四页", source_key: "[Source:4-1]" },
              { chunk_id: "2", chunk_type: "web_page", file_name: "第二页", source_key: "[Source:2-1]" },
              { chunk_id: "1", chunk_type: "web_page", file_name: "第一页", source_key: "[Source:1-1]" },
              { chunk_id: "3", chunk_type: "web_page", file_name: "第三页", source_key: "[Source:3-1]" },
            ]}
          />
        </ChatConfigProvider>
      );
    });

    act(() => {
      container.querySelector(".mt-3")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(Array.from(container.querySelectorAll(".size-4")).map((badge) => badge.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(Array.from(container.querySelectorAll(".flex-1.min-w-0 .truncate")).map((title) => title.textContent)).toEqual([
      "第一页",
      "第二页",
      "第三页",
      "第四页",
    ]);
  });
});
