import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatInput } from "@km/shared-business/chat";

vi.mock("@km/shared-components-react", () => ({
  SvgIcon: vi.fn(() => null),
}));

describe("ChatInput disabled state", () => {
  it("blocks typing, sending, and upload entry when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSend = vi.fn();

    const { container } = render(
      <ChatInput
        inputValue=""
        onChange={onChange}
        onSend={onSend}
        onStop={() => undefined}
        isStreaming={false}
        inputState={{
          disabled: true,
          disabledReason: "OpenClaw 插件未连接，正在重连...",
        }}
        fileUpload={{ enabled: true }}
        placeholder="请输入你的需求"
      />
    );

    const textarea = screen.getByPlaceholderText("OpenClaw 插件未连接，正在重连...");
    expect(textarea).toBeDisabled();

    await user.type(textarea, "hello");
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="file"]')).toBeDisabled();
  });

  it("does not send when Enter is pressed during IME composition", () => {
    const onChange = vi.fn();
    const onSend = vi.fn();

    render(
      <ChatInput
        inputValue="ni"
        onChange={onChange}
        onSend={onSend}
        onStop={() => undefined}
        isStreaming={false}
        placeholder="请输入你的需求"
      />
    );

    const textarea = screen.getByPlaceholderText("请输入你的需求");
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, {
      key: "Enter",
      isComposing: true,
      nativeEvent: { isComposing: true, keyCode: 229 },
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends after IME composition is finished and Enter is pressed again", () => {
    const onChange = vi.fn();
    const onSend = vi.fn();

    render(
      <ChatInput
        inputValue="你"
        onChange={onChange}
        onSend={onSend}
        onStop={() => undefined}
        isStreaming={false}
        placeholder="请输入你的需求"
      />
    );

    const textarea = screen.getByPlaceholderText("请输入你的需求");
    fireEvent.compositionStart(textarea);
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("keeps Shift+Enter as newline instead of sending", () => {
    const onChange = vi.fn();
    const onSend = vi.fn();

    render(
      <ChatInput
        inputValue="hello"
        onChange={onChange}
        onSend={onSend}
        onStop={() => undefined}
        isStreaming={false}
        placeholder="请输入你的需求"
      />
    );

    const textarea = screen.getByPlaceholderText("请输入你的需求");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("opens the skill picker from slash input and supports search selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSelectSkill = vi.fn();

    render(
      <ChatInput
        inputValue=""
        onChange={onChange}
        onSend={() => undefined}
        onStop={() => undefined}
        isStreaming={false}
        placeholder="请输入你的需求"
        skill={{
          enabled: true,
          onSelect: onSelectSkill,
          suggestions: [
            {
              id: "skill-1",
              skill_name: "openclaw_pdf_probe",
              display_name: "PDF Probe",
              label: "PDF Probe",
            },
            {
              id: "skill-2",
              skill_name: "markdown_reader",
              display_name: "Markdown Reader",
              label: "Markdown Reader",
            },
            {
              id: "skill-3",
              skill_name: "disabled_skill",
              display_name: "Disabled Skill",
              label: "Disabled Skill",
            },
          ],
        }}
      />
    );

    const textarea = screen.getByPlaceholderText("请输入你的需求");
    act(() => {
      textarea.focus();
    });
    fireEvent.change(textarea, { target: { value: "/" } });

    expect(screen.getByPlaceholderText("搜索技能")).toBeInTheDocument();
    expect(screen.getByText("PDF Probe")).toBeInTheDocument();
    expect(screen.getByText("Markdown Reader")).toBeInTheDocument();
    expect(screen.queryByText("Disabled Skill")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(textarea).toHaveFocus();
      expect(screen.getByText("PDF Probe").closest("button")).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.change(textarea, { target: { value: "/markdown" } });
    expect(screen.queryByText("PDF Probe")).not.toBeInTheDocument();
    const markdownOption = screen.getByText("Markdown Reader").closest("button");
    expect(markdownOption).toBeTruthy();
    await waitFor(() => {
      expect(textarea).toHaveFocus();
      expect(markdownOption).toHaveAttribute("aria-selected", "true");
    });
    await user.click(markdownOption!);

    await waitFor(() => {
      expect(onSelectSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skill_name: "markdown_reader",
        })
      );
    });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("selects the highlighted skill with Enter and supports arrow navigation", async () => {
    const onChange = vi.fn();
    const onSelectSkill = vi.fn();

    render(
      <ChatInput
        inputValue=""
        onChange={onChange}
        onSend={() => undefined}
        onStop={() => undefined}
        isStreaming={false}
        placeholder="请输入你的需求"
        skill={{
          enabled: true,
          onSelect: onSelectSkill,
          suggestions: [
            {
              id: "skill-1",
              skill_name: "openclaw_pdf_probe",
              display_name: "PDF Probe",
              label: "PDF Probe",
            },
            {
              id: "skill-2",
              skill_name: "markdown_reader",
              display_name: "Markdown Reader",
              label: "Markdown Reader",
            },
          ],
        }}
      />
    );

    const textarea = screen.getByPlaceholderText("请输入你的需求");
    act(() => {
      textarea.focus();
    });
    fireEvent.change(textarea, { target: { value: "/" } });
    await waitFor(() => {
      expect(textarea).toHaveFocus();
      expect(screen.getByText("PDF Probe").closest("button")).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(document, { key: "ArrowDown" });
    await waitFor(() => {
      expect(textarea).toHaveFocus();
      expect(screen.getByText("Markdown Reader").closest("button")).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(document, { key: "Enter" });
    expect(onSelectSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        skill_name: "markdown_reader",
      })
    );
  });

  it("closes the skill picker when clicking outside or pressing Escape", async () => {
    const user = userEvent.setup();

    render(
      <div>
        <button type="button">outside target</button>
        <ChatInput
          inputValue=""
          onChange={() => undefined}
          onSend={() => undefined}
          onStop={() => undefined}
          isStreaming={false}
          placeholder="请输入你的需求"
          skill={{
            enabled: true,
            suggestions: [
              {
                id: "skill-1",
                skill_name: "openclaw_pdf_probe",
                display_name: "PDF Probe",
                label: "PDF Probe",
              },
            ],
          }}
        />
      </div>
    );

    await user.click(screen.getByRole("button", { name: "技能" }));
    expect(screen.getByPlaceholderText("搜索技能")).toBeInTheDocument();

    await user.click(screen.getByPlaceholderText("搜索技能"));
    expect(screen.getByPlaceholderText("搜索技能")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "outside target" }));
    expect(screen.queryByPlaceholderText("搜索技能")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "技能" }));
    expect(screen.getByPlaceholderText("搜索技能")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("搜索技能")).not.toBeInTheDocument();
    });
  });

  it("renders the selected skill inside the sender and allows removing it", () => {
    const onRemoveSkill = vi.fn();
    const { container } = render(
      <ChatInput
        inputValue="测试技能效果"
        onChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        isStreaming={false}
        placeholder="请输入你的需求"
        skill={{
          enabled: true,
          onRemove: onRemoveSkill,
          list: [
            {
              id: "skill-1",
              skill_name: "openclaw_pdf_probe",
              display_name: "PDF Probe",
              label: "PDF Probe",
            },
          ],
        }}
      />
    );

    expect(container.querySelector(".x-sender__prefix-content")?.textContent).toContain("PDF Probe");
    expect(screen.getByRole("button", { name: "技能" }).textContent).toBe("技能");
    expect(screen.getAllByText("PDF Probe")).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("移除技能"));

    expect(onRemoveSkill).toHaveBeenCalledTimes(1);
  });
});
