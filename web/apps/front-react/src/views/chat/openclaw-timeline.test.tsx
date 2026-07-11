import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  mergeOpenClawTimelineEventsIntoMessage,
  mergeOutputFiles,
  OpenClawTimeline,
  type Message,
  type OpenClawTimelineItem,
} from "@km/shared-business/chat";

describe("OpenClawTimeline", () => {
  const baseMessage = {
    id: "assistant-1",
    role: "assistant",
    answer: "",
    question: "",
    conversation_id: "agent:main:timeline-test",
  } as Message;

  it("collapses completed trace steps while keeping answers and output files visible", () => {
    const items: OpenClawTimelineItem[] = [
      {
        key: "thinking-1",
        mergeKey: "thinking-1",
        type: "thinking",
        seq: 2,
        title: "已完成深度思考",
        content: "先整理问题。",
      },
      {
        key: "tool-call-1",
        mergeKey: "tool-call-1",
        type: "tool_call",
        seq: 3,
        title: "Used Web Search",
        detail: "开始搜索资料。",
        tool: {
          name: "web_search",
          displayName: "Web Search",
          input: '{ "query": "OpenClaw timeline" }',
        },
      },
      {
        key: "answer-1",
        mergeKey: "answer-1",
        type: "answer",
        seq: 4,
        content: "第一段正文",
      },
      {
        key: "thinking-2",
        mergeKey: "thinking-2",
        type: "thinking",
        seq: 5,
        title: "继续思考",
        content: "补充第二轮分析。",
      },
      {
        key: "output-files-1",
        mergeKey: "output-files-1",
        type: "output_files",
        seq: 6,
        title: "生成了 1 个文件",
        files: [
          {
            id: "file-1",
            file_name: "report.txt",
            signed_download_url: "https://example.com/report.txt?sig=1",
          },
        ],
      },
      {
        key: "answer-2",
        mergeKey: "answer-2",
        type: "answer",
        seq: 7,
        content: "第二段正文",
      },
    ];

    const { container } = render(
      <OpenClawTimeline
        message={baseMessage}
        items={items}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    const traceToggle = screen.getByTestId("openclaw-trace-group-toggle");
    expect(traceToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("openclaw-trace-group-body")).not.toBeInTheDocument();
    expect(screen.getByText("第一段正文")).toBeInTheDocument();
    expect(screen.getByText("第二段正文")).toBeInTheDocument();
    expect(screen.getByText("report.txt")).toBeInTheDocument();

    fireEvent.click(traceToggle);

    const content = container.textContent || "";
    expect(content.indexOf("先整理问题。")).toBeLessThan(content.indexOf("Used Web Search"));
    expect(content.indexOf("Used Web Search")).toBeLessThan(content.indexOf("补充第二轮分析。"));
    expect(content.indexOf("补充第二轮分析。")).toBeLessThan(content.indexOf("第一段正文"));
    expect(content.indexOf("第一段正文")).toBeLessThan(content.indexOf("第二段正文"));
    expect(content.indexOf("第二段正文")).toBeLessThan(content.indexOf("report.txt"));
    expect(screen.queryByText("生成了 1 个文件")).not.toBeInTheDocument();
  });

  it("moves only the last visible answer block after trailing activities", () => {
    const items: OpenClawTimelineItem[] = [
      {
        key: "thinking-1",
        mergeKey: "thinking-1",
        type: "thinking",
        seq: 2,
        title: "已完成深度思考",
        content: "先整理问题。",
      },
      {
        key: "answer-1",
        mergeKey: "answer-1",
        type: "answer",
        seq: 3,
        content: "先给出一版正文",
      },
      {
        key: "thinking-2",
        mergeKey: "thinking-2",
        type: "thinking",
        seq: 4,
        title: "继续思考",
        content: "补充后续分析。",
      },
    ];

    const { container } = render(
      <OpenClawTimeline
        message={baseMessage}
        items={items}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    fireEvent.click(screen.getByTestId("openclaw-trace-group-toggle"));

    const content = container.textContent || "";
    expect(content.indexOf("先整理问题。")).toBeLessThan(content.indexOf("补充后续分析。"));
    expect(content.indexOf("补充后续分析。")).toBeLessThan(content.indexOf("先给出一版正文"));
  });

  it("mounts the assistant menu on the visible answer bubble", () => {
    const { container } = render(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "thinking-1",
            mergeKey: "thinking-1",
            type: "thinking",
            seq: 2,
            title: "已完成深度思考",
            content: "先做分析。",
          },
          {
            key: "answer-1",
            mergeKey: "answer-1",
            type: "answer",
            seq: 3,
            content: "这是可见正文。",
          },
        ]}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
        answerMenu={<div data-testid="openclaw-answer-menu">菜单动作</div>}
      />
    );

    const answerBubble = screen.getByText("这是可见正文。").closest(".x-assistant-bubble");
    expect(answerBubble).not.toBeNull();
    expect(answerBubble).toContainElement(screen.getByTestId("openclaw-answer-menu"));
    expect(container.querySelectorAll(".x-assistant-bubble__menu")).toHaveLength(1);
    expect(container.querySelector(".x-assistant-bubble__menu--hidden")).toBeNull();
  });

  it("does not render run.completed cards and merges all output_files items into one tail block", () => {
    const items: OpenClawTimelineItem[] = [
      {
        key: "thinking-1",
        mergeKey: "thinking-1",
        type: "thinking",
        seq: 2,
        title: "已完成深度思考",
        content: "先做分析。",
      },
      {
        key: "completed-1",
        mergeKey: "completed-1",
        type: "run_terminal",
        kind: "run.completed",
        seq: 3,
        title: "运行已完成",
        detail: "这一条不应该显示",
      },
      {
        key: "answer-1",
        mergeKey: "answer-1",
        type: "answer",
        seq: 4,
        content: "这是正文。",
      },
      {
        key: "output-files-1",
        mergeKey: "output-files-1",
        type: "output_files",
        seq: 5,
        title: "生成了 1 个文件",
        files: [
          {
            id: "file-1",
            file_name: "report-a.txt",
            signed_download_url: "https://example.com/report-a.txt?sig=1",
          },
        ],
      },
      {
        key: "output-files-2",
        mergeKey: "output-files-2",
        type: "output_files",
        seq: 6,
        title: "生成了 2 个文件",
        files: [
          {
            id: "file-2",
            file_name: "report-b.txt",
            signed_download_url: "https://example.com/report-b.txt?sig=1",
          },
        ],
      },
    ];

    const { container } = render(
      <OpenClawTimeline
        message={baseMessage}
        items={items}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    const content = container.textContent || "";
    expect(content).not.toContain("运行已完成");
    expect(screen.getByText("report-a.txt")).toBeInTheDocument();
    expect(screen.getByText("report-b.txt")).toBeInTheDocument();
    expect(screen.queryByText("生成了 2 个文件")).not.toBeInTheDocument();
    expect(content.indexOf("这是正文。")).toBeLessThan(content.indexOf("report-a.txt"));
  });

  it("dedupes same-turn OpenClaw output file updates by logical file identity", () => {
    const items: OpenClawTimelineItem[] = [
      {
        key: "answer-1",
        mergeKey: "answer-1",
        type: "answer",
        seq: 3,
        content: "文件已经更新。",
      },
      {
        key: "output-files-local",
        mergeKey: "output-files-local",
        type: "output_files",
        seq: 4,
        files: [
          {
            id: "/tmp/report.md",
            file_name: "report.md",
            url: "file:///tmp/report.md",
            source_kind: "workspace",
          },
        ],
      },
      {
        key: "output-files-persisted",
        mergeKey: "output-files-persisted",
        type: "output_files",
        seq: 5,
        files: [
          {
            id: "upload-file-1",
            file_name: "report.md",
            signed_download_url: "https://example.com/report.md?sig=1",
            source_kind: "workspace",
            message_id: "assistant-1",
          },
        ],
      },
    ];

    render(
      <OpenClawTimeline
        message={baseMessage}
        items={items}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(screen.getAllByText("report.md")).toHaveLength(1);
  });

  it("keeps default output file merging keyed by concrete file identity", () => {
    const merged = mergeOutputFiles(
      [{ id: "file-a", file_name: "same-name.md" }],
      [{ id: "file-b", file_name: "same-name.md" }]
    );

    expect(merged).toHaveLength(2);
  });

  it("keeps the latest same-turn OpenClaw output file revision", () => {
    const merged = mergeOutputFiles(
      [
        {
          id: "local-draft",
          file_name: "same-name.md",
          base64: Buffer.from("wrong").toString("base64"),
          content: "wrong",
        },
      ],
      [
        {
          id: "local-final",
          file_name: "same-name.md",
          base64: Buffer.from("correct").toString("base64"),
          content: "correct",
          signed_download_url: "https://example.com/same-name.md?sig=2",
        },
      ],
      { logicalIdentity: true }
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "local-final",
      file_name: "same-name.md",
      base64: Buffer.from("correct").toString("base64"),
      content: "correct",
      signed_download_url: "https://example.com/same-name.md?sig=2",
    });
  });

  it("does not render a tail files block when the turn has no output_files items", () => {
    const { container } = render(
      <OpenClawTimeline
        message={{
          ...baseMessage,
          outputFiles: [
            {
              id: "old-file",
              file_name: "old.txt",
              signed_download_url: "https://example.com/old.txt?sig=1",
            },
          ],
        } as Message}
        items={[
          {
            key: "thinking-1",
            mergeKey: "thinking-1",
            type: "thinking",
            seq: 2,
            title: "已完成深度思考",
            content: "正文里提到了文件路径，但这一轮没有新文件事件。",
          },
          {
            key: "answer-1",
            mergeKey: "answer-1",
            type: "answer",
            seq: 3,
            content: "文件已写入 `/tmp/old.txt`。",
          },
        ]}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(container.textContent || "").not.toContain("生成了");
    expect(screen.queryByText("old.txt")).not.toBeInTheDocument();
  });

  it("holds back answer blocks during streaming until the preceding activity arrives", () => {
    const answerItem: OpenClawTimelineItem = {
      key: "answer-early",
      mergeKey: "answer-early",
      type: "answer",
      seq: 5,
      content: "正文先到",
    };

    const { container, rerender } = render(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "thinking-early",
            mergeKey: "thinking-early",
            type: "thinking",
            seq: 2,
            title: "已完成深度思考",
            content: "只有前半段思考。",
          },
          answerItem,
        ]}
        isStreaming
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(container.querySelectorAll(".x-assistant-bubble")).toHaveLength(1);
    expect(container.textContent || "").not.toContain("正文先到");

    rerender(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "thinking-early",
            mergeKey: "thinking-early",
            type: "thinking",
            seq: 2,
            title: "已完成深度思考",
            content: "只有前半段思考。",
          },
          {
            key: "tool-middle",
            mergeKey: "tool-middle",
            type: "tool_call",
            seq: 4,
            title: "Used Web Search",
            detail: "补到了前置工具调用。",
          },
          answerItem,
        ]}
        isStreaming
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(container.querySelectorAll(".x-assistant-bubble")).toHaveLength(1);
    expect(container.textContent || "").toContain("补到了前置工具调用。");
  });

  it("keeps a loading assistant bubble visible while streaming activities exist but no answer is visible yet", () => {
    const { container } = render(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "thinking-1",
            mergeKey: "thinking-1",
            type: "thinking",
            seq: 2,
            title: "已完成深度思考",
            content: "先检查天气工具。",
          },
          {
            key: "tool-call-1",
            mergeKey: "tool-call-1",
            type: "tool_call",
            seq: 3,
            title: "Used Exec",
            tool: {
              name: "exec",
              displayName: "Exec",
              input: 'curl -s "wttr.in/Chengdu?2"',
            },
          },
        ]}
        isStreaming
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(container.querySelectorAll(".x-assistant-bubble")).toHaveLength(1);
    expect(container.textContent || "").toContain("先检查天气工具。");
    expect(container.textContent || "").not.toContain("最终天气结果");
  });

  it("keeps the loading bubble when transient progress answers are followed by activities", () => {
    const message = {
      ...baseMessage,
      id: "assistant-streaming-progress",
      loading: true,
      openclawActivities: [],
    } as Message;

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-weather",
          sessionId: "agent:main:timeline-test",
          seq: 10,
          kind: "assistant.thinking",
          payload: { content: "先检查广州天气。" },
          createdAt: "2026-06-10T08:22:00.000Z",
        },
        {
          id: "progress-answer",
          sessionId: "agent:main:timeline-test",
          seq: 11,
          kind: "assistant.message",
          payload: { content: "我来查询广州今天的天气情况。" },
          createdAt: "2026-06-10T08:22:01.000Z",
        },
        {
          id: "tool-weather",
          sessionId: "agent:main:timeline-test",
          seq: 12,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              toolCallId: "call-weather",
              args: { command: 'curl -s "wttr.in/Guangzhou?lang=zh"' },
            },
          },
          createdAt: "2026-06-10T08:22:02.000Z",
        },
      ],
    });

    const { container } = render(
      <OpenClawTimeline
        message={message}
        items={message.openclawTimelineItems}
        isStreaming
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(container.textContent || "").toContain("先检查广州天气。");
    expect(container.textContent || "").not.toContain("我来查询广州今天的天气情况");
    expect(container.querySelectorAll(".x-assistant-bubble")).toHaveLength(1);
  });

  it("allows the first answer block to render immediately when it is the first event after the turn boundary", () => {
    const { container } = render(
      <OpenClawTimeline
        message={{ ...baseMessage, _openclawTurnStartSeq: 20 } as Message}
        items={[
          {
            key: "answer-first-after-boundary",
            mergeKey: "answer-first-after-boundary",
            type: "answer",
            seq: 21,
            content: "这是当前轮次的首个正文块",
          },
        ]}
        isStreaming
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(container.querySelectorAll(".x-assistant-bubble")).toHaveLength(1);
  });

  it("reveals the active streaming answer gradually instead of mounting the whole paragraph at once", () => {
    vi.useFakeTimers();
    try {
      const streamingContent = "这是一个较长的实时正文段落，用于验证前端显示缓冲会逐步补齐完整内容。";
      const { container } = render(
        <OpenClawTimeline
          message={{ ...baseMessage, _openclawTurnStartSeq: 20 } as Message}
          items={[
            {
              key: "answer-gradual",
              mergeKey: "answer-gradual",
              type: "answer",
              seq: 21,
              content: streamingContent,
            },
          ]}
          isStreaming
          agentInfo={{ name: "OpenClaw" }}
        />
      );

      expect(container.textContent || "").not.toContain(streamingContent);

      for (let index = 0; index < 10; index += 1) {
        act(() => {
          vi.advanceTimersByTime(28);
        });
      }

      expect(container.textContent || "").toContain(streamingContent);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps trace steps expanded while streaming", () => {
    render(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "thinking-streaming",
            mergeKey: "thinking-streaming",
            type: "thinking",
            seq: 2,
            title: "正在深度思考",
            content: "流式思考过程。\n继续观察工具选择。\n补充执行计划。\n等待下一步结果。\n第五行继续补充。\n第六行让它保持可折叠状态。",
          },
          {
            key: "tool-streaming",
            mergeKey: "tool-streaming",
            type: "tool_call",
            seq: 3,
            title: "Used Read",
            tool: {
              name: "read",
              displayName: "Read",
              input: "README.md",
            },
          },
        ]}
        isStreaming
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(screen.getByTestId("openclaw-trace-group-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("openclaw-trace-group-body")).toBeInTheDocument();
    expect(screen.getByTestId("openclaw-thinking-card")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText((content) => content.includes("流式思考过程。"))).toBeInTheDocument();
  });

  it("omits zero-count trace summary labels", () => {
    render(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "tool-only",
            mergeKey: "tool-only",
            type: "tool_call",
            seq: 2,
            title: "Used Read",
            tool: {
              name: "read",
              displayName: "Read",
              input: "README.md",
            },
          },
        ]}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(screen.getByTestId("openclaw-trace-group-toggle")).toHaveTextContent("1 个工具步骤");
    expect(screen.getByTestId("openclaw-trace-group-toggle")).not.toHaveTextContent("0 个思考");
  });

  it("does not render the trace group when there are no thinking or tool items", () => {
    render(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "answer-only",
            mergeKey: "answer-only",
            type: "answer",
            seq: 2,
            content: "这里只有正文。",
          },
        ]}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(screen.queryByTestId("openclaw-trace-group")).not.toBeInTheDocument();
    expect(screen.getByText("这里只有正文。")).toBeInTheDocument();
  });

  it("remembers the trace group expanded state during the same component lifecycle", () => {
    const items: OpenClawTimelineItem[] = [
      {
        key: "thinking-remembered",
        mergeKey: "thinking-remembered",
        type: "thinking",
        seq: 2,
        title: "已完成深度思考",
        content: "需要在同一页面生命周期内保留展开状态。",
      },
    ];

    const { rerender } = render(
      <OpenClawTimeline
        message={baseMessage}
        items={items}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(screen.getByTestId("openclaw-trace-group-toggle")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByTestId("openclaw-trace-group-toggle"));
    expect(screen.getByTestId("openclaw-trace-group-toggle")).toHaveAttribute("aria-expanded", "true");

    rerender(
      <OpenClawTimeline
        message={{ ...baseMessage }}
        items={[...items]}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    expect(screen.getByTestId("openclaw-trace-group-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("需要在同一页面生命周期内保留展开状态。")).toBeInTheDocument();
  });

  it("routes trace and thinking toggles through scroll preservation", () => {
    const preserveScrollDuringToggle = vi.fn((callback: () => void) => callback());

    render(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "thinking-preserve",
            mergeKey: "thinking-preserve",
            type: "thinking",
            seq: 2,
            title: "已完成深度思考",
            content: "展开时不应该主动跳转。\n第二行需要保留。\n第三行继续补充。\n第四行继续补充。\n第五行继续补充。\n第六行让它进入可折叠预览。",
          },
        ]}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
        preserveScrollDuringToggle={preserveScrollDuringToggle}
      />
    );

    fireEvent.click(screen.getByTestId("openclaw-trace-group-toggle"));
    expect(preserveScrollDuringToggle).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("openclaw-thinking-card"));
    expect(preserveScrollDuringToggle).toHaveBeenCalledTimes(2);
  });

  it("keeps short completed thinking fully expanded without a faded preview", () => {
    render(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "thinking-short",
            mergeKey: "thinking-short",
            type: "thinking",
            seq: 2,
            title: "已完成深度思考",
            content: "第一行思考。\n第二行思考。\n第三行思考。\n第四行思考。\n第五行思考。",
          },
        ]}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    fireEvent.click(screen.getByTestId("openclaw-trace-group-toggle"));

    const thinkingCard = screen.getByTestId("openclaw-thinking-card");
    expect(thinkingCard).not.toHaveAttribute("role", "button");
    expect(thinkingCard).not.toHaveAttribute("aria-expanded");
    expect(screen.getByTestId("openclaw-thinking-content")).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(screen.getByTestId("openclaw-thinking-content")).not.toHaveClass("max-h-24");
    expect(screen.queryByTestId("openclaw-thinking-fade")).not.toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("第五行思考。"))).toBeInTheDocument();
  });

  it("collapses completed thinking into a faded preview without affecting tool panels", () => {
    const longThinking = Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行思考`).join("\n");

    const { container } = render(
      <OpenClawTimeline
        message={baseMessage}
        items={[
          {
            key: "thinking-long",
            mergeKey: "thinking-long",
            type: "thinking",
            seq: 2,
            title: "已完成深度思考",
            content: longThinking,
          },
          {
            key: "tool-output",
            mergeKey: "tool-output",
            type: "tool_result",
            seq: 3,
            title: "Tool output",
            tool: {
              name: "exec",
              displayName: "Exec",
              output: "普通工具输出",
            },
          },
        ]}
        isStreaming={false}
        agentInfo={{ name: "OpenClaw" }}
      />
    );

    fireEvent.click(screen.getByTestId("openclaw-trace-group-toggle"));

    const thinkingCard = screen.getByTestId("openclaw-thinking-card");
    expect(thinkingCard).toHaveAttribute("aria-expanded", "false");

    const thinkingContent = screen.getByTestId("openclaw-thinking-content");
    expect(thinkingContent).toHaveClass("max-h-24", "overflow-hidden");
    expect(screen.getByTestId("openclaw-thinking-fade")).toBeInTheDocument();

    fireEvent.click(thinkingCard);

    expect(screen.getByTestId("openclaw-thinking-card")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("openclaw-thinking-content")).not.toHaveClass("max-h-24");
    expect(screen.getByTestId("openclaw-thinking-content")).not.toHaveClass("overflow-y-auto");
    expect(screen.queryByTestId("openclaw-thinking-fade")).not.toBeInTheDocument();

    const toolOutputPre = container.querySelector("pre");
    expect(toolOutputPre).toHaveClass("max-h-56", "overflow-auto");
  });
});
