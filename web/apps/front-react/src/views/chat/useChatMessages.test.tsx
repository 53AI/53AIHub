import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { processStreamDataItem, useChatMessages } from "@km/shared-business/chat";

function makeMessage(id: string, question: string) {
  return {
    id,
    message: JSON.stringify([{ role: "user", content: question }]),
    answer: `answer-${id}`,
    process_records: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useChatMessages loading states", () => {
  it("uses isLoadingMessages for full conversation loads without toggling isLoadingMore", async () => {
    const pending = deferred<any>();
    const loadMessagesApi = vi.fn().mockReturnValue(pending.promise);
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    let loadPromise!: Promise<any>;
    act(() => {
      loadPromise = result.current.loadMessageList("conversation-a", loadMessagesApi);
    });

    expect(result.current.state.isLoadingMessages).toBe(true);
    expect(result.current.state.isLoadingMore).toBe(false);

    await act(async () => {
      pending.resolve({ data: { messages: [makeMessage("a", "hello")] } });
      await loadPromise;
    });

    expect(result.current.state.isLoadingMessages).toBe(false);
    expect(result.current.state.isLoadingMore).toBe(false);
    expect(result.current.state.messageList).toHaveLength(1);
    expect(result.current.state.messageList[0].question).toBe("hello");
  });

  it("ignores stale full conversation load responses after a newer load starts", async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    const loadMessagesApi = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    let firstPromise!: Promise<any>;
    let secondPromise!: Promise<any>;
    act(() => {
      firstPromise = result.current.loadMessageList("conversation-a", loadMessagesApi);
      secondPromise = result.current.loadMessageList("conversation-b", loadMessagesApi);
    });

    await act(async () => {
      second.resolve({ data: { messages: [makeMessage("b", "new conversation")] } });
      await secondPromise;
    });

    expect(result.current.state.messageList.map((item) => item.id)).toEqual(["b"]);

    await act(async () => {
      first.resolve({ data: { messages: [makeMessage("a", "old conversation")] } });
      await firstPromise;
    });

    expect(result.current.state.messageList.map((item) => item.id)).toEqual(["b"]);
  });

  it("keeps older-message pagination on isLoadingMore without toggling isLoadingMessages", async () => {
    const pending = deferred<any>();
    const loadMessagesApi = vi.fn().mockReturnValue(pending.promise);
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));
    const done = vi.fn();

    act(() => {
      void result.current.handleLoadListMore(done, "conversation-a", loadMessagesApi);
    });

    expect(result.current.state.isLoadingMore).toBe(true);
    expect(result.current.state.isLoadingMessages).toBe(false);

    await act(async () => {
      pending.resolve({ data: { messages: [makeMessage("older", "older question")] } });
    });

    expect(done).toHaveBeenCalledTimes(1);
    expect(result.current.state.isLoadingMore).toBe(false);
    expect(result.current.state.isLoadingMessages).toBe(false);
    expect(result.current.state.messageList.map((item) => item.id)).toEqual(["older"]);
  });

  it("restores output files from historical output_files process records", async () => {
    const loadMessagesApi = vi.fn().mockResolvedValue({
      data: {
        messages: [
          {
            id: "with-files",
            message: JSON.stringify([{ role: "user", content: "生成文件" }]),
            answer: "done",
            process_records: [
              {
                step_code: "output_files",
                status: "completed",
                data: JSON.stringify({
                  files: [
                    {
                      id: "file-1",
                      file_name: "report.md",
                      url: "https://example.com/report.md",
                      mime_type: "text/markdown",
                      size: 128,
                    },
                  ],
                  media_attachments: [
                    {
                      id: "file-1",
                      file_name: "report.md",
                      url: "https://example.com/report.md",
                      mime_type: "text/markdown",
                      size: 128,
                      kind: "text",
                    },
                  ],
                }),
              },
            ],
          },
        ],
      },
    });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    await act(async () => {
      await result.current.loadMessageList("conversation-a", loadMessagesApi);
    });

    expect(result.current.state.messageList[0].outputFiles).toEqual([
      {
        id: "file-1",
        file_name: "report.md",
        url: "https://example.com/report.md",
        mime_type: "text/markdown",
        size: 128,
        kind: "text",
        message_id: undefined,
      },
    ]);
  });

  it("merges output files from realtime process.step chunks without duplicates", () => {
    const message: any = {
      id: "streaming",
      answer: "",
      outputFiles: [],
      process_records: [],
      reasoning_content: "",
    };

    processStreamDataItem(
      {
        object: "process.step",
        process_step: {
          step_code: "output_files",
          status: "completed",
          message: "生成了 1 个文件",
          data: {
            files: [
              {
                id: "file-1",
                file_name: "report.md",
                url: "https://example.com/report.md",
                mime_type: "text/markdown",
              },
            ],
            media_attachments: [
              {
                id: "file-1",
                file_name: "report.md",
                url: "https://example.com/report.md",
                mime_type: "text/markdown",
                kind: "text",
              },
            ],
          },
        },
      },
      message,
      () => ({})
    );

    expect(message.outputFiles).toEqual([
      {
        id: "file-1",
        file_name: "report.md",
        url: "https://example.com/report.md",
        mime_type: "text/markdown",
        size: undefined,
        kind: "text",
        message_id: undefined,
      },
    ]);
  });
});
