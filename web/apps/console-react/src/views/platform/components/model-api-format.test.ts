import { describe, expect, it } from "vitest";
import { applyModelAPIFormat, supportsModelAPIFormat } from "./model-api-format";

describe("model API format settings", () => {
  it("limits the selector to supported reasoning model channels", () => {
    expect(supportsModelAPIFormat(36, "1", "")).toBe(true);
    expect(supportsModelAPIFormat(36, "2", "")).toBe(false);
    expect(supportsModelAPIFormat(5, "1", "")).toBe(false);
    expect(supportsModelAPIFormat(17, "1", "https://dashscope.aliyuncs.com/api/v1")).toBe(false);
    expect(supportsModelAPIFormat(17, "1", "https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(true);
  });

  it("writes the format to the matching model config", () => {
    expect(
      applyModelAPIFormat(
        [{ model_id: "custom-a" }, { model_id: "custom-b" }],
        "custom-b",
        "responses",
      ),
    ).toEqual([
      { model_id: "custom-a" },
      { model_id: "custom-b", upstream_api_format: "responses" },
    ]);
  });

  it("writes the format to a single model config object", () => {
    expect(applyModelAPIFormat({}, "custom-a", "chat_completions")).toEqual({
      upstream_api_format: "chat_completions",
    });
  });
});
