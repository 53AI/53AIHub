import {
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import { Drawer, Button, Modal, Input } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { SvgIcon } from "@km/shared-components-react";
import { useConversationStore, useCurrentConversation } from "@/stores/modules/conversation";
import { t } from "@/locales";

interface ChatHistoryProps {
  onNew: () => void;
}

export interface ChatHistoryRef {
  open: () => void;
}

const ChatHistory = forwardRef<ChatHistoryRef, ChatHistoryProps>(
  ({ onNew }, ref) => {
    const setCurrentState = useConversationStore((state) => state.setCurrentState);
    const delConversationStore = useConversationStore((state) => state.delConversation);
    const editConversationStore = useConversationStore((state) => state.editConversation);
    const conversations = useConversationStore((state) => state.conversations);
    const currentConv = useCurrentConversation();
    const [visible, setVisible] = useState(false);
    const [editVisible, setEditVisible] = useState(false);
    const [convForm, setConvForm] = useState({
      conversation_id: 0,
      title: "",
    });

    useImperativeHandle(ref, () => ({
      open: () => setVisible(true),
    }));

    const handleCreate = () => {
      onNew();
      setVisible(false);
    };

    const handleEditConv = useCallback(async () => {
      if (!convForm.title.trim()) return;
      await editConversationStore(convForm);
      setEditVisible(false);
    }, [convForm, editConversationStore]);

    const delConversation = async (conv: Conversation.Info) => {
      Modal.confirm({
        title: t("chat.conversation_confirm_delete"),
        content: t("action.del"),
        okText: t("action.del"),
        cancelText: t("action.cancel"),
        okButtonProps: { danger: true },
        onOk: () => delConversationStore(conv),
      });
    };

    const handleCommandConv = (event: string, conv: Conversation.Info) => {
      if (event === "del") {
        delConversation(conv);
      } else if (event === "edit") {
        setConvForm({
          conversation_id: conv.conversation_id,
          title: conv.title,
        });
        setEditVisible(true);
      }
    };

    const menuItems = (item: Conversation.Info) => [
      {
        key: "edit",
        icon: <SvgIcon name="edit" className="mr-1" />,
        label: t("action.rename"),
      },
      {
        key: "del",
        danger: true,
        icon: <SvgIcon name="del" className="mr-1" />,
        label: (
          <span className="text-[#FA5151] flex items-center">
            <SvgIcon name="del" className="mr-1" />
            {t("action.del")}
          </span>
        ),
      },
    ];

    return (
      <>
        <Drawer
          open={visible}
          onClose={() => setVisible(false)}
          title={t("chat.history_conversation")}
          styles={{ wrapper: { width: 300 } }}
        >
          <Button
            className="w-full border-none -mt-4"
            color="primary"
            variant="filled"
            size="large"
            onClick={handleCreate}
          >
            + {t("chat.new_conversation")}
          </Button>
          <div className="flex flex-col gap-2 mt-4">
            {conversations.map((item, index) => (
              <div
                key={item.conversation_id || `conv-${index}`}
                className={`group p-3 rounded cursor-pointer hover:bg-[#F5F6FA] ${
                  currentConv?.conversation_id === item.conversation_id
                    ? "bg-[#F5F6FA]"
                    : ""
                }`}
                onClick={() => {
                  setCurrentState(item.agent_id, item.conversation_id)
                  setVisible(false)
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-sm text-primary truncate">
                    {item.title}
                  </div>
                  <Dropdown
                    menu={{
                      items: menuItems(item),
                      onClick: ({ key }) => handleCommandConv(key, item),
                    }}
                    trigger={["click"]}
                  >
                    <div className="size-7 flex-center cursor-pointer invisible group-hover:visible">
                      <SvgIcon name="more-h" />
                    </div>
                  </Dropdown>
                </div>
                <div className="mt-2 text-xs text-secondary">
                  {item.created_at}
                </div>
              </div>
            ))}
          </div>
        </Drawer>

        <Modal
          open={editVisible}
          onCancel={() => setEditVisible(false)}
          title={t("chat.edit_conversation")}
          onOk={handleEditConv}
          okButtonProps={{ disabled: !convForm.title.trim() }}
          width={480}
        >
          <Input
            size="large"
            value={convForm.title}
            onChange={(e) =>
              setConvForm({
                ...convForm,
                title:
                  e.target.value.trim() !== ""
                    ? e.target.value
                    : convForm.title,
              })
            }
            placeholder={t("form.input_placeholder")}
            maxLength={20}
            showCount
          />
        </Modal>
      </>
    );
  },
);

ChatHistory.displayName = "ChatHistory";

export default ChatHistory;
