import { useState, useEffect } from "react";
import { Input, Modal } from "antd";
import type { UsageItem } from "./types";
import { t } from "@/locales";

interface ContentFormModalProps {
  open: boolean;
  editingItem: UsageItem | null;
  isFaq: boolean;
  onConfirm: (title: string, description: string) => void;
  onCancel: () => void;
}

const ContentFormModal = ({
  open,
  editingItem,
  isFaq,
  onConfirm,
  onCancel,
}: ContentFormModalProps) => {
  const [contentForm, setContentForm] = useState({ title: "", description: "" });

  useEffect(() => {
    if (open) {
      setContentForm({
        title: editingItem?.title ?? "",
        description: editingItem?.description ?? "",
      });
    }
  }, [open, editingItem]);

  const handleConfirm = () => {
    if (!contentForm.title.trim() || !contentForm.description.trim()) return;
    onConfirm(contentForm.title, contentForm.description);
  };

  const isValid = contentForm.title.trim() && contentForm.description.trim();

  return (
    <Modal
      open={open}
      title={editingItem ? t("action_edit") : t("action_add")}
      onCancel={onCancel}
      onOk={handleConfirm}
      okButtonProps={{ disabled: !isValid }}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm text-primary">
            {isFaq ? t("skills.usage.question") : t("skills.usage.title")}
          </label>
          <Input
            value={contentForm.title}
            onChange={(e) =>
              setContentForm((prev) => ({ ...prev, title: e.target.value }))
            }
            maxLength={20}
            showCount
            placeholder={isFaq ? t("skills.usage.question_placeholder") : t("skills.usage.title_placeholder")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-primary">
            {isFaq ? t("skills.usage.answer") : t("description")}
          </label>
          <Input.TextArea
            value={contentForm.description}
            onChange={(e) =>
              setContentForm((prev) => ({
                ...prev,
                description: e.target.value,
              }))
            }
            rows={8}
            maxLength={1000}
            showCount
            style={{ resize: "none" }}
            placeholder={isFaq ? t("skills.usage.answer_placeholder") : t("skills.usage.content_placeholder")}
          />
        </div>
      </div>
    </Modal>
  );
};

ContentFormModal.displayName = "ContentFormModal";

export default ContentFormModal;
