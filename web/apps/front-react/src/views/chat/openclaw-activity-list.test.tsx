import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildOpenClawActivity, OpenClawActivityList } from "@km/shared-business/chat";

describe("OpenClawActivityList", () => {
  it("renders multiple thinking cards and tool details inline", () => {
    render(
      <OpenClawActivityList
        items={[
          {
            key: "thinking-1",
            kind: "assistant.thinking",
            title: "已完成深度思考",
            summary: "First reasoning block.",
          },
          {
            key: "thinking-2",
            kind: "assistant.thinking",
            title: "已完成深度思考",
            summary: "Second reasoning block.",
          },
          {
            key: "tool-call",
            kind: "tool.call",
            title: "Used Web Search",
            summary: "Searching OpenClaw.",
            tool: {
              displayName: "Web Search",
              input: '{ "query": "OpenClaw" }',
              output: "Found sources.",
            },
          },
        ]}
      />
    );

    expect(screen.getAllByText("已完成深度思考")).toHaveLength(2);
    expect(screen.getByText("First reasoning block.")).toBeInTheDocument();
    expect(screen.getByText("Second reasoning block.")).toBeInTheDocument();
    expect(screen.getByText("Used Web Search")).toBeInTheDocument();
    expect(screen.getByText("Web Search")).toBeInTheDocument();
    expect(screen.getByText("TOOL INPUT")).toBeInTheDocument();
    expect(screen.getByText(/OpenClaw/)).toBeInTheDocument();
    expect(screen.getByText("TOOL OUTPUT")).toBeInTheDocument();
    expect(screen.getByText("Found sources.")).toBeInTheDocument();
  });

  it("does not repeat tool result text above the structured output block", () => {
    const { container } = render(
      <OpenClawActivityList
        items={[
          {
            key: "tool-result",
            kind: "tool.result",
            title: "Tool output",
            summary: "Tool exec returned a result",
            detail: "Tool exec returned a result",
            tool: {
              displayName: "Exec",
              output: "Tool exec returned a result",
            },
          },
        ]}
      />
    );

    const matches = (container.textContent || "").match(/Tool exec returned a result/g) || [];
    expect(matches).toHaveLength(1);
  });

  it("derives compact OpenClaw tool titles from structured tool arguments", () => {
    const titles = [
      buildOpenClawActivity({
        kind: "tool.call",
        payload: { data: { name: "write", args: { path: "/tmp/file.txt", content: "测试" } } },
      })?.title,
      buildOpenClawActivity({
        kind: "tool.call",
        payload: { data: { name: "read", args: { path: "/tmp/file.txt" } } },
      })?.title,
      buildOpenClawActivity({
        kind: "tool.call",
        payload: { data: { name: "web_search", args: { query: "best suspense thriller movies 2024 2025", count: 5 } } },
      })?.title,
      buildOpenClawActivity({
        kind: "tool.call",
        payload: { data: { name: "exec", args: { command: "curl -s --max-time 10 \"wttr.in/Chengdu\" 2>&1" } } },
      })?.title,
      buildOpenClawActivity({
        kind: "tool.call",
        payload: { data: { name: "exec", args: { command: 'echo -n "今天天气啊" | wc -m' } } },
      })?.title,
      buildOpenClawActivity({
        kind: "tool.call",
        payload: { data: { name: "exec", args: { command: 'python3 -c "print(1)"' } } },
      })?.title,
    ];

    expect(titles).toEqual([
      "To /tmp/file.txt (2 chars)",
      "From /tmp/file.txt",
      'For "best suspense thriller movies 2024 2025" (top 5)',
      "Fetch url",
      "Print text -> run wc",
      "Run python3 inline script",
    ]);
  });

  it("derives Exec titles from command input when the explicit title is generic", () => {
    const printfActivity = buildOpenClawActivity({
      kind: "tool.call",
      payload: {
        data: {
          name: "exec",
          title: "Used Exec",
          input: 'printf "你好" | wc -m',
        },
      },
    });
    const pythonActivity = buildOpenClawActivity({
      kind: "tool.call",
      payload: {
        data: {
          name: "exec",
          displayName: "Exec",
          input: { command: 'python3 -c "print(1)"' },
        },
      },
    });
    const metaActivity = buildOpenClawActivity({
      kind: "tool.call",
      payload: {
        data: {
          name: "exec",
          title: "Used Exec",
          meta: 'with run node, `node scripts/build.js --check`',
        },
      },
    });

    expect([printfActivity?.title, pythonActivity?.title, metaActivity?.title]).toEqual([
      "Print text -> run wc",
      "Run python3 inline script",
      "Run node",
    ]);
    expect(printfActivity?.tool?.input).toBe('printf "你好" | wc -m');
    expect(pythonActivity?.tool?.input).toBe('python3 -c "print(1)"');
    expect(metaActivity?.tool?.input).toBe("node scripts/build.js --check");
  });

  it("falls back to Exec without repeating Used Exec when command details are unavailable", () => {
    const activity = buildOpenClawActivity({
      kind: "tool.call",
      payload: {
        data: {
          name: "exec",
          title: "Used Exec",
        },
      },
    });

    expect(activity?.title).toBe("Exec");
    expect(activity?.summary).toBe("Exec");
    expect(activity?.tool?.input).toBe("");
  });

  it("keeps tool result titles as Tool output when structured output is present", () => {
    const activity = buildOpenClawActivity({
      kind: "tool.result",
      payload: { data: { name: "read", meta: "from ~/.openclaw/workspace/file.txt", result: { content: "hello" } } },
    });

    expect(activity?.title).toBe("Tool output");
    expect(activity?.tool?.meta).toBe("");
  });

  it("renders WorkBuddy interruption options and submits the selected option", async () => {
    const onInteractionSubmit = vi.fn();
    render(
      <OpenClawActivityList
        onInteractionSubmit={onInteractionSubmit}
        items={[
          {
            key: "question-1",
            kind: "run.interrupted",
            title: "等待用户选择",
            summary: "请选择下一步",
            detail: "请选择下一步",
            requiresUserInput: true,
            interaction: {
              id: "request-1",
              type: "question",
              method: "_codebuddy.ai/question",
              question: "请选择下一步",
              options: [
                { id: "continue", label: "继续执行", value: "continue" },
                { id: "stop", label: "停止", value: "stop" },
              ],
            },
          },
        ]}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "继续执行" }));
    });

    expect(onInteractionSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "question-1" }),
      expect.objectContaining({ id: "continue", value: "continue" })
    );
  });
});
