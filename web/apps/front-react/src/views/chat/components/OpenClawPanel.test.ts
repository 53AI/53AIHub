import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OpenClawPanel, { formatOpenClawGatewayName } from "./OpenClawPanel";
import type { OpenClawConnectionState } from "../openclaw-status";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  config: vi.fn(),
  skills: vi.fn(),
  cronTasks: vi.fn(),
}));

vi.mock("@/api/modules/openclaw", () => ({
  default: {
    status: mocks.status,
    config: mocks.config,
    skills: mocks.skills,
    cronTasks: mocks.cronTasks,
  },
}));

const connectedStatus = {
  healthy: true,
  connectionHealthy: true,
  hostKind: "qclaw",
  hub53ai: { connectionStatus: "connected" },
  cronScheduler: { jobCount: 1 },
};

const disconnectedStatus = {
  healthy: true,
  gatewayHealth: { ok: true, status: "ok" },
  connectionHealthy: false,
  hub53ai: { connectionStatus: "disconnected" },
};

function renderPanel({
  status = connectedStatus,
  connectionState = "connected",
  statusLoading = false,
  onRefreshStatus = mocks.status as any,
  open = true,
}: {
  status?: Record<string, any> | null;
  connectionState?: OpenClawConnectionState;
  statusLoading?: boolean;
  onRefreshStatus?: (options?: { showLoading?: boolean }) => Promise<unknown>;
  open?: boolean;
} = {}) {
  return render(
    createElement(OpenClawPanel, {
      agentId: 2,
      open,
      status,
      connectionState,
      statusLoading,
      onRefreshStatus,
      onClose: () => undefined,
    })
  );
}

function mockConnectedPanelData() {
  mocks.status.mockResolvedValue({
    data: connectedStatus,
  });
  mocks.config.mockResolvedValue({ data: { modelName: "modelroute" } });
  mocks.skills.mockResolvedValue({
    data: {
      enabledSkills: [{ id: "voice-to-minutes", name: "录音转文字" }],
    },
  });
  mocks.cronTasks.mockResolvedValue({
    data: {
      cronTasks: [
        {
          id: "cron-24h",
          name: "no-op-24h",
          enabled: true,
          schedule: "every 1d",
        },
      ],
    },
  });
}

beforeEach(() => {
  vi.useRealTimers();
  localStorage.setItem("default_lang", "zh-cn");
  mocks.status.mockReset();
  mocks.config.mockReset();
  mocks.skills.mockReset();
  mocks.cronTasks.mockReset();
  mockConnectedPanelData();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.removeItem("default_lang");
});

describe("formatOpenClawGatewayName", () => {
  it("uses OpenClaw for openclaw host kind", () => {
    expect(formatOpenClawGatewayName("openclaw")).toBe("OpenClaw");
  });

  it("uses QClaw for qclaw host kind", () => {
    expect(formatOpenClawGatewayName("qclaw")).toBe("QClaw");
  });

  it("uses the compatible host brand name when available", () => {
    expect(formatOpenClawGatewayName("hermes")).toBe("Hermes");
    expect(formatOpenClawGatewayName("workbuddy")).toBe("WorkBuddy");
    expect(formatOpenClawGatewayName("codex")).toBe("Codex");
    expect(formatOpenClawGatewayName("manus")).toBe("Manus");
  });

  it("falls back to OpenClaw for unsupported host kinds", () => {
    expect(formatOpenClawGatewayName("custom-claw")).toBe("OpenClaw");
  });

  it("falls back to OpenClaw when host kind is missing", () => {
    expect(formatOpenClawGatewayName(undefined)).toBe("OpenClaw");
  });
});

