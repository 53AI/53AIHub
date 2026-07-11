import { describe, expect, it } from "vitest";

import {
  createOpenClawConversationApiAdapter,
  createOpenClawTurnEvent,
  createOpenClawTurnState,
  getOpenClawLedgerEventsFromPayload,
  projectOpenClawTurn,
  type OpenClawLedgerEvent,
} from "@km/shared-business/chat";

function ledger(overrides: Partial<OpenClawLedgerEvent> = {}): OpenClawLedgerEvent {
  const event = {
    protocol_version: "openclaw.ledger.v1",
    seq: 1,
    session_id: "session-1",
    conversation_id: "session-1",
    turn_id: "session-1:turn:req-1",
    active_request_id: "req-1",
    part_id: "session-1:turn:req-1:answer:0",
    part_type: "answer",
    event_type: "part.delta",
    operation: "append",
    visibility: "stream",
    text: "",
    created_at: "2026-06-11T10:00:00.000Z",
    raw_event_ref: "session-1:1:evt-1",
    ...overrides,
  };
  return {
    ...event,
    raw_event_ref: overrides.raw_event_ref || `${event.session_id}:${event.seq}:evt-${event.seq}`,
  };
}

function eventFromLedger(input: OpenClawLedgerEvent) {
  return createOpenClawTurnEvent({
    eventId: input.raw_event_ref || `${input.session_id}:${input.seq}`,
    sessionId: input.session_id,
    seq: input.seq,
    kind: (input.payload?.source_kind as string) || "assistant.delta",
    createdAt: input.created_at,
    payload: {
      content: input.text || "",
      source_kind: input.payload?.source_kind,
      openclaw_ledger: input,
    },
    source: "events",
  });
}

function projectLedgerPayload(payload: any) {
  const events = getOpenClawLedgerEventsFromPayload(payload);
  const turn = createOpenClawTurnState({
    sessionId: "session-1",
    turnKey: "session-1:turn:req-1",
    events: events.map(eventFromLedger),
  });
  return projectOpenClawTurn(turn);
}

