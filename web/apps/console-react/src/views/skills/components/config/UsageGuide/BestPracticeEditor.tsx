import { Button, Input } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import type { UsageItem } from "./types";
import { t } from "@/locales";

interface BestPracticeEditorProps {
  positive: UsageItem[];
  negative: UsageItem[];
  disabled: boolean;
  onAdd: (type: "positive" | "negative") => void;
  onChange: (type: "positive" | "negative", id: string, title: string) => void;
  onDelete: (type: "positive" | "negative", id: string) => void;
}

interface PracticeListProps {
  title: string;
  items: UsageItem[];
  placeholder: string;
  disabled: boolean;
  onAdd: () => void;
  onChange: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  showBorder?: boolean;
}

const PracticeList = ({
  title,
  items,
  placeholder,
  disabled,
  onAdd,
  onChange,
  onDelete,
  showBorder = false,
}: PracticeListProps) => (
  <div className={showBorder ? "pt-4 border-t border-[#E6E8EB]" : ""}>
    <p className="text-sm text-gray-900 mb-3">{title}</p>
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3">
          <Input.TextArea
            value={item.title}
            onChange={(e) => onChange(item.id, e.target.value)}
            rows={2}
            maxLength={200}
            showCount
            style={{ resize: "none" }}
            placeholder={placeholder}
            className="flex-1"
            disabled={disabled}
          />
          <SvgIcon
            name="delete"
            className={`cursor-pointer ${
              disabled
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-400 hover:text-red-500"
            }`}
            onClick={() => !disabled && onDelete(item.id)}
          />
        </div>
      ))}
      <Button
        type="link"
        icon={<PlusOutlined />}
        onClick={onAdd}
        disabled={disabled}
        className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium h-8 px-2"
      >
        {t("action_add")}
      </Button>
    </div>
  </div>
);

const BestPracticeEditor = ({
  positive,
  negative,
  disabled,
  onAdd,
  onChange,
  onDelete,
}: BestPracticeEditorProps) => (
  <div className="space-y-4 mt-4">
    <PracticeList
      title={t("skills.usage.positive_case")}
      items={positive}
      placeholder={t("skills.usage.positive_case_placeholder")}
      disabled={disabled}
      onAdd={() => onAdd("positive")}
      onChange={(id, title) => onChange("positive", id, title)}
      onDelete={(id) => onDelete("positive", id)}
    />
    <PracticeList
      title={t("skills.usage.negative_case")}
      items={negative}
      placeholder={t("skills.usage.negative_case_placeholder")}
      disabled={disabled}
      onAdd={() => onAdd("negative")}
      onChange={(id, title) => onChange("negative", id, title)}
      onDelete={(id) => onDelete("negative", id)}
      showBorder
    />
  </div>
);

BestPracticeEditor.displayName = "BestPracticeEditor";

export default BestPracticeEditor;
