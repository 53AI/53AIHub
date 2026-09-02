import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pagesMock = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    params: new URLSearchParams("space_id=X&sub=list"),
    setSource(s: string) {
      state.params = new URLSearchParams(s);
      state.notify();
    },
    notify() {
      listeners.forEach((l) => l());
    },
    _listeners: listeners,
  };
  return state;
});

vi.mock("react-router-dom", async () => {
  const React = await import("react");
  return {
    useSearchParams: () => {
      const [, force] = React.useState(0);
      React.useLayoutEffect(() => {
        nav._listeners.add(force);
        return () => {
          nav._listeners.delete(force);
        };
      }, []);
      const set = (updater: any) => {
        const next = updater(new URLSearchParams(nav.params.toString()));
        nav.params = next;
        nav.notify();
        return next;
      };
      return [nav.params, set];
    },
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/stores/modules/space", () => ({
  useSpaceStore: (sel?: any) => sel?.({ spaceId: "X", currentSpace: { name: "空间" } }),
}));

vi.mock("@/stores/modules/wiki", () => ({
  useWikiStore: (sel?: any) => sel?.({ loadPages: vi.fn(), hiddenPageIds: new Set() }),
}));

vi.mock("@/api/modules/wiki", () => ({
  default: {
    categories: vi.fn(async () => [
      { id: 5, name: "分类A", page_count: 3 },
      { id: 7, name: "分类B", page_count: 1 },
    ]),
    pages: pagesMock,
    queueStatus: vi.fn(async () => ({
      generation: { queued: 0, running: 0, total: 0 },
      vectorization: { queued: 0, running: 0, total: 0 },
    })),
  },
}));

vi.mock("@/api/modules/permissions", () => ({
  default: { myBatch: vi.fn(async () => ({})) },
}));

vi.mock("@km/shared-components-react", () => ({
  SvgIcon: () => <svg data-testid="svg" />,
  Search: () => <div data-testid="search" />,
}));

vi.mock("@km/shared-utils", () => ({ getFormatTimeStamp: () => "2026-01-01" }));

vi.mock("@/components/Breadcrumb", () => ({
  __esModule: true,
  default: () => <nav data-testid="breadcrumb" />,
}));

vi.mock("@/locales", () => ({ t: (k: string) => "L:" + k }));

vi.mock("@/components/KMPermission/constant", () => ({
  PERMISSION_TYPE: { none: 0 },
  RESOURCE_TYPE: { wiki_page: "wiki_page" },
}));

let originalObserver: any;
beforeEach(() => {
  originalObserver = (globalThis as any).IntersectionObserver;
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  pagesMock.mockReset();
  pagesMock.mockResolvedValue({ total: 0, items: [] });
});
afterEach(() => {
  (globalThis as any).IntersectionObserver = originalObserver;
});

const lastPageParams = () => {
  const calls = pagesMock.mock.calls;
  return calls.length ? calls[calls.length - 1][1] : null;
};

async function renderSidebar(source: string) {
  nav.setSource(source);
  const { default: LeftSidebar } = await import("./LeftSidebar");
  render(
    <LeftSidebar activeTab="list" setActiveTab={() => {}} selectedItemId="" setSelectedItemId={() => {}} />,
  );
  await waitFor(() => expect(pagesMock).toHaveBeenCalled());
}

describe("LeftSidebar category_id", () => {
  it("挂载时 URL 带 category_id=5:高亮分类并传给 pages", async () => {
    await renderSidebar("space_id=X&sub=list&category_id=5");
    expect(pagesMock.mock.calls[0][1].category_id).toBe(5);
    const active = screen.getByText("分类A").closest("div");
    expect(active?.className).toContain("bg-blue-50");
  });

  it("外部导航(不点击):URL 从无分类切到 category_id=7,应同步高亮并带 7 重查", async () => {
    pagesMock.mockResolvedValue({ total: 0, items: [] });
    await renderSidebar("space_id=X&sub=list");
    // 此时无分类
    expect(lastPageParams()?.category_id).toBeUndefined();

    // 模拟浏览器后退/外部导航:直接把 URL 改成 category_id=7(组件内未点击)
    await act(async () => {
      nav.setSource("space_id=X&sub=list&category_id=7");
    });

    await waitFor(() => {
      expect(lastPageParams()?.category_id).toBe(7);
    });
    const actB = screen.getByText("分类B").closest("div");
    expect(actB?.className).toContain("bg-blue-50");
  });

  it("组件内点击分类标签:设置分类并写入 URL", async () => {
    await renderSidebar("space_id=X&sub=list");
    await act(async () => {
      fireEvent.click(screen.getByText("分类B"));
    });
    await waitFor(() => {
      expect(lastPageParams()?.category_id).toBe(7);
    });
  });
});