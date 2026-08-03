import { useState, useEffect, useMemo } from "react";
import { Drawer, Modal, Input, message } from "antd";
import { t } from "@/locales";
import { SvgIcon, Dropdown } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { useFileConversationStore } from "../conversation";
import type { DocumentType } from "@/api/modules/conversation";
import "./ChatHistoryDrawer.css";

export interface ChatHistoryDrawerDocumentRef {
  documentType?: DocumentType;
  documentId?: string;
}

interface ChatHistoryDrawerProps {
  open: boolean;
  agentId: number;
  /** 文档引用（v0.4.2 §3.2），用于筛选当前文件/Wiki 页面的会话历史 */
  documentRef: ChatHistoryDrawerDocumentRef | null;
  onClose: () => void;
  onConversation: (id: string) => void;
}

interface ConversationItem {
  id: string;
  title: string;
  created_time: number;
  created_at?: Date;
  conversation_id?: string;
}

export function ChatHistoryDrawer({
  open,
  agentId,
  documentRef,
  onClose,
  onConversation,
}: ChatHistoryDrawerProps) {
  const convStore = useFileConversationStore();
  const [editVisible, setEditVisible] = useState(false);
  const [convForm, setConvForm] = useState({ title: "", id: "" });

  const conversations = useMemo(() => {
    return convStore.conversations || [];
  }, [convStore.conversations]);

  const groupedConversations = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    return [
      {
        title: t("time.today"),
        conversations: conversations.filter(
          (c: ConversationItem) =>
            new Date(c.created_time || (c.created_at as any)) >= today,
        ),
      },
      {
        title: t("time.yesterday"),
        conversations: conversations.filter((c: ConversationItem) => {
          const date = new Date(c.created_time || (c.created_at as any));
          return date >= yesterday && date < today;
        }),
      },
      {
        title: t("time.last_7_days"),
        conversations: conversations.filter((c: ConversationItem) => {
          const date = new Date(c.created_time || (c.created_at as any));
          return date >= weekAgo && date < yesterday;
        }),
      },
      {
        title: t("time.over_7_days"),
        conversations: conversations.filter(
          (c: ConversationItem) =>
            new Date(c.created_time || (c.created_at as any)) < weekAgo,
        ),
      },
    ];
  }, [conversations]);

  useEffect(() => {
    if (open && agentId) {
      // Same as Vue: setAgentId and setDocumentRef, then loadConversations
      convStore.setAgentId(agentId);
      // 文档引用统一（v0.4.2 §3.2）：仅使用 document_type + document_id
      convStore.setDocumentRef(
        documentRef?.documentType && documentRef?.documentId
          ? {
              documentType: documentRef.documentType,
              documentId: documentRef.documentId,
            }
          : null,
      );
      convStore.loadConversations();
    }
  }, [open, agentId, documentRef?.documentType, documentRef?.documentId]);

  const selectConversation = (conversation: any) => {
    onConversation(conversation.conversation_id || conversation.id);
  };

  const handleMenuClick = (command: string, conversation: any) => {
    switch (command) {
      case "edit":
        setConvForm({
          title: conversation.title || conversation.name || "",
          id: conversation.conversation_id || conversation.id,
        });
        setEditVisible(true);
        break;
      case "delete":
        deleteConversation(conversation);
        break;
    }
  };

  const deleteConversation = async (conversation: any) => {
    // Same as Vue: show confirmation dialog before delete
    Modal.confirm({
      title: t("action.del"),
      content: t("chat.conversation_confirm_delete"),
      okText: t("action.del"),
      cancelText: t("action.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await convStore.delConversation(conversation);
          message.success(t("action.delete_success"));
        } catch (error) {
          message.error(t("action.delete_failed"));
        }
      },
    });
  };

  const handleEditConv = async () => {
    if (!convForm.title.trim()) return;
    try {
      await convStore.editConversation({
        conversation_id: convForm.id,
        title: convForm.title,
      } as any);
      setEditVisible(false);
      message.success(t("action.save_success"));
    } catch (error) {
      message.error(t("action.save_failed"));
    }
  };

  const getMenuItems = (conversation: any): MenuProps["items"] => [
    {
      key: "edit",
      icon: <SvgIcon name="edit" className="w-4 h-4 mr-2" />,
      label: t("chat.edit_conversation"),
      onClick: () => handleMenuClick("edit", conversation),
    },
    {
      key: "delete",
      icon: <SvgIcon name="del" className="w-4 h-4 mr-2" />,
      label: t("action.del"),
      danger: true,
      onClick: () => handleMenuClick("delete", conversation),
    },
  ];

  return (
    <>
      <Drawer
        title="历史对话"
        placement="bottom"
        open={open}
        onClose={onClose}
        size="large"
       classNames={{
          root: "chat-history-drawer",
        }}
        getContainer={() => {
          const container = document.querySelector(".file-chat");
          return container || document.body;
        }}
        rootStyle={{ position: "absolute" }}
        styles={{
          mask: { position: "absolute" },
          section: { position: "absolute" },
        }}
      >
        {groupedConversations.map(
          (group) =>
            group.conversations.length > 0 && (
              <div key={group.title}>
                <h3 className="h-8 px-2 flex items-center text-sm text-[#999999]">
                  {group.title}
                </h3>
                {group.conversations.map((conversation: any) => (
                  <div
                    key={conversation.conversation_id || conversation.id}
                    className="relative group"
                  >
                    <div
                      className={`w-full h-9 px-2 rounded flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer ${
                        convStore.current_conversationid ===
                        (conversation.conversation_id || conversation.id)
                          ? "bg-blue-50"
                          : "bg-white"
                      }`}
                      onClick={() => selectConversation(conversation)}
                    >
                      <p className="text-sm text-gray-700 truncate flex-1">
                        {conversation.title || conversation.name}
                      </p>
                      <Dropdown
                        menu={{ items: getMenuItems(conversation) }}
                        trigger={["hover"]}
                        placement="bottomLeft"
                      >
                        <div
                          className="invisible group-hover:visible transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SvgIcon name="more-h" />
                        </div>
                      </Dropdown>
                    </div>
                  </div>
                ))}
              </div>
            ),
        )}
      </Drawer>

      <Modal
        title={t("chat.edit_conversation")}
        open={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={handleEditConv}
        okButtonProps={{ disabled: !convForm.title.trim() }}
        okText={t("action.confirm")}
        cancelText={t("action.cancel")}
        width={480}
      >
        <Input
          value={convForm.title}
          onChange={(e) => setConvForm({ ...convForm, title: e.target.value })}
          placeholder={t("form.input_placeholder")}
        />
      </Modal>
    </>
  );
}

export default ChatHistoryDrawer;