describe("OpenClaw ledger reducer projection", () => {
  it("uses recent_events when snapshot ledger_events is an empty after_seq delta", () => {
    const recovered = ledger({
      seq: 12,
      event_type: "part.replace",
      operation: "replace",
      visibility: "final",
      text: "Recovered from snapshot recent events.",
      payload: { source_kind: "assistant.message" },
    });

    const events = getOpenClawLedgerEventsFromPayload({
      ledger_events: [],
      recent_events: [recovered],
    });

    expect(events).toHaveLength(1);
    expect(events[0].seq).toBe(12);
    expect(events[0].text).toBe("Recovered from snapshot recent events.");
  });

  it("replaces a streamed answer with the final answer part without creating another answer", () => {
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: "session-1:turn:req-1",
      events: [
        eventFromLedger(ledger({ seq: 1, text: "Hel" })),
        eventFromLedger(ledger({ seq: 2, text: "lo" })),
        eventFromLedger(ledger({
          seq: 3,
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "Hello.",
        })),
        eventFromLedger(ledger({
          seq: 4,
          part_id: "session-1:turn:req-1:status",
          part_type: "status",
          event_type: "turn.completed",
          operation: "close",
          visibility: "final",
          terminal_status: "completed",
          text: "",
          payload: { source_kind: "run.completed" },
        })),
      ],
    });

    const projection = projectOpenClawTurn(turn);

    expect(projection.visibleAnswer).toBe("Hello.");
    expect(projection.timelineItems.filter((item) => item.type === "answer")).toHaveLength(1);
    expect(projection.isStreaming).toBe(false);
  });

  it("collapses historical and live answer parts for the same run into one canonical answer", () => {
    const runId = "run-shared";
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: "session-1:turn:req-live",
      events: [
        eventFromLedger(ledger({
          seq: 53,
          turn_id: "session-1:turn:req-live",
          run_id: runId,
          active_request_id: "req-live",
          part_id: "session-1:turn:req-live:answer:0",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "Shared final answer.",
          payload: { source_kind: "assistant.message" },
        })),
        eventFromLedger(ledger({
          seq: 80,
          turn_id: "session-1:turn:history:run-shared",
          run_id: runId,
          active_request_id: "history:run-shared",
          part_id: "session-1:turn:history:run-shared:answer:0",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "Shared final answer.",
          payload: { source_kind: "assistant.message" },
        })),
        eventFromLedger(ledger({
          seq: 81,
          turn_id: "session-1:turn:req-live",
          run_id: runId,
          active_request_id: "req-live",
          part_id: "session-1:turn:req-live:status",
          part_type: "status",
          event_type: "turn.completed",
          operation: "close",
          visibility: "final",
          terminal_status: "completed",
          text: "",
          payload: { source_kind: "run.completed" },
        })),
      ],
    });

    const projection = projectOpenClawTurn(turn);

    expect(projection.visibleAnswer).toBe("Shared final answer.");
    expect(projection.timelineItems.filter((item) => item.type === "answer")).toHaveLength(1);
    expect(projection.isStreaming).toBe(false);
  });

  it("applies same-run final history parts after a terminal event without reopening loading", () => {
    const runId = "run-with-file";
    const liveTurnId = "session-1:turn:req-live";
    const historyTurnId = `session-1:turn:history:${runId}`;
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: liveTurnId,
      events: [
        eventFromLedger(ledger({
          seq: 50,
          turn_id: liveTurnId,
          run_id: runId,
          active_request_id: "req-live",
          part_id: `${liveTurnId}:answer:0`,
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "实时回答草稿。",
          payload: { source_kind: "assistant.message" },
        })),
        eventFromLedger(ledger({
          seq: 51,
          turn_id: liveTurnId,
          run_id: runId,
          active_request_id: "req-live",
          part_id: `${liveTurnId}:status`,
          part_type: "status",
          event_type: "turn.completed",
          operation: "close",
          visibility: "final",
          terminal_status: "completed",
          text: "",
          payload: { source_kind: "run.completed" },
        })),
        eventFromLedger(ledger({
          seq: 70,
          turn_id: historyTurnId,
          run_id: runId,
          active_request_id: `history:${runId}`,
          part_id: `${historyTurnId}:output_files:test_document.txt`,
          part_type: "output_file",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "",
          payload: {
            source_kind: "process.step",
            process_step: {
              step_code: "output_files",
              status: "completed",
              data: {
                files: [
                  {
                    id: "file-1",
                    file_name: "test_document.txt",
                    signed_download_url: "https://example.com/test_document.txt",
                  },
                ],
              },
            },
          },
        })),
        eventFromLedger(ledger({
          seq: 71,
          turn_id: historyTurnId,
          run_id: runId,
          active_request_id: `history:${runId}`,
          part_id: `${historyTurnId}:answer:0`,
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "最终回答：测试文档已生成。",
          payload: { source_kind: "assistant.message" },
        })),
      ],
    });

    const projection = projectOpenClawTurn(turn);

    expect(projection.visibleAnswer).toBe("最终回答：测试文档已生成。");
    expect(projection.outputFiles).toEqual([
      expect.objectContaining({
        file_name: "test_document.txt",
        signed_download_url: "https://example.com/test_document.txt",
      }),
    ]);
    expect(projection.timelineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_files",
          files: expect.arrayContaining([
            expect.objectContaining({ file_name: "test_document.txt" }),
          ]),
        }),
      ])
    );
    expect(projection.isStreaming).toBe(false);
  });

	  it("normalizes base64 output files from ledger projection into previewable data urls", () => {
    const turnId = "session-1:turn:req-live";
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: turnId,
      events: [
        eventFromLedger(ledger({
          seq: 10,
          turn_id: turnId,
          part_id: `${turnId}:output_files:name:test_12words_v3.txt`,
          part_type: "output_file",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "",
          payload: {
            source_kind: "process.step",
            process_step: {
              step_code: "output_files",
              status: "completed",
              data: {
                files: [
                  {
                    id: "local-bdd210961c52b3b6bb5706a4",
                    file_name: "test_12words_v3.txt",
                    mime_type: "text/plain",
                    size: 36,
                    base64: "56ys5LiJ5Liq5Y2B5LqM5Liq5rGJ5a2X5rWL6K+V5paH5qGj",
                  },
                ],
              },
            },
          },
        })),
      ],
    });

    const projection = projectOpenClawTurn(turn);

    expect(projection.outputFiles).toEqual([
      expect.objectContaining({
        id: "local-bdd210961c52b3b6bb5706a4",
        file_name: "test_12words_v3.txt",
        base64: "56ys5LiJ5Liq5Y2B5LqM5Liq5rGJ5a2X5rWL6K+V5paH5qGj",
        url: "data:text/plain;base64,56ys5LiJ5Liq5Y2B5LqM5Liq5rGJ5a2X5rWL6K+V5paH5qGj",
      }),
	    ]);
	  });

	  it("keeps stable preview urls ahead of stale file urls during ledger projection", () => {
	    const turnId = "session-1:turn:req-preview";
	    const turn = createOpenClawTurnState({
	      sessionId: "session-1",
	      turnKey: turnId,
	      events: [
	        eventFromLedger(ledger({
	          seq: 12,
	          turn_id: turnId,
	          part_id: `${turnId}:output_files:report.md`,
	          part_type: "output_file",
	          event_type: "part.replace",
	          operation: "replace",
	          visibility: "final",
	          text: "",
	          payload: {
	            source_kind: "process.step",
	            process_step: {
	              step_code: "output_files",
	              status: "completed",
	              data: {
	                files: [
	                  {
	                    id: "artifact-1",
	                    artifact_id: "artifact-1",
	                    upload_file_id: "upload-1",
	                    file_name: "report.md",
	                    url: "http://127.0.0.1:1/transient/report.md",
	                    preview_key: "preview-report.md",
	                    preview_url: "/api/preview/preview-report.md",
	                    download_url: "/api/openclaw/agents/F0GX8N/artifacts/artifact-1/download",
	                    signed_download_url: "https://example.com/download/report.md?sig=1",
	                  },
	                ],
	              },
	            },
	          },
	        })),
	      ],
	    });

	    const projection = projectOpenClawTurn(turn);

	    expect(projection.outputFiles).toEqual([
	      expect.objectContaining({
	        id: "artifact-1",
	        artifact_id: "artifact-1",
	        upload_file_id: "upload-1",
	        file_name: "report.md",
	        preview_key: "preview-report.md",
	        preview_url: "/api/preview/preview-report.md",
	        url: "/api/preview/preview-report.md",
	        download_url: "/api/openclaw/agents/F0GX8N/artifacts/artifact-1/download",
	        signed_download_url: "https://example.com/download/report.md?sig=1",
	      }),
	    ]);
	    expect(projection.timelineItems).toEqual(
	      expect.arrayContaining([
	        expect.objectContaining({
	          type: "output_files",
	          files: expect.arrayContaining([
	            expect.objectContaining({
	              file_name: "report.md",
	              url: "/api/preview/preview-report.md",
	              preview_url: "/api/preview/preview-report.md",
	            }),
	          ]),
	        }),
	      ])
	    );
	  });

  it("projects output files from wrapped ledger process-step payloads", () => {
    const turnId = "session-1:turn:req-wrapped-output";
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: turnId,
      events: [
        eventFromLedger(ledger({
          seq: 14,
          turn_id: turnId,
          part_id: `${turnId}:output_files:name:test4.txt`,
          part_type: "output_file",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "",
          payload: {
            payload: {
              object: "process.step",
              process_step: {
                step_code: "output_files",
                status: "completed",
                data: {
                  files: [
                    {
                      id: "artifact-test4",
                      file_name: "test4.txt",
                      mime_type: "text/plain",
                      size: 4,
                      preview_key: "preview-test4",
                      preview_url: "/api/preview/preview-test4",
                      download_url: "/api/openclaw/agents/F0GX8N/artifacts/artifact-test4/download",
                    },
                  ],
                },
              },
            },
          },
        })),
      ],
    });

    const projection = projectOpenClawTurn(turn);

    expect(projection.outputFiles).toEqual([
      expect.objectContaining({
        id: "artifact-test4",
        file_name: "test4.txt",
        preview_key: "preview-test4",
        url: "/api/preview/preview-test4",
        preview_url: "/api/preview/preview-test4",
        download_url: "/api/openclaw/agents/F0GX8N/artifacts/artifact-test4/download",
      }),
    ]);
    expect(projection.timelineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_files",
          files: expect.arrayContaining([expect.objectContaining({ file_name: "test4.txt" })]),
        }),
      ])
    );
  });

  it("keeps same-turn manifest output files that arrive after terminal status without run_id", () => {
    const reqId = "1782207557133";
    const turnId = `session-1:turn:${reqId}`;
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: turnId,
      events: [
        eventFromLedger(ledger({
          seq: 20,
          turn_id: turnId,
          active_request_id: reqId,
          part_id: `${turnId}:answer:0`,
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "我已经成功创建了另一个正好4个字符长度的文件。",
          payload: { source_kind: "assistant.message" },
        })),
        eventFromLedger(ledger({
          seq: 21,
          turn_id: turnId,
          active_request_id: reqId,
          part_id: `${turnId}:status`,
          part_type: "status",
          event_type: "turn.completed",
          operation: "close",
          visibility: "final",
          terminal_status: "completed",
          text: "",
          payload: { source_kind: "run.completed" },
        })),
        eventFromLedger(ledger({
          seq: 287970,
          turn_id: turnId,
          active_request_id: reqId,
          part_id: `${turnId}:output_file:name:file4.txt`,
          part_type: "output_file",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "",
          payload: {
            process_step: {
              step_code: "output_files",
              status: "completed",
              data: {
                files: [
                  {
                    id: "artifact-file4",
                    file_name: "file4.txt",
                    mime_type: "text/plain",
                    size: 4,
                    preview_key: "preview-file4",
                    preview_url: "/api/preview/preview-file4",
                    download_url: "/api/openclaw/agents/F0GX8N/artifacts/artifact-file4/download",
                  },
                ],
              },
            },
          },
        })),
      ],
    });

    const projection = projectOpenClawTurn(turn);

    expect(projection.visibleAnswer).toContain("4个字符长度的文件");
    expect(projection.isStreaming).toBe(false);
    expect(projection.outputFiles).toEqual([
      expect.objectContaining({
        id: "artifact-file4",
        file_name: "file4.txt",
        url: "/api/preview/preview-file4",
        preview_url: "/api/preview/preview-file4",
      }),
    ]);
    expect(projection.timelineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_files",
          files: expect.arrayContaining([expect.objectContaining({ file_name: "file4.txt" })]),
        }),
      ])
    );
  });

	  it("projects separate OpenClaw answer parts instead of merging text by content", () => {
    const runId = "run-multi-answer";
    const turnId = "session-1:turn:req-live";
    const historyTurnId = `session-1:turn:history:${runId}`;
    const introAnswer = "好的！我来为您生成一个包含10个字的纯文本测试文档。";
    const finalAnswer = [
      "完成！我已经为您生成了一个纯文本测试文档。",
      "",
      "**文件信息：**",
      "- 文件路径：`/Users/y65ng/.qclaw/workspace/test_document.txt`",
    ].join("\n");
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: turnId,
      events: [
        eventFromLedger(ledger({
          seq: 460,
          turn_id: historyTurnId,
          run_id: runId,
          active_request_id: `history:${runId}`,
          part_id: `${historyTurnId}:answer:0`,
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: introAnswer,
          payload: { source_kind: "assistant.message" },
        })),
        eventFromLedger(ledger({
          seq: 461,
          turn_id: turnId,
          run_id: runId,
          active_request_id: "req-live",
          part_id: `${turnId}:status`,
          part_type: "status",
          event_type: "turn.completed",
          operation: "close",
          visibility: "final",
          terminal_status: "completed",
          text: "",
          payload: { source_kind: "run.completed" },
        })),
        eventFromLedger(ledger({
          seq: 471,
          turn_id: historyTurnId,
          run_id: runId,
          active_request_id: `history:${runId}`,
          part_id: `${historyTurnId}:answer:1`,
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: finalAnswer,
          payload: { source_kind: "assistant.message" },
        })),
      ],
    });

    const projection = projectOpenClawTurn(turn);

    expect(projection.timelineItems.filter((item) => item.type === "answer")).toHaveLength(2);
    expect(projection.visibleAnswer).toBe(`${introAnswer}${finalAnswer}`);
    expect(projection.isStreaming).toBe(false);
  });

  it("orders ledger parts by OpenClaw raw sequence when delivery seq is delayed", () => {
    const turnId = "session-1:turn:req-live";
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: turnId,
      events: [
        eventFromLedger(ledger({
          seq: 20,
          turn_id: turnId,
          part_id: `${turnId}:answer:0`,
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "先回复。",
          payload: { source_kind: "assistant.message", rawSeq: 53 },
        })),
        eventFromLedger(ledger({
          seq: 21,
          turn_id: turnId,
          part_id: `${turnId}:thinking:21`,
          part_type: "thinking",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "先思考。",
          payload: { source_kind: "assistant.thinking", rawSeq: 49, content: "先思考。" },
        })),
        eventFromLedger(ledger({
          seq: 22,
          turn_id: turnId,
          part_id: `${turnId}:tool_call:write`,
          part_type: "tool",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "",
          payload: {
            source_kind: "tool.call",
            rawSeq: 54,
            data: { name: "write", toolCallId: "write" },
          },
        })),
        eventFromLedger(ledger({
          seq: 23,
          turn_id: turnId,
          part_id: `${turnId}:answer:1`,
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "后续完成。",
          payload: { source_kind: "assistant.message", rawSeq: 129 },
        })),
        eventFromLedger(ledger({
          seq: 24,
          turn_id: turnId,
          part_id: `${turnId}:status`,
          part_type: "status",
          event_type: "turn.completed",
          operation: "close",
          visibility: "final",
          terminal_status: "completed",
          text: "",
          payload: { source_kind: "run.completed" },
        })),
      ],
    });

    const projection = projectOpenClawTurn(turn);
    const rendered = projection.timelineItems
      .filter((item: any) => item.type === "thinking" || item.type === "tool_call" || item.type === "answer")
      .map((item: any) => item.type === "answer" ? ["answer", item.content] : [item.type, item.seq]);

    expect(rendered).toEqual([
      ["thinking", 49],
      ["answer", "先回复。"],
      ["tool_call", 54],
      ["answer", "后续完成。"],
    ]);
  });

  it("does not project legacy raw timeline events unless compatibility is explicit", () => {
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: "session-1:turn:req-legacy",
      events: [
        createOpenClawTurnEvent({
          eventId: "legacy-answer",
          sessionId: "session-1",
          seq: 1,
          kind: "assistant.message",
          payload: { content: "Legacy raw answer" },
          createdAt: "2026-06-11T10:00:00.000Z",
          source: "events",
        }),
      ],
    });

    const canonicalOnly = projectOpenClawTurn(turn, { canonicalOnly: true });
    const legacyCompat = projectOpenClawTurn(turn, { allowLegacyProtocol: true });

    expect(canonicalOnly.visibleAnswer).toBe("");
    expect(canonicalOnly.timelineItems).toHaveLength(0);
    expect(legacyCompat.visibleAnswer).toBe("Legacy raw answer");
  });

  it("keeps ledger events as the source of truth when legacy events are mixed in", () => {
    const canonical = ledger({
      seq: 2,
      event_type: "part.replace",
      operation: "replace",
      visibility: "final",
      text: "Canonical final answer.",
      payload: { source_kind: "assistant.message" },
    });
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: "session-1:turn:req-1",
      events: [
        createOpenClawTurnEvent({
          eventId: "legacy-answer",
          sessionId: "session-1",
          seq: 1,
          kind: "assistant.message",
          payload: { content: "Legacy raw answer" },
          createdAt: "2026-06-11T09:59:59.000Z",
          source: "events",
        }),
        eventFromLedger(canonical),
      ],
    });

    const projection = projectOpenClawTurn(turn);

    expect(projection.visibleAnswer).toBe("Canonical final answer.");
    expect(projection.timelineItems.filter((item) => item.type === "answer")).toHaveLength(1);
  });

  it("keeps loading closed and ignores stale part updates after interruption", () => {
    const turn = createOpenClawTurnState({
      sessionId: "session-1",
      turnKey: "session-1:turn:req-1",
      events: [
        eventFromLedger(ledger({ seq: 1, text: "Partial" })),
        eventFromLedger(ledger({
          seq: 2,
          part_id: "session-1:turn:req-1:status",
          part_type: "status",
          event_type: "turn.interrupted",
          operation: "close",
          visibility: "final",
          terminal_status: "interrupted",
          text: "",
          payload: { source_kind: "run.interrupted" },
        })),
        eventFromLedger(ledger({ seq: 3, text: " stale" })),
        eventFromLedger(ledger({
          seq: 4,
          part_id: "session-1:turn:req-1:status",
          part_type: "status",
          event_type: "turn.completed",
          operation: "close",
          visibility: "final",
          terminal_status: "completed",
          text: "",
          payload: { source_kind: "run.completed" },
        })),
      ],
    });

    const projection = projectOpenClawTurn(turn);

    expect(projection.visibleAnswer).toBe("Partial");
    expect(projection.interrupted).toBe(true);
    expect(projection.failed).toBe(false);
    expect(projection.isStreaming).toBe(false);
  });

  it("projects the same UI state for realtime and multi-client replay payloads", () => {
    const events = [
      ledger({
        seq: 1,
        part_id: "session-1:turn:req-1:status",
        part_type: "status",
        event_type: "turn.started",
        operation: "noop",
        visibility: "hidden",
        text: "",
        payload: { source_kind: "run.started" },
      }),
      ledger({
        seq: 2,
        text: "Draft ",
        payload: { source_kind: "assistant.delta" },
      }),
      ledger({
        seq: 3,
        text: "answer",
        payload: { source_kind: "assistant.delta" },
      }),
      ledger({
        seq: 4,
        event_type: "part.replace",
        operation: "replace",
        visibility: "final",
        text: "Final answer.",
        payload: { source_kind: "assistant.message" },
      }),
      ledger({
        seq: 5,
        part_id: "session-1:turn:req-1:status",
        part_type: "status",
        event_type: "turn.completed",
        operation: "close",
        visibility: "final",
        terminal_status: "completed",
        text: "",
        payload: { source_kind: "run.completed" },
      }),
    ];

    const realtime = projectLedgerPayload({ ledger_events: events });
    const replay = projectLedgerPayload({
      recent_events: events,
      ledger_events: events.filter((event) => event.seq > 3),
    });

    expect(replay.visibleAnswer).toBe(realtime.visibleAnswer);
    expect(replay.timelineItems.map((item: any) => [item.type, item.identityKey || item.key, item.content || ""])).toEqual(
      realtime.timelineItems.map((item: any) => [item.type, item.identityKey || item.key, item.content || ""])
    );
    expect(replay.outputFiles).toEqual(realtime.outputFiles);
    expect(replay.activities.map((item: any) => [item.kind, item.seq])).toEqual(
      realtime.activities.map((item: any) => [item.kind, item.seq])
    );
    expect(replay.isStreaming).toBe(false);
    expect(replay.failed).toBe(false);
    expect(replay.interrupted).toBe(false);
  });

  it("uses ledger events from message history to recover the final answer after route switches", async () => {
    const conversationId = "session-1";
    const ledgerEvents = [
      ledger({
        seq: 1,
        part_id: "session-1:turn:req-1:thinking:0",
        part_type: "thinking",
        event_type: "part.delta",
        operation: "append",
        visibility: "stream",
        text: "draft reasoning",
        payload: { source_kind: "assistant.thinking" },
      }),
      ledger({
        seq: 2,
        event_type: "part.replace",
        operation: "replace",
        visibility: "final",
        text: "Recovered final answer.",
        payload: { source_kind: "assistant.message" },
      }),
      ledger({
        seq: 3,
        part_id: "session-1:turn:req-1:status",
        part_type: "status",
        event_type: "turn.completed",
        operation: "close",
        visibility: "final",
        terminal_status: "completed",
        text: "",
        payload: { source_kind: "run.completed" },
      }),
    ];
    const adapter = createOpenClawConversationApiAdapter({
      agentId: "agent-1",
      openclawApi: {
        conversations: async () => ({ data: { sessions: [] } }),
        messages: async () => ({
          data: {
            messages: [
              {
                id: "user-1",
                sessionId: conversationId,
                role: "user",
                content: "question",
                createdAt: "2026-06-11T10:00:00.000Z",
                seq: 0,
              },
            ],
            ledger_events: ledgerEvents,
          },
        }),
        events: async () => ({ data: { events: [] } }),
        control: async () => ({ data: null }),
      },
      completions: async () => ({ data: null }),
      requestSource: "web",
    });

    const response = await adapter.messages(conversationId);
    const rows = response.data.messages;

    expect(rows).toHaveLength(1);
    expect(rows[0].openclawTurn.events.map((event: any) => event.payload?.openclaw_ledger?.event_type)).toEqual([
      "part.delta",
      "part.replace",
      "turn.completed",
    ]);
    expect(rows[0].answer).toBe("Recovered final answer.");
    expect(rows[0].openclawProjection.timelineItems.filter((item: any) => item.type === "answer")).toHaveLength(1);
    expect(rows[0].openclawProjection.isStreaming).toBe(false);
  });

  it("drops blank OpenClaw history rows and internal control prompts without assistant surface", async () => {
    const conversationId = "session-1";
    const adapter = createOpenClawConversationApiAdapter({
      agentId: "agent-1",
      openclawApi: {
        conversations: async () => ({ data: { sessions: [] } }),
        messages: async () => ({
          data: {
            messages: [
              {
                id: "assistant-without-user",
                sessionId: conversationId,
                role: "assistant",
                content: "",
                createdAt: "2026-06-11T10:00:00.000Z",
              },
              {
                id: "internal-control",
                sessionId: conversationId,
                role: "user",
                content: "An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.",
                createdAt: "2026-06-11T10:00:01.000Z",
              },
              {
                id: "user-visible",
                sessionId: conversationId,
                role: "user",
                content: "测试",
                createdAt: "2026-06-11T10:00:02.000Z",
              },
            ],
            ledger_events: [],
          },
        }),
        events: async () => ({ data: { events: [] } }),
        control: async () => ({ data: null }),
      },
      completions: async () => ({ data: null }),
      requestSource: "web",
    });

    const response = await adapter.messages(conversationId);
    const rows = response.data.messages;

    expect(rows.map((row: any) => row.question)).toEqual(["测试"]);
    expect(rows[0].answer).toBe("");
  });
});
