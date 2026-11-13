import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "@/api/modules/files/types";
import { collectBatchContinueIDs, submitBatchContinue } from "./batchContinue";

const file = (id: string, status?: string, isfile = true): FileItem =>
  ({ id, isfile, cleaning_info: status ? { status } : undefined }) as unknown as FileItem;

describe("collectBatchContinueIDs", () => {
  it("collects selected documents in success, failed and waiting states", () => {
    const files = [
      file("a", "success"),
      file("b", "failed"),
      file("c", "waiting"),
      file("d", "processing"),
      file("e", "pending"),
    ];
    expect(collectBatchContinueIDs(files, ["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c"]);
  });

  it("ignores folders, unselected documents and documents without cleaning status", () => {
    const files = [
      file("folder", "success", false),
      file("unselected", "failed"),
      file("nostatus"),
      file("selected", "failed"),
    ];
    expect(collectBatchContinueIDs(files, ["folder", "nostatus", "selected"])).toEqual(["selected"]);
  });
});

describe("submitBatchContinue", () => {
  it("sends exactly one batch request covering all three states", async () => {
    const files = [file("a", "success"), file("b", "failed"), file("c", "waiting")];
    const batchContinue = vi.fn().mockResolvedValue({});

    const submitted = await submitBatchContinue(files, ["a", "b", "c"], { batchContinue });

    expect(submitted).toEqual(["a", "b", "c"]);
    expect(batchContinue).toHaveBeenCalledTimes(1);
    expect(batchContinue).toHaveBeenCalledWith({ related_ids: ["a", "b", "c"] });
  });

  it("does not send a request when nothing is eligible", async () => {
    const batchContinue = vi.fn();

    const submitted = await submitBatchContinue([file("a", "processing")], ["a"], { batchContinue });

    expect(submitted).toEqual([]);
    expect(batchContinue).not.toHaveBeenCalled();
  });
});