describe("OpenClawPanel loading", () => {
  it("renders cron task details without disabled action buttons", async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("no-op-24h")).toBeInTheDocument();
    });

    expect(document.body.textContent).toContain("频率：every 1d");
    expect(screen.queryByRole("button", { name: "暂停" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("renders WorkBuddy runtime model, worker, expert, and skills", async () => {
    mocks.status.mockResolvedValue({
      data: {
        healthy: true,
        connectionHealthy: true,
        hostKind: "workbuddy",
        requestModelName: "auto",
        modelPrimary: "auto",
        workbuddyVersion: "5.0.3",
        expertId: "BrandGuardian",
        permissionMode: "bypassPermissions",
        workerCount: 2,
        workerStatus: {
          sharedSessionActive: true,
          sharedSessionId: "53aihub-workbuddy-shared",
          endpoint: "http://127.0.0.1:49446",
          mainEndpoint: "http://127.0.0.1:49416",
        },
        cronScheduler: { jobCount: 0 },
      },
    });
    mocks.config.mockResolvedValue({
      data: {
        gateway: { hostKind: "workbuddy" },
        model: { requestModelName: "auto" },
        workbuddy: {
          version: "5.0.3",
          sessionId: "53aihub-workbuddy-shared",
          expertId: "BrandGuardian",
          permissionMode: "bypassPermissions",
        },
      },
    });
    mocks.skills.mockResolvedValue({
      data: {
        enabledSkills: [
          {
            id: "weixinpay@workbuddy-builtin:weixinpay-intro",
            name: "weixinpay-intro",
            description: "微信支付技能",
          },
          {
            skill_id: "skill-1",
            skill_name: "openclaw_pdf_probe",
            display_name: "PDF Probe",
          },
        ],
      },
    });
    mocks.cronTasks.mockResolvedValue({ data: { cronTasks: [] } });

    renderPanel({
      status: {
        ...connectedStatus,
        hostKind: "workbuddy",
        requestModelName: "auto",
        modelPrimary: "auto",
        workbuddyVersion: "5.0.3",
        expertId: "BrandGuardian",
        permissionMode: "bypassPermissions",
        workerCount: 2,
        workerStatus: {
          sharedSessionActive: true,
          sharedSessionId: "53aihub-workbuddy-shared",
          endpoint: "http://127.0.0.1:49446",
          mainEndpoint: "http://127.0.0.1:49416",
        },
        cronScheduler: { jobCount: 0 },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("WorkBuddy")).toBeInTheDocument();
    });

    expect(document.body.textContent).toContain("auto");
    expect(document.body.textContent).toContain("BrandGuardian");
    expect(document.body.textContent).toContain("bypassPermissions");
    expect(document.body.textContent).toContain("已激活 / 2 个");
    expect(document.body.textContent).toContain("weixinpay-intro");
    expect(document.body.textContent).toContain("PDF Probe");
    expect(document.body.textContent).toContain("skill-1");
    expect(document.body.textContent).not.toContain("modelroute");
  });

  it("renders Codex runtime status without asking for a local path", async () => {
    mocks.status.mockResolvedValue({
      data: {
        healthy: true,
        connectionHealthy: true,
        hostKind: "codex",
        runnerCommand: "codex-app-server",
        codexVersion: "codex-cli 0.134.0",
        workspaceRoot: "/Users/test/.53ai/codex-workspaces",
        lastConnectedAt: "2026-06-15T08:00:00.000Z",
        lastHeartbeatAt: "2026-06-15T08:01:00.000Z",
      },
    });
    mocks.config.mockResolvedValue({
      data: {
        gateway: { hostKind: "codex", runnerCommand: "codex-app-server" },
        codex: {
          version: "codex-cli 0.134.0",
          workspaceRoot: "/Users/test/.53ai/codex-workspaces",
        },
      },
    });
    mocks.skills.mockResolvedValue({ data: { enabledSkills: [] } });
    mocks.cronTasks.mockResolvedValue({ data: { cronTasks: [] } });

    renderPanel({
      status: {
        ...connectedStatus,
        hostKind: "codex",
        runnerCommand: "codex-app-server",
        codexVersion: "codex-cli 0.134.0",
        workspaceRoot: "/Users/test/.53ai/codex-workspaces",
        cronScheduler: { jobCount: 0 },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Codex")).toBeInTheDocument();
    });

    expect(document.body.textContent).toContain("/Users/test/.53ai/codex-workspaces");
    expect(document.body.textContent).toContain("codex-app-server");
    expect(document.body.textContent).toContain("codex-cli 0.134.0");
    expect(document.body.textContent).not.toContain("选择本地路径");
  });

  it("uses the design assets for gateway and section icons", async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("录音转文字")).toBeInTheDocument();
    });

    const gatewayLogo = screen.getByAltText("QClaw") as HTMLImageElement;
    expect(gatewayLogo.getAttribute("src")).toContain("/images/vibe/openclaw-panel/qclaw-logo.svg");

    const overviewIcon = screen.getByAltText("概览") as HTMLImageElement;
    expect(overviewIcon.getAttribute("src")).toContain("/images/vibe/openclaw-panel/overview.svg");

    const modelIcon = screen.getByAltText("模型") as HTMLImageElement;
    expect(modelIcon.getAttribute("src")).toContain("/images/vibe/openclaw-panel/model.svg");

    const cronIcon = screen.getByAltText("定时任务") as HTMLImageElement;
    expect(cronIcon.getAttribute("src")).toContain("/images/vibe/openclaw-panel/cron.svg");

    const skillsIcon = screen.getByAltText("技能") as HTMLImageElement;
    expect(skillsIcon.getAttribute("src")).toContain("/images/vibe/openclaw-panel/skills.svg");

    const versionIcon = screen.getByAltText("当前版本") as HTMLImageElement;
    expect(versionIcon.getAttribute("src")).toContain("/images/vibe/openclaw-panel/version.svg");

    const skillItemIcon = screen.getByAltText("录音转文字 图标") as HTMLImageElement;
    expect(skillItemIcon.getAttribute("src")).toContain("/images/vibe/openclaw-panel/skill-item.svg");
  });

  it("uses the parent disconnected state without loading details", async () => {
    renderPanel({ status: disconnectedStatus, connectionState: "disconnected" });

    await waitFor(() => {
      expect(screen.getByText("• 未连接")).toBeInTheDocument();
    });

    expect(document.body.textContent).toContain("OpenClaw 插件未连接，正在重连...");
    expect(mocks.status).toHaveBeenCalledWith({ showLoading: true });
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.skills).not.toHaveBeenCalled();
    expect(mocks.cronTasks).not.toHaveBeenCalled();
  });

  it("uses the host brand in the disconnected warning", async () => {
    renderPanel({
      status: {
        ...disconnectedStatus,
        hostKind: "qclaw",
      },
      connectionState: "disconnected",
    });

    await waitFor(() => {
      expect(screen.getByText("• 未连接")).toBeInTheDocument();
    });

    expect(document.body.textContent).toContain("QClaw 插件未连接，正在重连...");
  });

  it("renders the checking state from the parent status source", async () => {
    renderPanel({ status: null, connectionState: "checking", statusLoading: true });

    await waitFor(() => {
      expect(screen.getByText("• 检测中")).toBeInTheDocument();
    });

    expect(document.body.textContent).not.toContain("Request failed with status code 503");
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.skills).not.toHaveBeenCalled();
    expect(mocks.cronTasks).not.toHaveBeenCalled();
  });

  it("keeps a bottom border on the last collapse item", async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("no-op-24h")).toBeInTheDocument();
    });

    const collapse = document.querySelector(".ant-collapse");
    expect(collapse?.className).toContain("[&_.ant-collapse-item:last-child]:!border-b");
  });

  it("requests a parent status refresh on open and loads details after parent reconnects", async () => {
    const { rerender } = renderPanel({ status: disconnectedStatus, connectionState: "disconnected" });

    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(mocks.config).not.toHaveBeenCalled();

    rerender(
      createElement(OpenClawPanel, {
        agentId: 2,
        open: true,
        status: connectedStatus,
        connectionState: "connected",
        statusLoading: false,
        onRefreshStatus: mocks.status,
        onClose: () => undefined,
      })
    );

    await waitFor(() => {
      expect(screen.getByText("no-op-24h")).toBeInTheDocument();
    });
    expect(mocks.config).toHaveBeenCalledTimes(1);
    expect(mocks.skills).toHaveBeenCalledTimes(1);
    expect(mocks.cronTasks).toHaveBeenCalledTimes(1);
  });
});
