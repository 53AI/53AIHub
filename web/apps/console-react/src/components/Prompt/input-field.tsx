import { Tooltip } from "antd";
import { PromptInput, PromptInputRef } from "./input";
import { forwardRef, useImperativeHandle, useRef, useCallback } from "react";
import { t } from "@/locales";
import PromptOptimize from "./optimize";
import PromptGenerate from "./generate";
import { SvgIcon } from "@km/shared-components-react";

export interface PromptInputFieldProps {
  value?: string;
  onChange?: (value: string) => void;
  showLine?: boolean;
  showToken?: boolean;
  variables?: {
    label: string;
    children: {
      label: string;
      value: string;
    }[];
  }[];
  style?: React.CSSProperties;
  className?: string;
}

export interface PromptInputFieldRef extends PromptInputRef {}

export const PromptInputField = forwardRef<
  PromptInputFieldRef,
  PromptInputFieldProps
>(
  (
    {
      value,
      onChange,
      showLine = true,
      showToken = true,
      variables,
      style,
      className,
    },
    ref,
  ) => {
    const inputRef = useRef<PromptInputRef>(null);
    const optimizeRef = useRef<{ open: (prompt?: string) => void }>(null);
    const generateRef = useRef<{ open: () => void }>(null);

    useImperativeHandle(ref, () => ({
      showTooltip: () => inputRef.current?.showTooltip(),
      insertContent: (content) => inputRef.current?.insertContent(content),
      forceUpdate: (text) => inputRef.current?.forceUpdate(text),
      scrollToBottom: () => inputRef.current?.scrollToBottom(),
    }));

    const handleOptimize = useCallback(() => {
      optimizeRef.current?.open(value || "");
    }, [value]);

    const handleGenerate = useCallback(() => {
      generateRef.current?.open();
    }, []);

    const handleOptimizeConfirm = useCallback(
      (text: string) => {
        onChange?.(text);
        inputRef.current?.forceUpdate(text);
      },
      [onChange],
    );

    const handleGenerateConfirm = useCallback(
      (text: string) => {
        onChange?.(text);
        inputRef.current?.forceUpdate(text);
      },
      [onChange],
    );

    return (
      <div
        className={`border rounded w-full flex flex-col bg-white overflow-hidden ${className || ""}`}
        style={style}
      >
        <div className="min-h-10 px-3 border-b flex items-center justify-between bg-white rounded-t">
          <div className="flex-1 text-sm text-secondary truncate">
            *{t("role_instruction_desc")}
          </div>
          <div hidden className="flex items-center gap-1">
            <Tooltip title={t("optimize_tip")}>
              <span
                className="flex items-center gap-1 text-brand text-sm px-1 cursor-pointer hover:opacity-80"
                onClick={handleOptimize}
              >
                <SvgIcon name="hglt" width="18px" />
                {t("optimize")}
              </span>
            </Tooltip>
            <div className="flex-none h-4 w-px border-r border-[#E1E2E6]" />
            <Tooltip title={t("generate_tip")}>
              <span
                className="text-dark px-1 cursor-pointer hover:opacity-80"
                onClick={handleGenerate}
              >
                <SvgIcon name="magic-stick" width="18px" />
              </span>
            </Tooltip>
          </div>
        </div>
        <PromptInput
          ref={inputRef}
          value={value}
          onChange={onChange}
          showLine={showLine}
          showToken={showToken}
          variables={variables}
          style={{ minHeight: "60vh", height: "max-content" }}
        />
        <PromptOptimize ref={optimizeRef} onConfirm={handleOptimizeConfirm} />
        <PromptGenerate ref={generateRef} onConfirm={handleGenerateConfirm} />
      </div>
    );
  },
);

PromptInputField.displayName = "PromptInputField";

export default PromptInputField;
