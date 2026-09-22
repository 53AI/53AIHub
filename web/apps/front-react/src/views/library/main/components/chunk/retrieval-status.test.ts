import { describe, expect, it } from "vitest";
import {
  getRetrievalChunkStatusMeta,
  isRetrievalChunkEmbeddingInProgress,
} from "./retrieval-status";

describe("getRetrievalChunkStatusMeta", () => {
  it.each([
    ["normal", "索引成功"],
    ["completed", "索引成功"],
    ["pending", "排队中"],
    ["parsing", "索引中"],
    ["failed", "索引失败"],
    ["unexpected", "状态未知"],
  ])("maps %s to %s", (status, label) => {
    expect(getRetrievalChunkStatusMeta(status).label).toBe(label);
  });

  it.each(["pending", "parsing"])("keeps %s polling", (status) => {
    expect(isRetrievalChunkEmbeddingInProgress(status)).toBe(true);
  });

  it.each(["normal", "completed", "failed"])("stops polling for %s", (status) => {
    expect(isRetrievalChunkEmbeddingInProgress(status)).toBe(false);
  });
});
