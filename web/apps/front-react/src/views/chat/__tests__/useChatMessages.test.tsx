import { act, renderHook, waitFor } from "@testing-library/react";
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

function makeOpenClawProjectedMessage(
  id: string,
  question: string,
  answer: string,
  outputFiles: any[],
  timestamp: number
) {
  return {
    id,
    conversation_id: "agent:main:dashboard:duplicate-file4",
    message: JSON.stringify([{ role: "user", content: question }]),
    answer,
    process_records: [],
    openclawProjection: {
      visibleAnswer: answer,
      outputFiles,
      timelineItems: [
        { type: "answer", content: answer },
        ...(outputFiles.length ? [{ type: "output_files", files: outputFiles }] : []),
      ],
      isStreaming: false,
    },
    openclawTimelineItems: [
      { type: "answer", content: answer },
      ...(outputFiles.length ? [{ type: "output_files", files: outputFiles }] : []),
    ],
    openclawTurn: {
      sessionId: "agent:main:dashboard:duplicate-file4",
      turnKey: `${id}:turn`,
      status: "completed",
      events: [{ kind: "run.completed" }],
    },
    created_time: timestamp,
    updated_time: timestamp,
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
    let idsAtDone: Array<string | number> = [];
    const done = vi.fn(() => {
      idsAtDone = result.current.state.messageList.map((item) => item.id);
    });

    act(() => {
      void result.current.handleLoadListMore(done, "conversation-a", loadMessagesApi);
    });

    expect(result.current.state.isLoadingMore).toBe(true);
    expect(result.current.state.isLoadingMessages).toBe(false);

    await act(async () => {
      pending.resolve({ data: { messages: [makeMessage("older", "older question")] } });
    });

    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(result.current.state.isLoadingMore).toBe(false);
    expect(result.current.state.isLoadingMessages).toBe(false);
    expect(result.current.state.messageList.map((item) => item.id)).toEqual(["older"]);
    expect(idsAtDone).toEqual(["older"]);
  });

  it("deduplicates concurrent load-more requests for the same conversation offset", async () => {
    const pending = deferred<any>();
    const loadMessagesApi = vi.fn().mockReturnValue(pending.promise);
    const donePrimary = vi.fn();
    const doneDuplicate = vi.fn();
    const { result } = renderHook(() => useChatMessages({ limit: 2 }));

    act(() => {
      void result.current.handleLoadListMore(donePrimary, "conversation-a", loadMessagesApi);
      void result.current.handleLoadListMore(doneDuplicate, "conversation-a", loadMessagesApi);
    });

    expect(loadMessagesApi).toHaveBeenCalledTimes(1);
    expect(loadMessagesApi).toHaveBeenCalledWith("conversation-a", { offset: 2, limit: 2 });
    await waitFor(() => expect(doneDuplicate).toHaveBeenCalledTimes(1));
    expect(donePrimary).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({
        data: {
          messages: [makeMessage("older", "older question")],
          pagination: { limit: 2, offset: 2, hasMore: false, nextOffset: 3 },
        },
      });
    });

    await waitFor(() => expect(donePrimary).toHaveBeenCalledTimes(1));
    expect(result.current.state.messageList.map((item) => item.id)).toEqual(["older"]);
    expect(result.current.state.offset).toBe(3);
  });

  it("does not prepend duplicated current-page messages when loading older messages", async () => {
    const loadMessagesApi = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          messages: [
            makeMessage("current-1", "current question 1"),
            makeMessage("current-2", "current question 2"),
          ],
          pagination: { limit: 2, offset: 0, hasMore: true, nextOffset: 2 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          messages: [
            makeMessage("current-1", "current question 1"),
            makeMessage("current-2", "current question 2"),
          ],
          pagination: { limit: 2, offset: 2, hasMore: true, nextOffset: 4 },
        },
      });
    const done = vi.fn();
    const { result } = renderHook(() => useChatMessages({ limit: 2 }));

    await act(async () => {
      await result.current.loadMessageList("conversation-a", loadMessagesApi);
    });

    await act(async () => {
      await result.current.handleLoadListMore(done, "conversation-a", loadMessagesApi);
    });

    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(result.current.state.messageList.map((item) => item.id)).toEqual(["current-1", "current-2"]);
    expect(result.current.state.hasMore).toBe(false);
    expect(result.current.state.offset).toBe(4);
  });

  it("collapses duplicate OpenClaw intermediate rows across load-more pagination", async () => {
    const file4 = { id: "artifact-file4", file_name: "file4.txt", preview_url: "/api/preview/file4" };
    const file4Chars = { id: "artifact-4chars", file_name: "4chars.txt", preview_url: "/api/preview/4chars" };
    const question = "创建一个长度为4个字符的文件";
    const loadMessagesApi = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          messages: [
            makeOpenClawProjectedMessage(
              "agent:main:dashboard:duplicate-file4:assistant:324",
              question,
              "✅ 任务完成！我已经成功创建了另一个正好4个字符长度的文件。\n\n文件名：`file4.txt`",
              [file4],
              Date.parse("2026-06-24T07:19:32.000Z")
            ),
          ],
          pagination: { limit: 2, offset: 0, hasMore: true, nextOffset: 1 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          messages: [
            makeOpenClawProjectedMessage(
              "agent:main:dashboard:duplicate-file4:assistant:314",
              question,
              "✅ 任务完成！我已经成功创建了一个正好4个字符长度的文件。\n\n文件名：`4chars.txt`",
              [file4Chars],
              Date.parse("2026-06-24T07:18:08.000Z")
            ),
            makeOpenClawProjectedMessage(
              "agent:main:dashboard:duplicate-file4:assistant:318",
              question,
              "让我验证文件内容并更新输出产物清单。",
              [file4],
              Date.parse("2026-06-24T07:19:08.000Z")
            ),
          ],
          pagination: { limit: 2, offset: 1, hasMore: false, nextOffset: 3 },
        },
      });
    const done = vi.fn();
    const { result } = renderHook(() => useChatMessages({ limit: 2 }));

    await act(async () => {
      await result.current.loadMessageList("agent:main:dashboard:duplicate-file4", loadMessagesApi);
    });

    await act(async () => {
      await result.current.handleLoadListMore(done, "agent:main:dashboard:duplicate-file4", loadMessagesApi);
    });

    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(result.current.state.messageList.map((item) => item.id)).toEqual([
      "agent:main:dashboard:duplicate-file4:assistant:314",
      "agent:main:dashboard:duplicate-file4:assistant:324",
    ]);
    expect(result.current.state.messageList.map((item) => item.answer)).not.toContain("让我验证文件内容并更新输出产物清单。");
    expect((result.current.state.messageList[1] as any).openclawProjection.outputFiles).toEqual([
      expect.objectContaining({ file_name: "file4.txt" }),
    ]);
  });

  it("merges a rebased optimistic OpenClaw first turn with fresh history replay", async () => {
    const conversationId = "agent:main:dashboard:first-turn";
    const question = "开始对话";
    const createdTime = Date.parse("2026-06-25T01:20:00.000Z");
    const loadMessagesApi = vi.fn().mockResolvedValue({
      data: {
        messages: [
          {
            id: `${conversationId}:assistant:2`,
            conversation_id: conversationId,
            message: JSON.stringify([{ role: "user", content: question }]),
            question,
            answer: "你好！我是 QClaw 👋",
            process_records: [],
            openclawProjection: {
              visibleAnswer: "你好！我是 QClaw 👋",
              timelineItems: [{ type: "answer", content: "你好！我是 QClaw 👋" }],
              outputFiles: [],
              isStreaming: false,
            },
            openclawTimelineItems: [{ type: "answer", content: "你好！我是 QClaw 👋" }],
            openclawTurn: {
              sessionId: conversationId,
              turnKey: `${conversationId}:assistant:2:1`,
              status: "completed",
              events: [{ kind: "run.completed" }],
            },
            created_time: createdTime + 1000,
            updated_time: createdTime + 2000,
          },
        ],
        pagination: { hasMore: false },
      },
    });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    act(() => {
      result.current.updateMessageList(() => [
        {
          id: "optimistic-first-turn",
          conversation_id: conversationId,
          question,
          answer: "你好！我是 QClaw 👋",
          loading: false,
          _openclawClientMessageId: "optimistic-first-turn",
          openclawProjection: {
            visibleAnswer: "你好！我是 QClaw 👋",
            timelineItems: [{ type: "answer", content: "你好！我是 QClaw 👋" }],
            outputFiles: [],
            isStreaming: false,
          },
          openclawTimelineItems: [{ type: "answer", content: "你好！我是 QClaw 👋" }],
          openclawTurn: {
            sessionId: conversationId,
            turnKey: `${conversationId}:optimistic-first-turn:0`,
            status: "completed",
            events: [{ kind: "run.completed" }],
          },
          created_time: createdTime,
          updated_time: createdTime + 500,
        } as any,
      ]);
    });

    await act(async () => {
      await result.current.loadMessageList(conversationId, loadMessagesApi, { silent: true });
    });

    expect(result.current.state.messageList).toHaveLength(1);
    expect(result.current.state.messageList[0]).toEqual(
      expect.objectContaining({
        id: `${conversationId}:assistant:2`,
        conversation_id: conversationId,
        question,
        answer: "你好！我是 QClaw 👋",
        _openclawClientMessageId: "optimistic-first-turn",
      })
    );
  });

  it("preserves uploaded files that were already projected on historical messages", async () => {
    const loadMessagesApi = vi.fn().mockResolvedValue({
      data: {
        messages: [
          {
            id: "with-upload",
            message: JSON.stringify([{ role: "user", content: "这个文件是什么" }]),
            answer: "这是一个 PDF。",
            uploaded_files: [
              {
                id: "artifact-1",
                name: "1.pdf",
                file_name: "1.pdf",
                file_path: "/Users/test/.qclaw/input-files/1.pdf",
                url: "http://localhost:9001/api/preview/1.pdf",
                preview_url: "http://localhost:9001/api/preview/1.pdf",
                mime_type: "application/pdf",
              },
            ],
            process_records: [],
          },
        ],
      },
    });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    await act(async () => {
      await result.current.loadMessageList("conversation-a", loadMessagesApi);
    });

    expect(result.current.state.messageList[0].uploaded_files).toHaveLength(1);
    expect(result.current.state.messageList[0].uploaded_files?.[0]).toMatchObject({
      id: "artifact-1",
      name: "1.pdf",
      file_name: "1.pdf",
      file_path: "/Users/test/.qclaw/input-files/1.pdf",
      url: "http://localhost:9001/api/preview/1.pdf",
      file_mime: "application/pdf",
    });
  });

  it("preserves OpenClaw output files during silent fresh merges when the incoming projection is incomplete", async () => {
    const outputFile = {
      id: "artifact-output-1",
      file_name: "result.txt",
      mime_type: "text/plain",
      size: 10,
    };
    const loadMessagesApi = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          messages: [
            {
              id: "openclaw-row",
              conversation_id: "agent:main:main",
              message: JSON.stringify([{ role: "user", content: "创建文件" }]),
              answer: "已创建文件",
              openclawTimelineItems: [{ type: "output_files", files: [outputFile] }],
              openclawTurn: { turnKey: "agent:main:main:turn:req-1", events: [{ kind: "process.step" }] },
              process_records: [
                {
                  step_code: "output_files",
                  status: "completed",
                  data: { files: [outputFile] },
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          messages: [
            {
              id: "openclaw-row",
              conversation_id: "agent:main:main",
              message: JSON.stringify([{ role: "user", content: "创建文件" }]),
              answer: "已创建文件",
              outputFiles: [],
              openclawTimelineItems: [],
              openclawTurn: { turnKey: "agent:main:main:turn:req-1", events: [] },
              process_records: [],
            },
          ],
          source: "openclaw",
          stale: false,
        },
      });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    await act(async () => {
      await result.current.loadMessageList("agent:main:main", loadMessagesApi);
      await result.current.loadMessageList("agent:main:main", loadMessagesApi, { silent: true });
    });

    expect(result.current.state.messageList[0].outputFiles).toHaveLength(1);
    expect(result.current.state.messageList[0].outputFiles?.[0]).toMatchObject(outputFile);
    expect((result.current.state.messageList[0] as any).openclawTimelineItems).toHaveLength(1);
    expect((result.current.state.messageList[0] as any).openclawTurn.events).toHaveLength(1);
    expect(result.current.state.messageList[0].process_records).toHaveLength(1);
  });

  it("preserves live OpenClaw content when a non-silent stale mirror reload is weaker", async () => {
    const outputFile = {
      id: "artifact-output-1",
      file_name: "5chars.txt",
      mime_type: "text/plain",
      size: 5,
    };
    const loadMessagesApi = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          source: "openclaw",
          stale: false,
          messages: [
            {
              id: "agent:main:main:assistant:284",
              conversation_id: "agent:main:main",
              message: JSON.stringify([{ role: "user", content: "创建一个长度为5个字符的文件" }]),
              answer: "我已经成功创建了一个正好5个字符长度的文件。",
              outputFiles: [outputFile],
              openclawTimelineItems: [{ type: "output_files", files: [outputFile] }],
              openclawTurn: { sessionId: "agent:main:main", turnKey: "agent:main:main:turn:req-1", events: [{ kind: "process.step" }] },
              process_records: [
                {
                  step_code: "output_files",
                  status: "completed",
                  data: { files: [outputFile] },
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          source: "mirror",
          stale: true,
          messages: [
            {
              id: "agent:main:main:assistant:284",
              conversation_id: "agent:main:main",
              message: JSON.stringify([{ role: "user", content: "创建一个长度为5个字符的文件" }]),
              answer: "HEARTBEAT_OK",
              outputFiles: [],
              openclawTimelineItems: [],
              openclawTurn: { sessionId: "agent:main:main", turnKey: "agent:main:main:turn:req-1", events: [] },
              process_records: [],
            },
          ],
        },
      });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    await act(async () => {
      await result.current.loadMessageList("agent:main:main", loadMessagesApi);
      await result.current.loadMessageList("agent:main:main", loadMessagesApi);
    });

    expect(result.current.state.messageList[0].answer).toBe("我已经成功创建了一个正好5个字符长度的文件。");
    expect(result.current.state.messageList[0].outputFiles).toHaveLength(1);
    expect((result.current.state.messageList[0] as any).openclawTimelineItems).toHaveLength(1);
    expect((result.current.state.messageList[0] as any).openclawTurn.events).toHaveLength(1);
    expect(result.current.state.messageList[0].process_records).toHaveLength(1);
  });

  it("closes stale OpenClaw loading when a silent fresh history load returns the completed answer", async () => {
    const sessionId = "agent:main:main";
    const turnId = `${sessionId}:turn:req-books`;
    const loadMessagesApi = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          source: "mirror",
          stale: true,
          messages: [
            {
              id: `${sessionId}:assistant:338`,
              conversation_id: sessionId,
              message: JSON.stringify([{ role: "user", content: "从网上搜索10本书并总结" }]),
              answer: "",
              loading: true,
              openclawProjection: {
                visibleAnswer: "",
                timelineItems: [{ type: "thinking", key: "thinking-only" }],
                outputFiles: [],
                activities: [{ key: "thinking-only" }],
                isStreaming: true,
              },
              openclawTurn: {
                sessionId,
                turnKey: turnId,
                status: "streaming",
                events: [{ kind: "assistant.thinking", seq: 338 }],
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          source: "openclaw",
          stale: false,
          messages: [
            {
              id: `${sessionId}:assistant:338`,
              conversation_id: sessionId,
              message: JSON.stringify([{ role: "user", content: "从网上搜索10本书并总结" }]),
              answer: "我已经成功从网上搜索并整理了10本书的总结。",
              openclawProjection: {
                visibleAnswer: "我已经成功从网上搜索并整理了10本书的总结。",
                timelineItems: [{ type: "answer", key: "answer-final", content: "我已经成功从网上搜索并整理了10本书的总结。" }],
                outputFiles: [],
                activities: [],
                isStreaming: false,
              },
              openclawTurn: {
                sessionId,
                turnKey: turnId,
                status: "completed",
                events: [{ kind: "run.completed", seq: 360 }],
              },
            },
          ],
        },
      });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    await act(async () => {
      await result.current.loadMessageList(sessionId, loadMessagesApi);
      await result.current.loadMessageList(sessionId, loadMessagesApi, { silent: true });
    });

    const message = result.current.state.messageList[0] as any;
    expect(message.loading).toBe(false);
    expect(message.answer).toBe("我已经成功从网上搜索并整理了10本书的总结。");
    expect(message.openclawTurn.status).toBe("completed");
  });

  it("preserves stronger OpenClaw projection when a later history load has fewer turn events", async () => {
    const outputFile = {
      id: "artifact-output-2",
      file_name: "2chars.txt",
      mime_type: "text/plain",
      size: 2,
    };
    const fullTimelineItems = Array.from({ length: 16 }, (_, index) => ({ type: index === 15 ? "output_files" : "tool_call", key: `item-${index}` }));
    const fullEvents = Array.from({ length: 16 }, (_, index) => ({ kind: index === 15 ? "output_files" : "process.step", seq: index + 1 }));
    const loadMessagesApi = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          source: "openclaw",
          stale: false,
          messages: [
            {
              id: "agent:main:main:assistant:304",
              conversation_id: "agent:main:main",
              message: JSON.stringify([{ role: "user", content: "创建一个长度为2个字符的文件" }]),
              answer: "我已经成功创建了一个正好2个字符长度的文件。",
              outputFiles: [outputFile],
              openclawProjection: {
                visibleAnswer: "我已经成功创建了一个正好2个字符长度的文件。",
                timelineItems: fullTimelineItems,
                outputFiles: [outputFile],
                activities: fullTimelineItems,
              },
              openclawTimelineItems: fullTimelineItems,
              openclawActivities: fullTimelineItems,
              openclawTurn: { sessionId: "agent:main:main", turnKey: "agent:main:main:turn:req-2", events: fullEvents },
              process_records: [
                {
                  step_code: "output_files",
                  status: "completed",
                  data: { files: [outputFile] },
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          source: "openclaw",
          stale: false,
          messages: [
            {
              id: "agent:main:main:assistant:304",
              conversation_id: "agent:main:main",
              message: JSON.stringify([{ role: "user", content: "创建一个长度为2个字符的文件" }]),
              answer: "",
              outputFiles: [],
              openclawProjection: {
                visibleAnswer: "",
                timelineItems: [],
                outputFiles: [],
                activities: [],
              },
              openclawTimelineItems: [],
              openclawActivities: [],
              openclawTurn: {
                sessionId: "agent:main:main",
                turnKey: "agent:main:main:turn:req-2",
                events: [{ kind: "assistant.message" }, { kind: "run.completed" }],
              },
              process_records: [],
            },
          ],
        },
      });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    await act(async () => {
      await result.current.loadMessageList("agent:main:main", loadMessagesApi);
      await result.current.loadMessageList("agent:main:main", loadMessagesApi);
    });

    const message = result.current.state.messageList[0] as any;
    expect(message.answer).toBe("我已经成功创建了一个正好2个字符长度的文件。");
    expect(message.outputFiles).toHaveLength(1);
    expect(message.openclawProjection.outputFiles).toHaveLength(1);
    expect(message.openclawProjection.timelineItems).toHaveLength(16);
    expect(message.openclawTimelineItems).toHaveLength(16);
    expect(message.openclawActivities).toHaveLength(16);
    expect(message.openclawTurn.events).toHaveLength(16);
    expect(message.process_records).toHaveLength(1);
  });

  it("attaches OpenClaw mirror message freshness metadata to loaded message arrays", async () => {
    const loadMessagesApi = vi.fn().mockResolvedValue({
      data: {
        messages: [makeMessage("mirror-row", "缓存消息")],
        source: "mirror",
        stale: true,
        last_seq: 12,
        messages_last_seq: 12,
        mirror_last_seq: 100,
        refresh_recommended: true,
      },
    });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    let loaded: any[] = [];
    await act(async () => {
      loaded = await result.current.loadMessageList("agent:main:main", loadMessagesApi);
    });

    expect((loaded as any).openclawHistoryMeta).toMatchObject({
      source: "mirror",
      stale: true,
      last_seq: 12,
      messages_last_seq: 12,
      mirror_last_seq: 100,
      refresh_recommended: true,
    });
  });

  it("preserves OpenClaw skill metadata that was already projected on historical messages", async () => {
    const loadMessagesApi = vi.fn().mockResolvedValue({
      data: {
        messages: [
          {
            id: "with-skill",
            message: JSON.stringify([{ role: "user", content: "测试技能效果" }]),
            answer: "技能测试完成。",
            skill: {
              skill_name: "openclaw_pdf_probe",
              display_name: "PDF Probe",
            },
            process_records: [],
          },
        ],
      },
    });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    await act(async () => {
      await result.current.loadMessageList("conversation-a", loadMessagesApi);
    });

    expect(result.current.state.messageList[0].question).toBe("测试技能效果");
    expect(result.current.state.messageList[0].skill).toMatchObject({
      skill_name: "openclaw_pdf_probe",
      display_name: "PDF Probe",
    });
  });

  it("merges silent OpenClaw background refreshes without clearing existing messages", async () => {
    const loadMessagesApi = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          source: "mirror",
          stale: true,
          messages: [
            {
              id: "row-1",
              message: JSON.stringify([{ role: "user", content: "缓存问题" }]),
              answer: "缓存回答",
              process_records: [],
            },
            {
              id: "row-2",
              message: JSON.stringify([{ role: "user", content: "第二个问题" }]),
              answer: "第二个回答",
              process_records: [],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          source: "openclaw",
          stale: false,
          messages: [
            {
              id: "row-2",
              message: JSON.stringify([{ role: "user", content: "第二个问题" }]),
              answer: "第二个回答（已校验）",
              process_records: [],
            },
            {
              id: "row-3",
              message: JSON.stringify([{ role: "user", content: "新问题" }]),
              answer: "新回答",
              process_records: [],
            },
          ],
        },
      });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    let initial!: any[];
    await act(async () => {
      initial = await result.current.loadMessageList("conversation-a", loadMessagesApi);
    });

    expect((initial as any).openclawHistoryMeta).toMatchObject({ source: "mirror", stale: true });
    const firstRowRef = result.current.state.messageList[0];

    let refreshed!: any[];
    await act(async () => {
      refreshed = await result.current.loadMessageList("conversation-a", loadMessagesApi, { silent: true });
    });

    expect((refreshed as any).openclawHistoryMeta).toMatchObject({ source: "openclaw", stale: false });
    expect(result.current.state.messageList.map((item) => item.id)).toEqual(["row-1", "row-2", "row-3"]);
    expect(result.current.state.messageList[0]).toBe(firstRowRef);
    expect(result.current.state.messageList[1].answer).toBe("第二个回答（已校验）");
    expect(result.current.state.isLoadingMessages).toBe(false);
  });

  it("keeps the visible list when a silent background refresh returns no rows", async () => {
    const loadMessagesApi = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          messages: [makeMessage("row-1", "缓存问题")],
        },
      })
      .mockResolvedValueOnce({
        data: {
          source: "openclaw",
          stale: false,
          messages: [],
        },
      });
    const { result } = renderHook(() => useChatMessages({ limit: 20 }));

    await act(async () => {
      await result.current.loadMessageList("conversation-a", loadMessagesApi);
    });
    await act(async () => {
      await result.current.loadMessageList("conversation-a", loadMessagesApi, { silent: true });
    });

    expect(result.current.state.messageList.map((item) => item.id)).toEqual(["row-1"]);
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
                      url: "/api/preview/report.md",
                      preview_key: "report.md",
                      preview_url: "/api/preview/report.md",
                      download_url: "/api/openclaw/agents/2/artifacts/file-1/download",
                      signed_download_url: "https://example.com/report.md?sig=1",
                      mime_type: "text/markdown",
                      size: 128,
                    },
                  ],
                  media_attachments: [
                    {
                      id: "file-1",
                      file_name: "report.md",
                      url: "/api/preview/report.md",
                      preview_key: "report.md",
                      preview_url: "/api/preview/report.md",
                      download_url: "/api/openclaw/agents/2/artifacts/file-1/download",
                      signed_download_url: "https://example.com/report.md?sig=1",
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
        url: "/api/preview/report.md",
        preview_key: "report.md",
        preview_url: "/api/preview/report.md",
        download_url: "/api/openclaw/agents/2/artifacts/file-1/download",
        signed_download_url: "https://example.com/report.md?sig=1",
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
                url: "/api/preview/report.md",
                preview_key: "report.md",
                preview_url: "/api/preview/report.md",
                download_url: "/api/openclaw/agents/2/artifacts/file-1/download",
                signed_download_url: "https://example.com/report.md?sig=1",
                mime_type: "text/markdown",
              },
            ],
            media_attachments: [
              {
                id: "file-1",
                file_name: "report.md",
                url: "/api/preview/report.md",
                preview_key: "report.md",
                preview_url: "/api/preview/report.md",
                download_url: "/api/openclaw/agents/2/artifacts/file-1/download",
                signed_download_url: "https://example.com/report.md?sig=1",
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
        url: "/api/preview/report.md",
        preview_key: "report.md",
        preview_url: "/api/preview/report.md",
        download_url: "/api/openclaw/agents/2/artifacts/file-1/download",
        signed_download_url: "https://example.com/report.md?sig=1",
        mime_type: "text/markdown",
        size: undefined,
        kind: "text",
        message_id: undefined,
      },
    ]);
  });

  it("projects wrapped OpenClaw process.step output files during realtime streaming", () => {
    const message: any = {
      id: "streaming-openclaw",
      conversation_id: "agent:main:dashboard:files",
      answer: "",
      outputFiles: [],
      process_records: [],
      reasoning_content: "",
      openclawTurn: {
        sessionId: "agent:main:dashboard:files",
        turnKey: "agent:main:dashboard:files:turn:req-files",
        status: "streaming",
        events: [],
      },
    };

    processStreamDataItem(
      {
        req_id: "req-files",
        action: "chat",
        status: "streaming",
        data: {
          id: "req-files-output-files",
          object: "process.step",
          status: "streaming",
          session_id: "agent:main:dashboard:files",
          process_step: {
            step_code: "output_files",
            status: "completed",
            message: "生成了 1 个文件",
            timestamp: 1782300000,
            data: {
              files: [
                {
                  id: "artifact-final",
                  file_name: "final.txt",
                  preview_url: "/api/preview/final.txt",
                  download_url: "/api/openclaw/agents/2/artifacts/artifact-final/download",
                  mime_type: "text/plain",
                  size: 12,
                },
              ],
              openclaw_timeline: {
                segment_type: "output_files",
                segment_id: "agent:main:dashboard:files:turn:req-files:output_files:final.txt",
                turn_id: "agent:main:dashboard:files:turn:req-files",
                active_request_id: "req-files",
              },
              openclaw_ledger: {
                protocol_version: "openclaw.ledger.v1",
                event_type: "part.replace",
                part_type: "output_file",
                turn_id: "agent:main:dashboard:files:turn:req-files",
                active_request_id: "req-files",
              },
            },
          },
        },
      },
      message,
      () => ({}),
      { openclaw: true }
    );

    expect(message.outputFiles).toEqual([
      expect.objectContaining({
        id: "artifact-final",
        file_name: "final.txt",
        preview_url: "/api/preview/final.txt",
      }),
    ]);
    expect(message.process_records).toHaveLength(1);
    expect(message.openclawTimelineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_files",
          files: expect.arrayContaining([
            expect.objectContaining({ file_name: "final.txt" }),
          ]),
        }),
      ])
    );
  });
});
