import { describe, expect, it } from "vitest";

import { getOutputFileDownloadStrategy } from "@km/shared-business/chat";

describe("output file download strategy", () => {
  it("prefers signed download urls over other file urls", () => {
    expect(
      getOutputFileDownloadStrategy({
        id: "f1",
        file_name: "report.txt",
        signed_download_url: "https://example.com/signed/report.txt",
        download_url: "/api/messages/1/files/f1",
        url: "https://example.com/plain/report.txt",
      } as any)
    ).toEqual({
      kind: "direct_url",
      url: "https://example.com/signed/report.txt",
    });
  });

  it("falls back to message lookup before opening a local workspace path", () => {
    expect(
      getOutputFileDownloadStrategy({
        id: "f2",
        file_name: "artifact.txt",
        message_id: "msg-2",
        url: "/Users/y65ng/.qclaw/workspace/artifact.txt",
      } as any)
    ).toEqual({ kind: "message_lookup" });
  });

  it("prefers download urls over transient realtime urls", () => {
    expect(
      getOutputFileDownloadStrategy({
        id: "f2-download",
        file_name: "artifact.txt",
        url: "http://127.0.0.1:1/unavailable/artifact.txt",
        download_url: "/api/upload-files/f2-download/download/artifact.txt",
      } as any)
    ).toEqual({
      kind: "direct_url",
      url: "/api/upload-files/f2-download/download/artifact.txt",
    });
  });

  it("keeps data urls in blob-download mode", () => {
    expect(
      getOutputFileDownloadStrategy({
        id: "f3",
        file_name: "artifact.txt",
        url: "data:text/plain;base64,SGVsbG8=",
      } as any)
    ).toEqual({
      kind: "data_url",
      url: "data:text/plain;base64,SGVsbG8=",
    });
  });

  it("creates a data url from inline base64 output files", () => {
    expect(
      getOutputFileDownloadStrategy({
        id: "f3-base64",
        file_name: "artifact.txt",
        mime_type: "text/plain",
        base64: "SGVsbG8=",
      } as any)
    ).toEqual({
      kind: "data_url",
      url: "data:text/plain;base64,SGVsbG8=",
    });
  });

  it("does not open unroutable local paths when no lookup metadata exists", () => {
    expect(
      getOutputFileDownloadStrategy({
        id: "f4",
        file_name: "artifact.txt",
        url: "/Users/y65ng/Developer/_work/intern/worktrees/openclaw-plugin-stack/output.txt",
      } as any)
    ).toEqual({ kind: "none" });
  });
});
