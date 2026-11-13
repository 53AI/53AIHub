import { describe, expect, it } from "vitest";
import { buildAzureModelConfig, getAzureModelCapabilities } from "./azure-model-config";

const models = [
  {
    model_id: "gpt-6.1-sol",
    model_name: "GPT-6.1 Sol",
    preview: false,
    vision: true,
    enabled_tools: ["function", "web_search"],
    upstream_api_format: "responses",
    supported_api_formats: ["responses", "chat_completions"],
  },
  {
    model_id: "gpt-oss-20b",
    model_name: "GPT-OSS 20B",
    preview: true,
    vision: false,
    enabled_tools: ["function"],
    upstream_api_format: "chat_completions",
    supported_api_formats: ["chat_completions"],
  },
  {
    model_id: "gpt-5.4-pro",
    model_name: "GPT-5.4 Pro",
    vision: true,
    enabled_tools: ["function", "web_search"],
    upstream_api_format: "responses",
    supported_api_formats: ["responses"],
  },
];

describe("Azure base model configuration", () => {
  it("uses catalog defaults and capabilities, with native search disabled by default", () => {
    const capability = getAzureModelCapabilities("gpt-6.1-sol", models);
    expect(capability).toMatchObject({
      upstreamAPIFormat: "responses",
      supportedAPIFormats: ["responses", "chat_completions"],
      vision: true,
      webSearch: true,
      preview: false,
    });
    expect(
      buildAzureModelConfig("gpt-6.1-sol", "prod-deployment", models),
    ).toEqual({
      model_id: "prod-deployment",
      base_model_id: "gpt-6.1-sol",
      upstream_api_format: "responses",
      enabled_tools: ["function"],
      vision: true,
    });
  });

  it("keeps chat-only preview models on Chat Completions", () => {
    expect(
      buildAzureModelConfig("gpt-oss-20b", "oss-production", models, {
        webSearchEnabled: true,
      }),
    ).toEqual({
      model_id: "oss-production",
      base_model_id: "gpt-oss-20b",
      upstream_api_format: "chat_completions",
      enabled_tools: ["function"],
      vision: false,
    });
  });

  it("rejects a configured API format outside the model capability list", () => {
    expect(() =>
      buildAzureModelConfig("gpt-oss-20b", "oss", models, {
        upstreamAPIFormat: "responses",
      }),
    ).toThrow(/不支持/);
  });

  it("defaults Responses-only models to Responses and leaves custom capabilities unknown", () => {
    expect(getAzureModelCapabilities("gpt-5.4-pro", models).upstreamAPIFormat).toBe("responses");
    expect(getAzureModelCapabilities("gpt-5.4-pro", models).supportedAPIFormats).toEqual([
      "responses",
    ]);
    expect(getAzureModelCapabilities("custom-deployment", models)).toMatchObject({
      known: false,
      webSearch: false,
      upstreamAPIFormat: "chat_completions",
    });
  });
});
