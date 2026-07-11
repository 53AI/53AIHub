import { useState } from "react";
import { Tooltip, message } from "antd";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import "./Extract.css";

interface ExtractProps {
  fileInfo?: any;
}

export function Extract({ fileInfo }: ExtractProps) {
  const [msg, setMsg] = useState({
    feedback_type: "" as "satisfied" | "unsatisfied" | "",
  });

  const handleClickFeedbackBtn = (type: "satisfied" | "unsatisfied") => {
    setMsg((prev) => ({ ...prev, feedback_type: type }));
  };

  const handleOpenShare = (data: any) => {
    console.log("Share:", data);
  };

  const handleCopy = async (text: string) => {
    await copyToClip(text);
    message.success(t("action.copy_success"));
  };

  return (
    <div className="px-5">
      {/* Hidden initial state UI - same as Vue v-if="false" */}
      {false && (
        <div className="h-full px-[100px] flex flex-col justify-center gap-4">
          <img className="size-16" src="" alt="" />
          <h2 className="text-[30px] text-[#1D1E1F] font-medium">需求提取</h2>
          <p className="text-[#999999] text-base">
            自动识别文档主题、核心诉求、数据指标、应用场景等维度，生成标准化需求清单
          </p>
          <div>
            <button className="btn-primary">开始生成</button>
          </div>
        </div>
      )}

      {/* Main content - same as Vue */}
      <div className="p-4 border rounded-xl bg-[#F7F8FA]">
        234234234 234234234 234234234 234234234 234234234 234234234 234234234
        234234234 234234234 234234234 234234234 234234234 234234234 234234234
        234234234 234234234 234234234 234234234 234234234 234234234 234234234
        234234234 234234234 234234234
      </div>

      <div className="flex items-center gap-2">
        <Tooltip title={t("action.copy")}>
          <div
            className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
            onClick={() => handleCopy("234234234")}
          >
            <SvgIcon name="copy" className="text-[#9B9B9B]" />
          </div>
        </Tooltip>
        <Tooltip title={t("chat.regenerate")}>
          <div className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]">
            <SvgIcon name="refresh" className="text-[#9B9B9B]" />
          </div>
        </Tooltip>
        {false && (
          <div
            className="h-6 px-1 rounded flex items-center justify-center gap-1 cursor-pointer hover:bg-[#E1E2E3]"
            onClick={() => handleOpenShare(msg)}
          >
            <SvgIcon size={18} name="share-two" color="#9B9B9B" stroke />
            <span className="text-sm text-[#939499]">{t("action.share")}</span>
          </div>
        )}
        <Tooltip title={t("chat.like")}>
          <div
            className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
            onClick={() => handleClickFeedbackBtn("satisfied")}
          >
            <SvgIcon
              size={msg.feedback_type === "satisfied" ? 16 : 18}
              name={
                msg.feedback_type === "satisfied" ? "like-selected" : "like"
              }
              color="#9B9B9B"
            />
          </div>
        </Tooltip>
        <Tooltip title={t("chat.dislike")}>
          <div
            className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
            onClick={() => handleClickFeedbackBtn("unsatisfied")}
          >
            <SvgIcon
              size={msg.feedback_type === "unsatisfied" ? 16 : 18}
              name={
                msg.feedback_type === "unsatisfied"
                  ? "dislike-selected"
                  : "dislike"
              }
              color="#9B9B9B"
            />
          </div>
        </Tooltip>
      </div>
    </div>
  );
}

export default Extract;
