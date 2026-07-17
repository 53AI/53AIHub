import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { markdownPreview } from "@/components/Markdown/helper";
import MarkdownViewer from "./MarkdownViewer";

vi.mock("@/components/Markdown/helper", () => ({
  markdownPreview: vi.fn(async (element: HTMLDivElement | null, content = "") => {
    if (element) {
      element.innerHTML += `<p>${content}</p>`;
    }
  }),
}));

vi.mock("@/utils/loadLib", () => ({
  default: vi.fn(async () => undefined),
}));

vi.mock("@km/shared-utils", () => ({
  copyToClip: vi.fn(async () => undefined),
}));

describe("MarkdownViewer", () => {
  beforeEach(() => {
    vi.mocked(markdownPreview).mockClear();
  });

  it("renders markdown content inside the scoped preview container", async () => {
    render(<MarkdownViewer content={"# Title\n\nLong paragraph"} />);

    await waitFor(() => {
      expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(markdownPreview).toHaveBeenCalledTimes(1);
    });

    const preview = document.querySelector(".markdown-viewer-content.vditor-reset");
    expect(preview).toBeTruthy();
  });

  it("clears stale markdown output before rendering changed content", async () => {
    const { rerender } = render(<MarkdownViewer content={"First"} />);

    await waitFor(() => {
      expect(markdownPreview).toHaveBeenCalledTimes(1);
    });
    const preview = document.querySelector(".markdown-viewer-content.vditor-reset");
    expect(preview?.innerHTML).toContain("First");

    rerender(<MarkdownViewer content={"Second"} />);

    await waitFor(() => {
      expect(markdownPreview).toHaveBeenCalledTimes(2);
    });
    expect(preview?.innerHTML).not.toContain("First");
    expect(preview?.innerHTML).toContain("Second");
  });
});
