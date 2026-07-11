import { useMemo } from "react";
import { Button, Input } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { t } from "@/locales";

interface FeedbackPanelProps {
  visible: boolean;
  feedbackType: "satisfied" | "unsatisfied" | "";
  feedbackTypeOptions: Map<string, boolean> | null;
  submitBtnDisabled: boolean;
  feedbackSuccessful: boolean;
  description?: string;
  marginClass?: string;
  onClose: () => void;
  onToggle: (key: string) => void;
  onSubmit: () => void;
  onDescriptionChange: (value: string) => void;
}

export function FeedbackPanel({
  visible,
  feedbackType,
  feedbackTypeOptions,
  submitBtnDisabled,
  feedbackSuccessful,
  description = "",
  marginClass = "mb-2",
  onClose,
  onToggle,
  onSubmit,
  onDescriptionChange,
}: FeedbackPanelProps) {
  const feedbackLabel =
    feedbackType === "satisfied"
      ? t("chat.like_feedback")
      : t("chat.dislike_feedback");

  const optionsArray = useMemo(() => {
    if (!feedbackTypeOptions) return [];
    return Array.from(feedbackTypeOptions.entries());
  }, [feedbackTypeOptions]);

  const showOtherInput = feedbackTypeOptions?.get("其它") === true;

  return (
    <div>
      {visible && (
        <div
          className={`w-full p-4 border rounded-xl border-gray-200 relative ${marginClass}`}
        >
          <div className="flex justify-between">
            <span className="text-sm">{feedbackLabel}</span>
            <Button
              type="link"
              size="small"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <CloseOutlined />
            </Button>
          </div>
          {feedbackTypeOptions && (
            <div className="w-full flex flex-wrap gap-2 mt-3">
              {optionsArray.map(([key, value]) => (
                <Button
                  key={key}
                  className={`px-4 py-2 ${
                    value
                      ? "!bg-[#2563EB] !hover:bg-[#2563EB] !text-[#fff] !hover:text-[#fff] border-[#2563EB] hover:border-[#2563EB]"
                      : "bg-[#f7f7f7] hover:bg-[#f7f7f7] border-[#f7f7f7] hover:border-[#f7f7f7]"
                  }`}
                  onClick={() => onToggle(key)}
                >
                  {key}
                </Button>
              ))}
              {!showOtherInput && (
                <Button
                  type="primary"
                  onClick={onSubmit}
                  disabled={submitBtnDisabled}
                  className="!ml-auto"
                >
                  提交
                </Button>
              )}
              {showOtherInput && (
                <div className="w-full flex gap-2">
                  <Input
                    value={description}
                    onChange={(e) => onDescriptionChange(e.target.value)}
                    placeholder="(可选)告诉我们更多关于你的使用体验"
                    allowClear
                    style={{ backgroundColor: "#f7f7f7" }}
                  />
                  <Button
                    type="primary"
                    onClick={onSubmit}
                    disabled={submitBtnDisabled}
                  >
                    提交
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {feedbackSuccessful && (
        <div className="w-full py-3 text-center text-sm text-[#0edb45] bg-[#e7f8eb] rounded">
          {t("chat.submit_success")}
        </div>
      )}
    </div>
  );
}

export default FeedbackPanel;
