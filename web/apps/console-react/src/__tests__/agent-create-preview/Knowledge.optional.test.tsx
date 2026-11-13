import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Knowledge } from "../../../../../packages/shared-business/src/agent-create/platform/Knowledge";

const mocks = vi.hoisted(() => ({
  form: {
    formData: { settings: {} as Record<string, unknown> },
    updateFields: vi.fn(),
    updateSettings: vi.fn(),
  },
  checkboxProps: [] as Array<{ onChange?: (event: { target: { checked: boolean } }) => void }>,
  decisionSelect: undefined as ((value: string) => void) | undefined,
  inputNumberCallbacks: [] as Array<(value: number | null) => void>,
  adapter: {
    loadModels: vi.fn(async () => []),
    loadDecisionModels: vi.fn(() => new Promise<never>(() => {})),
    loadRerankModels: vi.fn(() => new Promise<never>(() => {})),
    loadPlatformSettings: vi.fn(async () => []),
  },
}));

vi.mock("antd", () => {
  const Empty = () => null;
  const Checkbox = (props: (typeof mocks.checkboxProps)[number]) => {
    mocks.checkboxProps.push(props);
    return null;
  };
  const Select = (props: { onChange?: (value: string) => void }) => {
    mocks.decisionSelect = props.onChange;
    return null;
  };
  const InputNumber = (props: { onChange?: (value: number | null) => void }) => {
    if (props.onChange) mocks.inputNumberCallbacks.push(props.onChange);
    return null;
  };
  const Form = Object.assign(({ children }: { children?: unknown }) => children, {
    useForm: () => [{}],
    Item: Empty,
  });
  const Radio = Object.assign(Empty, { Group: Empty });
  Object.assign(Checkbox, { Group: Empty });
  return {
    Form,
    Switch: Empty,
    Slider: Empty,
    InputNumber,
    Input: Empty,
    Tooltip: Empty,
    Radio,
    Checkbox,
    Select,
    message: { warning: vi.fn() },
  };
});

vi.mock("@ant-design/icons", () => ({ QuestionCircleOutlined: () => null }));
vi.mock("@km/shared-business/agent-create/hooks", () => ({
  useAgentForm: () => mocks.form,
  parseModelValue: vi.fn(),
  encodeModelValue: vi.fn(() => ""),
  validateModelConfig: vi.fn(() => true),
}));
vi.mock("@km/shared-business/agent-create/adapters", () => ({
  useAgentCreateAdapter: () => mocks.adapter,
}));
vi.mock("@km/shared-business/agent-create/components", () => ({
  BaseConfig: () => null,
  RelateAgents: () => null,
}));
vi.mock("@km/shared-components-react", () => ({
  ModelSelect: () => null,
  OverflowTooltip: () => null,
  SvgIcon: () => null,
}));

describe("Knowledge Jev optional configuration", () => {
  beforeEach(() => {
    mocks.form.formData = { settings: {} };
    mocks.form.updateFields.mockClear();
    mocks.form.updateSettings.mockClear();
    mocks.checkboxProps = [];
    mocks.decisionSelect = undefined;
    mocks.inputNumberCallbacks = [];
    mocks.adapter.loadModels.mockClear();
    mocks.adapter.loadDecisionModels.mockClear();
    mocks.adapter.loadRerankModels.mockClear();
    mocks.adapter.loadPlatformSettings.mockClear();
  });

  it("does not request decision models or add config for an old agent", async () => {
    mocks.form.formData = { settings: { legacy_setting: "preserve" } };

    render(<Knowledge showChannelConfig />);

    await waitFor(() => expect(mocks.form.updateFields).toHaveBeenCalled());
    expect(mocks.adapter.loadDecisionModels).not.toHaveBeenCalled();
    const settings = mocks.form.updateFields.mock.calls[0][0].settings;
    expect(settings).toMatchObject({ legacy_setting: "preserve" });
    expect(settings).not.toHaveProperty("intent_decision_config");
  });

  it("does not request decision models when the saved config is disabled", async () => {
    mocks.form.formData = { settings: { intent_decision_config: { enable: false } } };

    render(<Knowledge showChannelConfig />);

    await waitFor(() => expect(mocks.adapter.loadModels).toHaveBeenCalledTimes(1));
    expect(mocks.adapter.loadDecisionModels).not.toHaveBeenCalled();
  });

  it("hides web search when no model or external search source is available", async () => {
    mocks.adapter.loadModels.mockResolvedValueOnce([
      { value: "880", label: "SiliconFlow", options: [{ value: "880_53aikm_model", label: "model" }] },
    ]);

    render(<Knowledge showChannelConfig />);

    await waitFor(() => expect(mocks.adapter.loadModels).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("module.web_search")).not.toBeInTheDocument();
  });

  it("hides unsupported model search and clears its saved configuration", async () => {
    mocks.form.formData = {
      settings: {
        fast_reasoning_config: { channel_id: 880, model_name: "deepseek-ai/DeepSeek-V4.1-Flash" },
        deep_thinking_config: { enable: false },
        web_search_setting: {
          enable: true,
          source_type: "model",
          platform_setting_id: "stale-channel",
          platform_key: "stale-model",
          top_k: 7,
          stale_option: true,
        },
      },
    };
    mocks.adapter.loadModels.mockResolvedValueOnce([
      {
        value: "880",
        label: "SiliconFlow",
        options: [{ value: "880_53aikm_deepseek-ai/DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash" }],
      },
    ]);

    render(<Knowledge showChannelConfig />);

    expect(screen.queryByText("module.web_search")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.form.updateFields).toHaveBeenCalledWith(expect.objectContaining({
        settings: expect.objectContaining({
          web_search_setting: {
            enable: false,
            source_type: "api",
            platform_setting_id: "",
            platform_key: "",
            top_k: 20,
          },
        }),
      }));
    });
  });

  it("does not load agent-level decision models even when legacy settings contain an enabled toggle", async () => {
    mocks.form.formData = { settings: { intent_decision_config: { enable: true } } };
    render(<Knowledge showChannelConfig />);
    await waitFor(() => expect(mocks.adapter.loadModels).toHaveBeenCalledTimes(1));
    expect(mocks.adapter.loadDecisionModels).not.toHaveBeenCalled();
  });

});
