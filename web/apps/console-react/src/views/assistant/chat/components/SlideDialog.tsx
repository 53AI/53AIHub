import React, {
    useState,
    forwardRef,
    useImperativeHandle,
    useRef,
} from "react";
import { Modal, Input, Button, Form, message, Popover, Image } from "antd";
import { PlusOutlined, CloseOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { deepCopy } from "@/utils";
import promptApi from "@/api/modules/prompt";
import { Sortable } from "@km/shared-components-react";
import { SvgIcon } from "@km/shared-components-react";
import PromptInput from "@/components/Prompt/input";
import { img_host } from "@/utils/config";

export interface SlideDialogRef {
  open: (group: any, list: any[]) => void;
}

interface SlideDialogProps {
  onChange?: () => void;
}

const iconList = [
  "book",
  "box",
  "check",
  "edit",
  "like",
  "note",
  "radar",
  "shake",
  "slide",
  "subscribe",
  "task",
  "tip",
  "transform",
  "translate",
  "voice",
].map((item) => `${img_host}/icon/${item}.png`);

export const SlideDialog = forwardRef<SlideDialogRef, SlideDialogProps>(
  ({ onChange }, ref) => {
    const [form] = Form.useForm();
    const [visible, setVisible] = useState(false);
    const [slideGroup, setSlideGroup] = useState<any>(null);
    const [quickCommands, setQuickCommands] = useState<any[]>([]);
    const [currentPromptId, setCurrentPromptId] = useState<string>("");
    const [popoverOpen, setPopoverOpen] = useState(false);
    const promptInputRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      open: async (group: any, list: any[]) => {
        form.resetFields();
        setSlideGroup(deepCopy(group));
        setQuickCommands(deepCopy(list));
        if (list.length > 0) {
          form.setFieldsValue(deepCopy(list[0]));
          setCurrentPromptId(list[0].prompt_id);
        }
        setVisible(true);
      },
    }));

    const maxSort =
      quickCommands.length > 0
        ? Math.max(0, ...quickCommands.map((item) => Number(item.sort) || 0))
        : 0;

    const getNewName = (currentList: any[]) => {
      const baseName = "新建划词指令";
      if (currentList.length === 0) return baseName;
      const reg = /^新建划词指令(\d+)$/;
      const maxN = Math.max(
        0,
        ...currentList.map((item) => {
          const m = String(item.name || "").match(reg);
          return m ? Number(m[1]) : 0;
        }),
      );
      return `${baseName}${maxN + 1}`;
    };

    const handleAdd = (currentList = quickCommands) => {
      if (currentPromptId && String(currentPromptId).startsWith("-")) {
        message.warning(t("请先保存当前指令"));
        return;
      }
      const newName = getNewName(currentList);
      const newForm = {
        name: newName,
        logo: iconList[0],
        content: "",
        prompt_id: -Date.now(),
      };
      const newList = [newForm, ...currentList];
      setQuickCommands(newList);
      handleEdit(newForm, true);
    };

    const handleEdit = (item: any, isVirtual: boolean = false) => {
      if (currentPromptId === item?.prompt_id) return;
      if (
        currentPromptId &&
        String(currentPromptId).startsWith("-") &&
        !isVirtual
      ) {
        message.warning(t("请先保存当前指令"));
        return;
      }
      form.setFieldsValue(deepCopy(item));
      setCurrentPromptId(item?.prompt_id || "");
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
          group_ids: [slideGroup.group_id],
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

    const iconContent = (
      <div className="w-[318px] p-1">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-sm text-primary">图标</div>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={() => setPopoverOpen(false)}
            size="small"
          />
        </div>
        <div className="grid grid-cols-6 gap-2.5">
          {iconList.map((item) => (
            <div
              key={item}
              className="size-10 rounded-lg flex items-center justify-center cursor-pointer hover:bg-[#F6F7F9]"
              onClick={() => {
                form.setFieldValue("logo", item);
                setPopoverOpen(false);
              }}
            >
              <Image className="size-5" src={item} preview={false} />
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <Modal
        open={visible}
        title="划词指令"
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
                onClick={() => handleAdd()}
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
              <Form.Item label="图标和名称" required>
                <div className="w-full flex items-center gap-2">
                  <Popover
                    content={iconContent}
                    trigger="click"
                    open={popoverOpen}
                    onOpenChange={setPopoverOpen}
                    placement="bottomLeft"
                  >
                    <div className="size-8 border rounded flex items-center justify-center cursor-pointer">
                      <Form.Item name="logo" noStyle>
                        <Input type="hidden" />
                      </Form.Item>
                      <Image
                        className="size-5"
                        src={form.getFieldValue("logo") || iconList[0]}
                        preview={false}
                      />
                    </div>
                  </Popover>
                  <Form.Item
                    name="name"
                    noStyle
                    rules={[
                      { required: true, message: t("form_input_placeholder") },
                    ]}
                  >
                    <Input maxLength={20} placeholder="请输入名称" showCount />
                  </Form.Item>
                </div>
              </Form.Item>
              <div>
                <div className="flex items-center text-sm text-placeholder mb-2">
                  把 <span className="text-brand">{"{划词内容}"}</span>{" "}
                  填入到指令内容里，例如：总结以下内容：{"{划词内容}"}
                </div>
                <Form.Item
                  name="content"
                  rules={[
                    { required: true, message: t("form_input_placeholder") },
                  ]}
                >
                  <PromptInput
                    ref={promptInputRef}
                    placeholder="使用{划词内容} 代表划词选中的文字，例如:翻译以下内容{划词内容}"
                    wordWrap
                    className="h-[280px] border rounded"
                  />
                </Form.Item>
              </div>
            </Form>
          </div>
        </div>
      </Modal>
    );
  },
);

export default SlideDialog;
