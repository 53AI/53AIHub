import React, {
    useState,
    forwardRef,
    useImperativeHandle,
    useRef,
} from "react";
import { Modal, Input, Button, Form, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { deepCopy } from "@/utils";
import promptApi from "@/api/modules/prompt";
import { Sortable } from "@km/shared-components-react";
import { SvgIcon } from "@km/shared-components-react";
import PromptInput from "@/components/Prompt/input";

export interface QuickerDialogRef {
  open: (group: any, list: any[]) => void;
}

interface QuickerDialogProps {
  onChange?: () => void;
}

export const QuickerDialog = forwardRef<QuickerDialogRef, QuickerDialogProps>(
  ({ onChange }, ref) => {
    const [form] = Form.useForm();
    const [visible, setVisible] = useState(false);
    const [quickGroup, setQuickGroup] = useState<any>(null);
    const [quickCommands, setQuickCommands] = useState<any[]>([]);
    const [currentPromptId, setCurrentPromptId] = useState<string>("");
    const promptInputRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      open: (group: any, list: any[]) => {
        form.resetFields();
        setQuickGroup(deepCopy(group));
        setQuickCommands(deepCopy(list));
        if (list.length > 0) {
          setCurrentPromptId(list[0].prompt_id);
          form.setFieldsValue(deepCopy(list[0]));
        }
        setVisible(true);
      },
    }));

    const maxSort =
      quickCommands.length > 0
        ? Math.max(0, ...quickCommands.map((item) => Number(item.sort) || 0))
        : 0;

    const getNewName = () => {
      const baseName = "新建划词指令";
      if (quickCommands.length === 0) return baseName;
      const reg = /^新建划词指令(\d+)$/;
      const maxN = Math.max(
        0,
        ...quickCommands.map((item) => {
          const m = String(item.name || "").match(reg);
          return m ? Number(m[1]) : 0;
        }),
      );
      return `${baseName}${maxN + 1}`;
    };

    const handleAdd = () => {
      if (currentPromptId && String(currentPromptId).startsWith("-")) {
        message.warning(t("请先保存当前指令"));
        return;
      }
      const newName = getNewName();
      const newForm = {
        name: newName,
        content: "",
        prompt_id: -Date.now(),
      };
      setQuickCommands([newForm, ...quickCommands]);
      handleEdit(newForm, true);
    };

    const handleEdit = (item: any, isVirtual: boolean = false) => {
      if (currentPromptId === item.prompt_id) return;
      if (
        currentPromptId &&
        String(currentPromptId).startsWith("-") &&
        !isVirtual
      ) {
        message.warning(t("请先保存当前指令"));
        return;
      }
      form.setFieldsValue(deepCopy(item));
      setCurrentPromptId(item.prompt_id);
    };

    const handleDelete = async (data: any, e: React.MouseEvent) => {
      e.stopPropagation();

      const deleteItem = async () => {
        const newList = quickCommands.filter(
          (item) => item.prompt_id !== data.prompt_id,
        );
        setQuickCommands(newList);
        if (currentPromptId === data.prompt_id) {
          setCurrentPromptId("");
        }
        if (newList.length > 0) {
          handleEdit(newList[0], true);
        } else {
          form.resetFields();
        }
        onChange?.();
      };

      // 虚拟 ID（负数）直接从列表移除，不调用 API
      if (data.prompt_id > 0) {
        const modal = Modal.confirm({
          title: t("tip"),
          content: t("action_delete_confirm"),
          okButtonProps: { loading: false },
          onOk: async () => {
            modal.update({ okButtonProps: { loading: true } });
            try {
              await promptApi.delete({ prompt_id: data.prompt_id });
              await deleteItem();
              message.success(t("action_delete_success"));
            } finally {
              modal.update({ okButtonProps: { loading: false } });
            }
          },
        });
      } else {
        await deleteItem();
      }
    };

    const handleClose = () => {
      setVisible(false);
    };

    const handleSave = async () => {
      try {
        await form.validateFields();
      } catch (err) {
        const values = form.getFieldsValue();
        if (!values.content?.trim()) {
          message.warning(t("form.slide_empty_tip"));
        }
        return;
      }
      const values = form.getFieldsValue();
      let data = { ...values, prompt_id: currentPromptId };
      data.ai_links = data.ai_links_data;

      // 新增（虚拟 ID 为负数）
      const isNew = data.prompt_id && String(data.prompt_id).startsWith("-");
      if (isNew) {
        data = {
          ...data,
          prompt_id: 0,
          group_ids: [quickGroup.group_id],
          status: 1,
          ai_links: [],
          sort: maxSort + 1,
        };
      } else {
        // 更新时需要从列表中获取 group_ids
        const currentItem = quickCommands.find(
          (item) => item.prompt_id === currentPromptId,
        );
        if (currentItem?.group_ids) {
          data.group_ids = currentItem.group_ids;
        }
      }
      const result = await promptApi.save(data);
      const promptIndex = quickCommands.findIndex(
        (item) => item.prompt_id === currentPromptId,
      );
      const newList = [...quickCommands];
      if (promptIndex !== -1) {
        newList[promptIndex] = result;
        setCurrentPromptId(result.prompt_id);
      } else {
        newList[0] = result;
        handleEdit(result, true);
      }
      setQuickCommands(newList);
      message.success(t("action_save_success"));
      onChange?.();
    };

    const handleChange = (newList: any[]) => {
      setQuickCommands(newList);
      Promise.all(
        newList.map((item, index) => {
          return promptApi.save({
            ...item,
            ai_links: item.ai_links_data,
            sort: newList.length - index,
          });
        }),
      ).then(() => {
        onChange?.();
      });
    };

    return (
      <Modal
        open={visible}
        title="快捷指令"
        width={800}
        onCancel={handleClose}
        footer={[
          <Button key="cancel" onClick={handleClose}>
            取消
          </Button>,
          <Button key="save" type="primary" onClick={handleSave}>
            保存
          </Button>,
        ]}
        destroyOnHidden
      >
        <div className="h-[450px] flex gap-4 overflow-hidden">
          <div className="w-[220px] py-2 border rounded-md flex flex-col overflow-hidden">
            <div className="flex-none mx-2 py-4">
              <Button
                className="w-full"
                onClick={handleAdd}
                icon={<PlusOutlined />}
              >
                新建
              </Button>
            </div>
            <div className="flex-1 px-2 overflow-y-auto space-y-1">
              <Sortable
                value={quickCommands}
                onChange={handleChange}
                identity="prompt_id"
                className="h-full"
                renderItem={(item: any) => (
                  <div
                    className={`h-9 px-2 rounded flex items-center gap-3 justify-between cursor-pointer hover:bg-[#EBF1FF] group ${
                      currentPromptId === item.prompt_id ? "bg-[#EBF1FF]" : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(item);
                    }}
                  >
                    <div className="sort-icon cursor-move">
                      <SvgIcon
                        name="drag"
                        width="16"
                        height="32"
                        color="#a1a5af"
                      />
                    </div>
                    <div className="flex-1 text-sm text-primary truncate">
                      {item.name}
                    </div>
                    {item.prompt_id && (
                      <div
                        className="invisible group-hover:visible cursor-pointer flex items-center"
                        onClick={(e) => handleDelete(item, e)}
                      >
                        <SvgIcon
                          name="del"
                          width="16"
                          height="16"
                          color="#a1a5af"
                        />
                      </div>
                    )}
                  </div>
                )}
              />
            </div>
          </div>
          <div className="flex-1 pr-1 overflow-hidden">
            <Form form={form} layout="vertical" requiredMark="optional">
              <Form.Item
                label="名称"
                name="name"
                rules={[
                  { required: true, message: t("form_input_placeholder") },
                ]}
              >
                <Input maxLength={50} placeholder="请输入名称" showCount />
              </Form.Item>
              <Form.Item
                label="指令"
                name="content"
                rules={[
                  { required: true, message: t("form_input_placeholder") },
                ]}
              >
                <PromptInput
                  ref={promptInputRef}
                  placeholder="请输入指令"
                  showLine
                  wordWrap
                  className="h-[310px] border rounded bg-[#FAFBFC]"
                />
              </Form.Item>
            </Form>
          </div>
        </div>
      </Modal>
    );
  },
);

export default QuickerDialog;
