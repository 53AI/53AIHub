import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatMessages, type Message } from "@km/shared-business/chat";

const agentInfo = {
  agent_id: 2,
  name: "OpenClaw",
  logo: "",
  custom_config_obj: {},
  settings_obj: {},
} as any;

describe("UserMessage rendering", () => {
  it("renders numeric-looking plain text questions such as 1", () => {
    const message = {
      id: "assistant-numeric-question",
      role: "assistant",
      question: "1",
      answer: "收到",
    } as Message;

    render(
      <ChatMessages
        messageList={[message]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: false } }}
      />
    );

    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("does not render an empty assistant menu for OpenClaw user-only turns", () => {
    const message = {
      id: "agent:main:dashboard:test:user:267",
      role: "assistant",
      question: "1",
      answer: "",
      openclawTimelineItems: [],
      raw_user_message: {
        id: "agent:main:dashboard:test:user:267",
        role: "user",
        content: "1",
      },
    } as any as Message;

    render(
      <ChatMessages
        openclaw
        messageList={[message]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: true, addAsMd: true, regenerate: true } }}
      />
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("添加到")).not.toBeInTheDocument();
  });

  it("ignores blank OpenClaw raw assistant history records when there is no assistant surface", () => {
    const message = {
      id: "agent:main:dashboard:test:user:268",
      role: "assistant",
      question: "write a long list",
      answer: "",
      content: "error",
      openclawTimelineItems: [],
      process_records: [{ step: "legacy-error" }],
      outputFiles: [{ id: "legacy-file", file_name: "legacy.txt" }],
      openclawProjection: {
        timelineItems: [],
        visibleAnswer: "",
        outputFiles: [],
        activities: [],
        interrupted: true,
        failed: false,
        isStreaming: false,
      },
      raw_user_message: {
        id: "agent:main:dashboard:test:user:268",
        role: "user",
        content: "write a long list",
      },
      raw_assistant_message: {
        id: "agent:main:dashboard:test:assistant:269",
        role: "assistant",
        content: "error",
      },
    } as any as Message;

    render(
      <ChatMessages
        openclaw
        messageList={[message]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: true, addAsMd: true, regenerate: true } }}
      />
    );

    expect(screen.getByText("write a long list")).toBeInTheDocument();
    expect(screen.queryByText("添加到")).not.toBeInTheDocument();
  });

  it("ignores legacy OpenClaw timeline-only assistant content without a ledger projection", () => {
    const message = {
      id: "agent:main:dashboard:test:user:270",
      role: "assistant",
      question: "legacy-only question",
      answer: "Legacy raw answer",
      openclawTimelineItems: [
        {
          key: "legacy-answer",
          type: "answer",
          content: "Legacy raw answer",
        },
      ],
      raw_user_message: {
        id: "agent:main:dashboard:test:user:270",
        role: "user",
        content: "legacy-only question",
      },
    } as any as Message;

    render(
      <ChatMessages
        openclaw
        messageList={[message]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: true, addAsMd: true, regenerate: true } }}
      />
    );

    expect(screen.getByText("legacy-only question")).toBeInTheDocument();
    expect(screen.queryByText("Legacy raw answer")).not.toBeInTheDocument();
    expect(screen.queryByText("添加到")).not.toBeInTheDocument();
  });
});
