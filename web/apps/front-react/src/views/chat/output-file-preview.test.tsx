import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatMessages, type Message } from "@km/shared-business/chat";

const agentInfo = {
  agent_id: 2,
  name: "OpenClaw",
  logo: "",
  custom_config_obj: {},
  settings_obj: {},
} as any;

describe("output file preview callbacks", () => {
  it("uses an external preview callback for regular assistant output files", () => {
    const onOutputFilePreview = vi.fn();
    const message: Message = {
      id: "assistant-output",
      role: "assistant",
      answer: "文件已生成",
      question: "",
      outputFiles: [
        {
          id: "file-1",
          file_name: "report.txt",
          signed_download_url: "https://example.com/report.txt?sig=1",
        },
      ],
    } as Message;

    render(
      <ChatMessages
        messageList={[message]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ outputFiles: true }}
        onOutputFilePreview={onOutputFilePreview}
      />
    );

    fireEvent.click(screen.getByText("report.txt"));

    expect(onOutputFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: "file-1", file_name: "report.txt" }),
      expect.objectContaining({ id: "assistant-output" })
    );
  });

  it("keeps the internal download fallback when no external preview callback is provided", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const message: Message = {
      id: "assistant-download",
      role: "assistant",
      answer: "文件已生成",
      question: "",
      outputFiles: [
        {
          id: "file-2",
          file_name: "download.txt",
          signed_download_url: "https://example.com/download.txt?sig=1",
        },
      ],
    } as Message;

    render(
      <ChatMessages
        messageList={[message]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ outputFiles: true }}
      />
    );

    fireEvent.click(screen.getByText("download.txt"));

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("uses an external preview callback for OpenClaw timeline output files", () => {
    const onOutputFilePreview = vi.fn();
    const openClawFile = {
      id: "file-3",
      file_name: "openclaw-report.md",
      signed_download_url: "https://example.com/openclaw-report.md?sig=1",
    };
    const openClawTimelineItems = [
      {
        key: "answer-1",
        mergeKey: "answer-1",
        type: "answer",
        seq: 1,
        content: "文件已生成",
      },
      {
        key: "files-1",
        mergeKey: "files-1",
        type: "output_files",
        seq: 2,
        title: "生成了 1 个文件",
        files: [openClawFile],
      },
    ];
    const message: Message = {
      id: "assistant-openclaw-output",
      role: "assistant",
      answer: "",
      question: "",
      openclawProjection: {
        timelineItems: openClawTimelineItems as any,
        visibleAnswer: "文件已生成",
        outputFiles: [openClawFile],
        activities: [],
        interrupted: false,
        failed: false,
        isStreaming: false,
      },
      openclawTimelineItems: openClawTimelineItems as any,
    } as Message;

    render(
      <ChatMessages
        messageList={[message]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ outputFiles: true }}
        openclaw
        onOutputFilePreview={onOutputFilePreview}
      />
    );

    fireEvent.click(screen.getByText("openclaw-report.md"));

    expect(onOutputFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: "file-3", file_name: "openclaw-report.md" }),
      expect.objectContaining({ id: "assistant-openclaw-output" })
    );
  });
});
