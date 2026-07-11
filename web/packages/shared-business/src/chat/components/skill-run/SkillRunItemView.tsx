import { memo } from "react";
import { Spin } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import type { SkillRunItem, SkillRunSkillItem, SkillRunLlmItem, SkillRunScriptItem } from "../../types";

export interface SkillRunItemViewProps {
  items: SkillRunItem[];
  className?: string;
}

function SkillRunItemViewInner({ items, className = "" }: SkillRunItemViewProps) {
  if (!items || items.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {items.map((item, index) => {
        switch (item.type) {
          case "skill":
            return <SkillItem key={index} item={item as SkillRunSkillItem} />;
          case "llm":
            return <LlmItem key={index} item={item as SkillRunLlmItem} />;
          case "script":
            return <ScriptItem key={index} item={item as SkillRunScriptItem} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** 技能类型项 - 显示意图识别和技能执行 */
function SkillItem({ item }: { item: SkillRunSkillItem }) {
  const isRunning = item.status === "running";
  const isCompleted = item.status === "completed";

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#F8F9FA]">
      <div className="flex items-center justify-center w-5 h-5">
        {isRunning && <Spin size="small" />}
        {isCompleted && <CheckOutlined className="text-green-500 text-sm" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[#1F2123] truncate">{item.title}</div>
        {item.intentData && (
          <div className="mt-1 text-xs text-gray-500">
            {item.intentData.skill_name && (
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-100 text-blue-600 mr-1">
                {item.intentData.skill_name}
              </span>
            )}
            {item.intentData.confidence !== undefined && (
              <span className="text-gray-400">
                置信度: {Math.round(item.intentData.confidence * 100)}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** LLM 类型项 - 显示思考过程 */
function LlmItem({ item }: { item: SkillRunLlmItem }) {
  const isRunning = item.status === "running";
  const isCompleted = item.status === "completed";

  return (
    <div className="flex flex-col px-3 py-2 rounded-lg bg-[#FFF8E6]">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-5 h-5">
          {isRunning && <Spin size="small" />}
          {isCompleted && <CheckOutlined className="text-green-500 text-sm" />}
        </div>
        <div className="text-sm text-[#1F2123]">{item.title}</div>
      </div>
      {item.content && (
        <div className="mt-1 text-xs text-gray-600 max-h-40 overflow-y-auto whitespace-pre-wrap">
          {item.content}
        </div>
      )}
    </div>
  );
}

/** Script 类型项 - 显示代码执行 */
function ScriptItem({ item }: { item: SkillRunScriptItem }) {
  const isCompleted = item.status === "completed";

  return (
    <div className="flex flex-col px-3 py-2 rounded-lg bg-[#F0F0F0]">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-5 h-5">
          {isCompleted && <CheckOutlined className="text-green-500 text-sm" />}
        </div>
        <div className="text-sm text-[#1F2123]">{item.title}</div>
      </div>
      {item.bash && (
        <div className="mt-1 px-2 py-1 rounded bg-gray-800 text-green-400 text-xs font-mono max-h-20 overflow-y-auto whitespace-pre-wrap">
          {item.bash}
        </div>
      )}
      {item.output && (
        <div className="mt-1 text-xs text-gray-600 max-h-40 overflow-y-auto whitespace-pre-wrap">
          {item.output}
        </div>
      )}
    </div>
  );
}

const SkillRunItemView = memo(SkillRunItemViewInner);
SkillRunItemView.displayName = "SkillRunItemView";

export default SkillRunItemView;