import { useState, forwardRef, useImperativeHandle } from "react";
import { Modal, Input, Empty, message, Button, Spin } from "antd";
import { PlusOutlined, CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { skillApi } from "@/api/modules/skill";
import type { SkillEnvVar } from "@/api/modules/skill/types";
import { t } from "@/locales";

interface EnvDialogRef {
  open: (skillId: string) => Promise<void>;
}

interface EditRowProps {
  keyName: string;
  value: string;
  isAdding: boolean;
  originalValue?: string; // 原始值，用于判断是否是 "***"
  onKeyChange: (key: string) => void;
  onValueChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const EditRow = ({
  keyName,
  value,
  isAdding,
  originalValue,
  onKeyChange,
  onValueChange,
  onConfirm,
  onCancel
}: EditRowProps) => (
  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-300 bg-white">
    <Input
      value={keyName}
      onChange={(e) => onKeyChange(e.target.value)}
      placeholder={t("skills.env.placeholder_key")}
      className="w-[200px]"
    />
    <Input
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      placeholder={t("skills.env.placeholder_value")}
      className="flex-1"
    />
    <div>
      <Button
        type="text"
        size="small"
        icon={<CheckOutlined />}
        onClick={(e) => {
          e.stopPropagation();
          onConfirm();
        }}
        className="text-gray-400 hover:!text-gray-400 hover:!bg-transparent"
      />
      <Button
        type="text"
        size="small"
        icon={<CloseOutlined />}
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        className="text-gray-400 hover:!text-gray-400 hover:!bg-transparent"
      />
    </div>
  </div>
);

// 显示提示的辅助函数，防止重复显示
const showWarningOnce = (() => {
  let lastWarningTime = 0;
  return (msg: string) => {
    const now = Date.now();
    if (now - lastWarningTime > 500) {
      lastWarningTime = now;
      message.warning(msg);
    }
  };
})();

export const EnvDialog = forwardRef<EnvDialogRef>((_, ref) => {
  const [visible, setVisible] = useState(false);
  const [skillId, setSkillId] = useState<string>("");
  const [envList, setEnvList] = useState<SkillEnvVar[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState("");
  const [editValue, setEditValue] = useState("");

  useImperativeHandle(ref, () => ({
    open: async (id: string) => {
      setSkillId(id);
      setVisible(true);
      await loadEnvVars(id);
    },
  }));

  const loadEnvVars = async (id: string) => {
    setLoading(true);
    try {
      const items = await skillApi.getEnvVars(id);
      setEnvList(items);
    } catch {
      message.error(t("skills.env.load_failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setVisible(false);
    resetState();
  };

  const resetState = () => {
    setIsAdding(false);
    setNewKey("");
    setNewValue("");
    handleCancelEdit();
  };

  const handleAdd = async () => {
    if (submitting) return;
    if (!newKey.trim()) {
      message.warning(t("skills.env.placeholder_key"));
      return;
    }
    if (!newValue.trim()) {
      message.warning(t("skills.env.placeholder_value"));
      return;
    }
    if (envList.some((item) => item.key === newKey.trim())) {
      message.warning(t("skills.env.key_exists"));
      return;
    }
    setSubmitting(true);
    try {
      const result = await skillApi.createEnvVar(skillId, {
        key: newKey.trim(),
        value: newValue,
      });
      setEnvList((prev) => [...prev, result]);
      setIsAdding(false);
      setNewKey("");
      setNewValue("");
      message.success(t("skills.env.add_success"));
    } catch {
      message.error(t("skills.env.add_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setNewKey("");
    setNewValue("");
  };

  const handleDelete = async (item: SkillEnvVar) => {
    if (isAdding || editingId || submitting) {
      showWarningOnce(t("skills.env.complete_current"));
      return;
    }
    Modal.confirm({
      title: t("tip"),
      content: t("skills.env.delete_confirm", { key: item.key }),
      onOk: async () => {
        setSubmitting(true);
        try {
          await skillApi.deleteEnvVar(skillId, item.id);
          setEnvList((prev) => prev.filter((i) => i.id !== item.id));
          message.success(t("skills.env.delete_success"));
        } catch {
          message.error(t("skills.env.delete_failed"));
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const handleEdit = (item: SkillEnvVar) => {
    if (isAdding || editingId) {
      showWarningOnce(t("skills.env.complete_current"));
      return;
    }
    setEditingId(item.id);
    setEditKey(item.key);
    setEditValue(item.value);
  };

  const handleConfirmEdit = async () => {
    if (submitting) return;
    if (!editKey.trim()) {
      message.warning(t("skills.env.placeholder_key"));
      return;
    }
    if (!editValue.trim()) {
      message.warning(t("skills.env.placeholder_value"));
      return;
    }
    // 检查变量名是否与其他变量重复（排除自身）
    if (envList.some((item) => item.key === editKey.trim() && item.id !== editingId)) {
      message.warning(t("skills.env.key_exists"));
      return;
    }
    // 检查是否有变化
    const originalItem = envList.find((item) => item.id === editingId);
    if (originalItem && editKey === originalItem.key && editValue === originalItem.value) {
      // 没有变化，直接关闭编辑状态
      handleCancelEdit();
      return;
    }
    setSubmitting(true);
    try {
      // 只传变化的字段
      const updateData: { key?: string; value?: string } = {};
      if (editKey !== originalItem?.key) {
        updateData.key = editKey.trim();
      }
      if (editValue !== originalItem?.value) {
        updateData.value = editValue;
      }
      const result = await skillApi.updateEnvVar(skillId, editingId!, updateData);
      setEnvList((prev) =>
        prev.map((item) => (item.id === editingId ? result : item)),
      );
      handleCancelEdit();
      message.success(t("skills.env.update_success"));
    } catch {
      message.error(t("skills.env.update_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditKey("");
    setEditValue("");
  };

  return (
    <Modal
      open={visible}
      title={t("skills.env.title")}
      width={700}
      onCancel={handleClose}
      footer={null}
      mask={{ closable: false }}
    >
      <div className="h-[400px] flex flex-col overflow-hidden">
        <Spin spinning={loading}>
          <div className="h-full flex-1 overflow-y-auto">
            {/* 变量列表 */}
            {(envList.length > 0 || isAdding) && (
              <div className="flex-1 space-y-3 mt-2">
                {envList.map((item) =>
                  editingId === item.id ? (
                    <EditRow
                      key={item.id}
                      keyName={editKey}
                      value={editValue}
                      isAdding={false}
                      originalValue={item.value}
                      onKeyChange={setEditKey}
                      onValueChange={setEditValue}
                      onConfirm={handleConfirmEdit}
                      onCancel={handleCancelEdit}
                    />
                  ) : (
                    <div
                      key={item.id}
                      className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 hover:border-gray-300 bg-white transition-colors"
                    >
                      <SvgIcon color="#2563EB" name="env" size={18} />
                      <span className="text-sm font-medium text-gray-900">
                        {item.key}
                      </span>
                      <div className="w-[1px] h-3 bg-gray-200"></div>
                      <span className="text-sm text-gray-500 truncate flex-1">
                        {item.value}
                      </span>
                      <div className="invisible group-hover:visible flex items-center shrink-0">
                        <Button
                          type="text"
                          icon={<SvgIcon name="edit" />}
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(item);
                          }}
                          className="text-gray-400 hover:!text-gray-400 hover:!bg-transparent"
                        />
                        <Button
                          type="text"
                          icon={<SvgIcon name="delete" />}
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item);
                          }}
                          className="text-gray-400 hover:!text-gray-400 hover:!bg-transparent"
                        />
                      </div>
                    </div>
                  ),
                )}

                {/* 添加新变量的输入行 */}
                {isAdding && (
                  <EditRow
                    keyName={newKey}
                    value={newValue}
                    isAdding={true}
                    onKeyChange={setNewKey}
                    onValueChange={setNewValue}
                    onConfirm={handleAdd}
                    onCancel={handleCancelAdd}
                  />
                )}

                {/* 有变量时的添加按钮 */}
                {envList.length > 0 && (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      if (isAdding || editingId) {
                        showWarningOnce(t("skills.env.complete_current"));
                        return;
                      }
                      setIsAdding(true);
                    }}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {t("action_add")}
                  </Button>
                )}
              </div>
            )}

            {/* 空状态 */}
            {envList.length === 0 && !isAdding && !loading && (
              <div className="h-full flex-1 flex-center flex-col mt-[80px]">
                <Empty description={t("skills.env.empty_desc")} image={window.$getPublicPath("/images/completion_empty.png")} />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setIsAdding(true)}
                  className="bg-blue-600 hover:bg-blue-700 mt-4"
                >
                  {t("action_add")}
                </Button>
              </div>
            )}
          </div>
        </Spin>
      </div>
    </Modal>
  );
});

export type { EnvDialogRef };
