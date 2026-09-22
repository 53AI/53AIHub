import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, forwardRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EditDrawer, { type EditDrawerRef } from "./edit-drawer";

const mocks = vi.hoisted(() => ({
  getRetrieval: vi.fn(),
  reindexRetrieval: vi.fn(),
  loadFile: vi.fn(),
  currentFile: vi.fn(),
}));

vi.mock("@/api/modules/chunks", () => ({
  default: {
    retrieval: {
      get: mocks.getRetrieval,
      reindex: mocks.reindexRetrieval,
    },
    knowledge: {
      save: vi.fn(),
    },
  },
}));

vi.mock("@/stores/modules/library", () => ({
  useLibraryStore: () => ({
    currentFile: mocks.currentFile,
    loadFile: mocks.loadFile,
  }),
}));

vi.mock("@/hooks/usePoll", () => ({
  usePoll: () => ({
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("@/components/Markdown/editor", () => ({
  MarkdownEditor: forwardRef(({ value }: { value: string }, _ref) => (
    <textarea value={value} readOnly />
  )),
}));

vi.mock("./editor-section", () => ({
  EditorSection: ({ value }: { value: string }) => <div>{value}</div>,
}));

vi.mock("@km/shared-components-react", () => ({
  SvgIcon: () => null,
}));

vi.mock("@/locales", () => ({
  t: (key: string) => key,
}));

beforeEach(() => {
  mocks.getRetrieval.mockReset();
  mocks.reindexRetrieval.mockReset();
  mocks.loadFile.mockReset();
  mocks.currentFile.mockReset();

  mocks.currentFile.mockReturnValue({
    id: "file-1",
    ai_generate_chunk_status: "normal",
  });
  mocks.loadFile.mockResolvedValue(undefined);
  mocks.reindexRetrieval.mockResolvedValue(undefined);
  mocks.getRetrieval.mockResolvedValue({
    knowledge_chunk: {
      id: 7,
      chunk_index: 0,
      content: "知识点内容",
    },
    retrieval_chunks: [
      {
        id: 42,
        chunk_index: 0,
        chunk_type: "retrieval",
        content: "失败的索引块",
        embedding_status: "failed",
        error_reason: "embedding API 超时",
      },
    ],
  });
});

describe("EditDrawer retrieval embedding retry", () => {
  it("reindexes only the failed retrieval chunk and shows it as queued", async () => {
    const user = userEvent.setup();
    const ref = createRef<EditDrawerRef>();

    render(<EditDrawer ref={ref} file={{ name: "测试文档" } as any} />);

    act(() => {
      ref.current?.open({ id: 7 } as any);
    });

    const retryButton = await screen.findByRole("button", { name: "重新索引" });
    await user.click(retryButton);

    await waitFor(() => {
      expect(mocks.reindexRetrieval).toHaveBeenCalledWith(42);
      expect(screen.getByText("排队中")).toBeInTheDocument();
    });
  });
});
