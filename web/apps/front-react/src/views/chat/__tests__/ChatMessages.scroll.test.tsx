import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scrollToBottom: vi.fn(),
  wrapper: null as HTMLDivElement | null,
  bubbleListProps: null as any,
}));

vi.mock("@km/hub-ui-x-react", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    BubbleList: React.forwardRef((props: any, ref: any) => {
      mocks.bubbleListProps = props;
      React.useImperativeHandle(ref, () => ({
        scrollToBottom: mocks.scrollToBottom,
        getWrapperElement: () => mocks.wrapper,
      }));
      return React.createElement("div", { "data-testid": "bubble-list" }, props.children);
    }),
  };
});

import { ChatMessages, type Message } from "@km/shared-business/chat";

const agentInfo = {
  agent_id: 2,
  name: "OpenClaw",
  logo: "",
  custom_config_obj: {},
  settings_obj: {},
} as any;

function defineScrollPosition(wrapper: HTMLDivElement, scrollTop: number, scrollHeight = 1000, clientHeight = 400) {
  Object.defineProperty(wrapper, "scrollTop", {
    configurable: true,
    writable: true,
    value: scrollTop,
  });
  Object.defineProperty(wrapper, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(wrapper, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
}

function createMessage(id: string): Message {
  return {
    id,
    role: "assistant",
    question: `question ${id}`,
    answer: `answer ${id}`,
  } as Message;
}

describe("ChatMessages auto scroll", () => {
  beforeEach(() => {
    mocks.scrollToBottom.mockReset();
    mocks.wrapper = document.createElement("div");
    mocks.bubbleListProps = null;
    defineScrollPosition(mocks.wrapper, 600);
  });

  it("does not scroll to bottom when a background append arrives while the user is reading older messages", async () => {
    const { rerender } = render(
      <ChatMessages
        openclaw
        messageList={[createMessage("message-1")]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: false } }}
      />
    );

    await waitFor(() => {
      expect(mocks.scrollToBottom).toHaveBeenCalled();
    });

    defineScrollPosition(mocks.wrapper!, 120);
    act(() => {
      mocks.wrapper!.dispatchEvent(new Event("scroll"));
    });
    mocks.scrollToBottom.mockClear();

    rerender(
      <ChatMessages
        openclaw
        messageList={[createMessage("message-1"), createMessage("message-2")]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: false } }}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.bubbleListProps?.autoScroll).toBe(false);
    expect(mocks.scrollToBottom).not.toHaveBeenCalled();
  });

  it("keeps following new messages when the user is already near the bottom", async () => {
    const { rerender } = render(
      <ChatMessages
        openclaw
        messageList={[createMessage("message-1")]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: false } }}
      />
    );

    await waitFor(() => {
      expect(mocks.scrollToBottom).toHaveBeenCalled();
    });

    defineScrollPosition(mocks.wrapper!, 560);
    act(() => {
      mocks.wrapper!.dispatchEvent(new Event("scroll"));
    });
    mocks.scrollToBottom.mockClear();

    rerender(
      <ChatMessages
        openclaw
        messageList={[createMessage("message-1"), createMessage("message-2")]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: false } }}
      />
    );

    await waitFor(() => {
      expect(mocks.bubbleListProps?.autoScroll).toBe(true);
      expect(mocks.scrollToBottom).toHaveBeenCalled();
    });
  });

  it("preserves the visible anchor when older messages are prepended", async () => {
    const { rerender } = render(
      <ChatMessages
        openclaw
        messageList={[createMessage("message-3"), createMessage("message-4")]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: false } }}
      />
    );

    await waitFor(() => {
      expect(mocks.scrollToBottom).toHaveBeenCalled();
    });

    defineScrollPosition(mocks.wrapper!, 120, 1000, 400);
    act(() => {
      mocks.wrapper!.dispatchEvent(new Event("scroll"));
    });
    mocks.scrollToBottom.mockClear();

    defineScrollPosition(mocks.wrapper!, 120, 1400, 400);
    rerender(
      <ChatMessages
        openclaw
        messageList={[createMessage("message-1"), createMessage("message-2"), createMessage("message-3"), createMessage("message-4")]}
        agentInfo={agentInfo}
        isStreaming={false}
        features={{ menu: { copy: false } }}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.wrapper!.scrollTop).toBe(520);
    expect(mocks.scrollToBottom).not.toHaveBeenCalled();
  });
});
