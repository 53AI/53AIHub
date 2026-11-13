import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { supportsConfiguredModelsWebSearch, supportsModelWebSearch } from "./select-popover";
import ModelSelectPopover from "./select-popover";

vi.mock("./select", () => ({ default: () => null }));
vi.mock("./view", () => ({ default: () => <span>selected model</span> }));

describe("Agent model selection", () => {
  it("detects native web-search capable model configurations", () => {
    expect(
      supportsModelWebSearch({
        upstream_api_format: "responses",
        enabled_tools: ["function", "web_search"],
      }),
    ).toBe(true);
    expect(
      supportsModelWebSearch({
        upstream_api_format: "chat_completions",
        enabled_tools: ["web_search"],
      }),
    ).toBe(false);
  });

  it("only enables Agent native search when every active reasoning model supports it", () => {
    expect(supportsConfiguredModelsWebSearch(true, false, false)).toBe(true);
    expect(supportsConfiguredModelsWebSearch(true, true, true)).toBe(true);
    expect(supportsConfiguredModelsWebSearch(true, true, false)).toBe(false);
    expect(supportsConfiguredModelsWebSearch(false, true, true)).toBe(false);
  });

  it("does not show an independent search switch in the model popover", () => {
    render(<ModelSelectPopover />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
