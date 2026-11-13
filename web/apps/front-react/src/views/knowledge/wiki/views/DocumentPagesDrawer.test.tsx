import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as SharedUtils from "@km/shared-utils";
const computedStyle = window.getComputedStyle;
vi.spyOn(window, "getComputedStyle").mockImplementation((element) => computedStyle(element));
const api = vi.hoisted(() => ({ documentPages: vi.fn() }));
vi.mock("@/api/modules/wiki", () => ({ default: api }));
vi.mock("@/locales", () => ({ t: (key: string) => key }));
vi.mock("@km/shared-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof SharedUtils>()),
  getFormatTimeStamp: () => "time",
}));
const document = {
  file_id: "a",
  title: "Document",
  library_id: "lib",
  library_name: "Library",
  status: "failed" as const,
  generation_status: "success",
  page_counts: { total: 21, success: 20, failed: 1, processing: 0, pending: 0, waiting: 0, not_required: 0 },
  failure_summary: "",
  updated_time: 1,
  retry_eligible: false,
  retry_task_ids: [],
};
const page = {
  page_id: "p",
  page_slug: "slug with space",
  title: "Related page",
  page_type: "entity",
  page_status: "active",
  vectorization_status: "failed",
  vectorization_task_id: "task",
  failure_summary: "index error",
  retry_count: 2,
  retry_eligible: true,
  updated_time: 1,
};
describe("DocumentPagesDrawer", () => {
  it.each([
    ["processing", "wiki.queue.pages_generating"],
    ["failed", "wiki.queue.generation_failed"],
    ["success", "wiki.queue.pages_empty"],
  ])("shows empty guidance for generation status %s", async (generation_status, key) => {
    api.documentPages.mockResolvedValue({ document: { ...document, generation_status }, items: [], total: 0 });
    const { default: Drawer } = await import("./DocumentPagesDrawer");
    render(<Drawer spaceId="space" fileId="a" onClose={() => {}} onRetry={vi.fn()} retrying={false} refreshKey={0} />);
    await screen.findByText(key);
  });
  it("polls only while mounted and does not offer retry for read-only pages", async () => {
    api.documentPages.mockResolvedValue({ document, items: [{ ...page, retry_eligible: false }], total: 1 });
    const interval = vi.spyOn(window, "setInterval");
    const clear = vi.spyOn(window, "clearInterval");
    const { default: Drawer } = await import("./DocumentPagesDrawer");
    const view = render(
      <Drawer spaceId="space" fileId="a" onClose={() => {}} onRetry={vi.fn()} retrying={false} refreshKey={0} />,
    );
    await screen.findByText("Related page");
    expect(screen.queryByRole("button", { name: "action.retry" })).not.toBeInTheDocument();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 10000);
    const timer = interval.mock.results[interval.mock.results.length - 1]?.value;
    view.unmount();
    expect(clear).toHaveBeenCalledWith(timer);
    interval.mockRestore();
    clear.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    api.documentPages.mockResolvedValue({ document, items: [page], total: 21, page: 1, size: 10 });
  });
  it("loads ten pages at a time and keeps compact pagination in the drawer footer", async () => {
    const { default: Drawer } = await import("./DocumentPagesDrawer");
    const retry = vi.fn();
    render(<Drawer spaceId="space" fileId="a" onClose={() => {}} onRetry={retry} retrying={false} refreshKey={0} />);
    const link = await screen.findByRole("link", { name: "Related page" });
    expect(link.getAttribute("href")).toContain("selected=slug+with+space");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/wiki\.queue\.page_status:/)).toBeInTheDocument();
    expect(screen.getByText("wiki.queue.index_status")).toBeInTheDocument();
    expect(screen.queryByText("Library")).not.toBeInTheDocument();
    expect(screen.queryByText("wiki.queue.generation_status")).not.toBeInTheDocument();
    expect(api.documentPages).toHaveBeenLastCalledWith("a", { space_id: "space", page: 1, size: 10 });
    expect(window.document.querySelector(".ant-drawer-footer .ant-pagination")).toBeInTheDocument();
    await userEvent.click(window.document.querySelector(".ant-drawer-footer .ant-pagination-next button")!);
    await waitFor(() =>
      expect(api.documentPages).toHaveBeenLastCalledWith("a", { space_id: "space", page: 2, size: 10 }),
    );
    await userEvent.click(screen.getByRole("button", { name: "action.retry" }));
    expect(retry).toHaveBeenCalledWith(["task"]);
  });
  it("ignores previous document responses and loads errors with retry", async () => {
    let finish: (value: unknown) => void = () => {};
    api.documentPages
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("denied"));
    const { default: Drawer } = await import("./DocumentPagesDrawer");
    const props = { spaceId: "space", onClose: () => {}, onRetry: vi.fn(), retrying: false, refreshKey: 0 };
    const view = render(<Drawer {...props} fileId="a" />);
    view.rerender(<Drawer {...props} fileId="b" />);
    await screen.findByText("denied");
    await act(async () => finish({ document, items: [page], total: 1 }));
    expect(screen.queryByText("Related page")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "action.retry" }));
    await screen.findByText("Related page");
  });
});
