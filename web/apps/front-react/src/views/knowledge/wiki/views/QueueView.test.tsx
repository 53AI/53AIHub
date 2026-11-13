import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
const feedback = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}));
vi.mock("antd", async (importActual) => ({...await importActual<typeof import("antd")>(), message: feedback}));
const api = vi.hoisted(() => ({ queueDocuments: vi.fn(), documentPages: vi.fn(), retryQueueTasks: vi.fn() }));
const space = vi.hoisted(() => ({ spaceId: "space-hash" }));
const computedStyle = window.getComputedStyle;
vi.spyOn(window, "getComputedStyle").mockImplementation((element) => computedStyle(element));
vi.mock("@/api/modules/wiki", () => ({
  default: {
    ...api,
  },
}));
vi.mock("@/stores/modules/space", () => ({
  useSpaceStore: (selector: (state: typeof space) => unknown) => selector(space),
}));
vi.mock("@/hooks/useResponsive", () => ({ useResponsive: () => ({ isMobile: false }) }));
vi.mock("@/locales", () => ({
  t: (key: string, params?: { count?: number }) => (params?.count === undefined ? key : `${key}:${params.count}`),
}));
vi.mock("@km/shared-utils", () => ({ getFormatTimeStamp: () => "formatted-time" }));
vi.mock("@km/shared-components-react", () => ({
  SvgIcon: () => <svg />,
  Search: ({ onDebouncedChange }: { onDebouncedChange: (value: string) => void }) => (
    <input aria-label="search" onChange={(event) => onDebouncedChange(event.target.value)} />
  ),
  Tabs: ({
    items,
    onChange,
  }: {
    items: { key: string; label: React.ReactNode }[];
    onChange: (key: string) => void;
  }) => (
    <div>
      {items.map((item) => (
        <button key={item.key} onClick={() => onChange(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));
const document = (file_id: string, retry_task_ids = ["shared-task"]) => ({
  file_id,
  title: file_id,
  library_id: "library",
  library_name: "Library",
  status: "failed",
  generation_status: "success",
  page_counts: { total: 12, success: 11, failed: 1, processing: 0, pending: 0, waiting: 0, not_required: 0 },
  retry_eligible: true,
  retry_task_ids,
  failure_summary: "index failed",
  updated_time: 1,
});
const response = (items = [document("doc-a"), document("doc-b")]) => ({
  items,
  total: items.length,
  status_counts: { failed: items.length, pending: 0, processing: 0, success: 0, waiting: 1 },
  page: 1,
  size: 10,
});
describe("document queue", () => {
  it("read-only documents cannot be selected or retried", async () => {
    api.queueDocuments.mockResolvedValue(
      response([{ ...document("readonly"), retry_eligible: false, retry_task_ids: [] }]),
    );
    const { default: QueueView } = await import("./QueueView");
    render(<QueueView />);
    await screen.findByRole("button", { name: "readonly" });
    expect(screen.getByRole("button", { name: /action\.retry/ })).toBeDisabled();
    expect(screen.getAllByRole("checkbox").every((input) => input.hasAttribute("disabled"))).toBe(true);
  });
  it("search and status changes reset pagination and ignore older searches", async () => {
    let finish: (value: unknown) => void = () => {};
    const { default: QueueView } = await import("./QueueView");
    render(<QueueView />);
    await screen.findByRole("button", { name: "doc-a" });
    api.queueDocuments.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await userEvent.type(screen.getByRole("textbox", { name: "search" }), "x");
    await userEvent.click(screen.getByRole("button", { name: /wiki\.queue\.filter_waiting/ }));
    await waitFor(() =>
      expect(api.queueDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyword: "x", status: "waiting", page: 1 }),
      ),
    );
    await act(async () => finish(response([document("old-search")])));
    expect(screen.queryByRole("button", { name: "old-search" })).not.toBeInTheDocument();
  });
  it("keeps later batches retryable when one request fails", async () => {
    api.queueDocuments.mockResolvedValue(
      response([
        document(
          "doc-a",
          Array.from({ length: 101 }, (_, i) => `task-${i}`),
        ),
      ]),
    );
    api.retryQueueTasks.mockRejectedValueOnce(new Error("retry unavailable"));
    const { default: QueueView } = await import("./QueueView");
    render(<QueueView />);
    await screen.findByRole("button", { name: "doc-a" });
    await userEvent.click(screen.getByRole("button", { name: /action\.retry/ }));
    await waitFor(() => expect(api.retryQueueTasks).toHaveBeenCalledTimes(2));
    expect(api.retryQueueTasks.mock.calls[1][0]).toEqual(["task-100"]);
    await waitFor(() => expect(api.queueDocuments).toHaveBeenCalledTimes(2));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    space.spaceId = "space-hash";
    api.queueDocuments.mockResolvedValue(response());
    api.documentPages.mockResolvedValue({ document: document("doc-a"), items: [], total: 0 });
    api.retryQueueTasks.mockImplementation(async (ids: string[]) => ({
      results: ids.map((id) => ({ id, success: true })),
    }));
  });
  it("opens document pages without linking to the source and counts documents", async () => {
    const { default: QueueView } = await import("./QueueView");
    render(<QueueView />);
    await screen.findByRole("button", { name: "doc-a" });
    expect(screen.getAllByText("wiki.queue.document_status").length).toBeGreaterThan(0);
    expect(screen.queryByText("wiki.queue.related_pages")).not.toBeInTheDocument();
    expect(screen.queryByText("wiki.queue.generation_status")).not.toBeInTheDocument();
    expect(screen.queryByText("wiki.queue.page_summary")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "doc-a" }));
    await waitFor(() =>
      expect(api.documentPages).toHaveBeenCalledWith("doc-a", { space_id: "space-hash", page: 1, size: 10 }),
    );
    expect(screen.queryByRole("link", { name: "doc-a" })).not.toBeInTheDocument();
    expect(screen.getByText("wiki.queue.summary_all").parentElement?.textContent).toContain("3");
  });
  it("deduplicates shared tasks across selected documents and retains server aggregation", async () => {
    const { default: QueueView } = await import("./QueueView");
    render(<QueueView />);
    await screen.findByRole("button", { name: "doc-a" });
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    await userEvent.click(screen.getByRole("button", { name: /wiki\.queue\.retry_selected:2/ }));
    await waitFor(() => expect(api.retryQueueTasks).toHaveBeenCalledWith(["shared-task"], "space-hash"));
    await waitFor(() => expect(api.queueDocuments).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("index failed")).toHaveLength(2);
  });
  it("batches 101 tasks in requests of at most 100", async () => {
    api.queueDocuments.mockResolvedValue(
      response([
        document(
          "doc-a",
          Array.from({ length: 101 }, (_, i) => `task-${i}`),
        ),
      ]),
    );
    const { default: QueueView } = await import("./QueueView");
    render(<QueueView />);
    await screen.findByRole("button", { name: "doc-a" });
    await userEvent.click(screen.getByRole("button", { name: /action\.retry/ }));
    await waitFor(() => expect(api.retryQueueTasks).toHaveBeenCalledTimes(2));
    expect(api.retryQueueTasks.mock.calls.map((call) => call[0].length)).toEqual([100, 1]);
  });
  it("shows one success toast for all retried tasks", async () => {
    api.queueDocuments.mockResolvedValue(
      response([
        document(
          "doc-a",
          Array.from({ length: 101 }, (_, i) => `task-${i}`),
        ),
      ]),
    );
    const { default: QueueView } = await import("./QueueView");
    render(<QueueView />);
    await screen.findByRole("button", { name: "doc-a" });
    await userEvent.click(screen.getByRole("button", { name: /action\.retry/ }));
    await waitFor(() => expect(feedback.success).toHaveBeenCalledTimes(1));
    expect(feedback.success).toHaveBeenCalledWith("wiki.queue.retry_success:101");
    expect(feedback.error).not.toHaveBeenCalled();
  });
  it("shows one partial failure toast for failed retries", async () => {
    api.retryQueueTasks.mockResolvedValueOnce({
      results: [
        { id: "task-a", success: true },
        { id: "task-b", success: false, error: "boom" },
      ],
    });
    const { default: QueueView } = await import("./QueueView");
    render(<QueueView />);
    await screen.findByRole("button", { name: "doc-a" });
    await userEvent.click(screen.getAllByRole("button", { name: /action\.retry/ })[0]);
    await waitFor(() => expect(feedback.error).toHaveBeenCalledTimes(1));
    expect(feedback.error).toHaveBeenCalledWith("wiki.queue.retry_partial_failed:1");
    expect(feedback.success).toHaveBeenCalledTimes(1);
  });
  it("shows load errors and supports retry", async () => {
    api.queueDocuments.mockRejectedValueOnce(new Error("unavailable"));
    const { default: QueueView } = await import("./QueueView");
    render(<QueueView />);
    await screen.findByText("unavailable");
    await userEvent.click(screen.getByRole("button", { name: /action\.retry/ }));
    await screen.findByRole("button", { name: "doc-a" });
  });
  it("ignores old space results and retry completion", async () => {
    let finish: (value: unknown) => void = () => {};
    api.retryQueueTasks.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { default: QueueView } = await import("./QueueView");
    const view = render(<QueueView />);
    await screen.findByRole("button", { name: "doc-a" });
    await userEvent.click(screen.getAllByRole("button", { name: /action\.retry/ })[0]);
    space.spaceId = "new-space";
    api.queueDocuments.mockResolvedValue(response([document("new-doc")]));
    view.rerender(<QueueView />);
    await screen.findByRole("button", { name: "new-doc" });
    const calls = api.queueDocuments.mock.calls.length;
    await act(async () => finish({ results: [{ id: "shared-task", success: true }] }));
    expect(api.queueDocuments).toHaveBeenCalledTimes(calls);
    expect(screen.queryByRole("button", { name: "doc-a" })).not.toBeInTheDocument();
  });
});
