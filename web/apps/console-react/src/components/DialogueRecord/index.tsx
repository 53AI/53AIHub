import { Table, Drawer, Button, Spin, message } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import { useState, useEffect, useMemo } from "react";
import { t } from "@/locales";
import { FilterDateRange } from "@/components/Filter";
import type { ColumnsType } from "antd/es/table";
import { conversationApi } from "@/api/modules/conversation";
import { messageApi } from "@/api/modules/message";
import { getSimpleDateFormatString, getDateTimestamp, copyToClip } from "@km/shared-utils";
import { XBubbleList, XBubbleUser, XBubbleAssistant } from "@km/hub-ui-x-react";
import { SvgIcon, Search } from "@km/shared-components-react";

interface DialogueRecord {
  id: string;
  create_time: string;
  summary_content: string;
  message_count: number;
  [key: string]: any;
}

interface Message {
  question: { content: string; user_files?: any[] };
  answer: { content: string; loading?: boolean; reasoning_content?: string; reasoning_expanded?: boolean };
}

// 错误类型常量
const ERROR_INFO = {
  UPSTREAM_ERROR: 'upstream_error',
  TOKEN_FAILED: 'token验证失败',
  BAD_REQUEST: 'BadRequest',
  PARAM_FAILED: '请求参数有误',
  AUTH_ERROR: 'authentication_error',
  INVALID_REQUEST_ERROR: 'invalid_request_error',
  RESOURCE_NOT_FOUND: 'Resource not found',
  Unauthorized: 'Unauthorized',
  InvalidApiKey: 'InvalidApiKey',
} as const;

const ERROR_TYPES = [
  ERROR_INFO.UPSTREAM_ERROR,
  ERROR_INFO.BAD_REQUEST,
  ERROR_INFO.AUTH_ERROR,
  ERROR_INFO.INVALID_REQUEST_ERROR,
  ERROR_INFO.Unauthorized,
];

const ERROR_MESSAGES = [ERROR_INFO.TOKEN_FAILED, ERROR_INFO.PARAM_FAILED, ERROR_INFO.RESOURCE_NOT_FOUND];

const ResponseStatus = {
  UNAUTHORIZED: 401,
};

// 从 content 字段提取文本（处理数组格式 [{"type":"text","content":"xxx"}]）
const extractTextContent = (content: any): string => {
  if (!content) return "";
  if (typeof content === "string") {
    // content 可能是 JSON 字符串形式的数组，如 '[{"type":"text","content":"xxx"}]'
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item: any) => item.type === "text")
          .map((item: any) => item.content || "")
          .join("\n");
      }
      // 如果解析后是对象，说明不是数组格式，直接返回原字符串
    } catch {
      // 不是 JSON，直接返回原字符串
    }
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.content || "")
      .join("\n");
  }
  return String(content);
};

// 判断解析后的答案是否为错误
const isParsedAnswerError = (obj: any): boolean => {
  const type = obj?.error?.type;
  const msg = obj?.error?.message;
  if (ERROR_TYPES.includes(type) || ERROR_MESSAGES.includes(msg)) return true;
  if (obj?.status === ResponseStatus.UNAUTHORIZED) return true;
  if (obj?.code === ERROR_INFO.InvalidApiKey) return true;
  return false;
};

// 判断原始答案文本是否为错误
const isParsedAnswerCatchError = (text: string): boolean => {
  if (!text) return false;
  if (text.startsWith('Upstream Error')) return true;
  if (text.includes('App access denied')) return true;
  return false;
};

export interface DialogueRecordProps {
  type?: "agent" | "user";
  relatedId?: string | number;
  className?: string;
  onRowClick?: (record: DialogueRecord) => void;
}

export function DialogueRecord({
  type = "agent",
  relatedId,
  className,
  onRowClick,
}: DialogueRecordProps) {
  const [tableList, setTableList] = useState<DialogueRecord[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [messageList, setMessageList] = useState<Message[]>([]);
  const [filterForm, setFilterForm] = useState({
    date: null as [string, string] | null,
    keyword: "",
    page: 1,
    pageSize: 10,
  });

  // Table columns
  const columns: ColumnsType<DialogueRecord> = useMemo(
    () => [
      {
        title: t("create_time"),
        dataIndex: "create_time",
        key: "create_time",
        width: 160,
        ellipsis: true,
      },
      {
        title: t("summary"),
        dataIndex: "summary_content",
        key: "summary_content",
        minWidth: 180,
        ellipsis: true,
        render: (text: string) => text || "- -",
      },
      {
        title: t("message_count"),
        dataIndex: "message_count",
        key: "message_count",
        width: 120,
        align: "center",
      },
      {
        title: t("operation"),
        key: "operation",
        width: 140,
        align: "center",
        render: (_, record) => (
          <Button
            type="link"
            icon={<EyeOutlined />}
            className="opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              handleDetail(record);
            }}
          />
        ),
      },
    ],
    [t],
  );

  // Fetch table data
  const fetchData = async () => {
    if (!relatedId) return;

    setTableLoading(true);
    try {
      const params: any = {
        offset: (filterForm.page - 1) * filterForm.pageSize,
        limit: filterForm.pageSize,
      };

      if (filterForm.keyword) params.keyword = filterForm.keyword;
      if (filterForm.date?.[0]) params.created_at_start = getDateTimestamp(filterForm.date[0]);
      if (filterForm.date?.[1]) params.created_at_end = getDateTimestamp(filterForm.date[1]);

      const apiMethod =
        type === "agent"
          ? conversationApi.fetch_agent_conversations
          : conversationApi.fetch_user_conversations;

      const { data: { count = 0, items = [] } = {} } = await apiMethod({
        ...params,
        [type === "agent" ? "agent_id" : "user_id"]: relatedId,
      });

      const formattedItems = items.map((item: any) => {
        let summary_content = "";
        try {
          const summary = JSON.parse(item.summary || "[]");
          summary_content = (summary[0] || {}).content || "";
        } catch {
          summary_content = "";
        }
        return {
          ...item,
          create_time: getSimpleDateFormatString({ date: item.created_at, format: "YYYY-MM-DD hh:mm" }),
          summary_content,
        };
      });

      setTableList(formattedItems);
      setTableTotal(+count || 0);
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
      setTableList([]);
      setTableTotal(0);
    } finally {
      setTableLoading(false);
    }
  };

  // Handle detail
  const handleDetail = async (record: DialogueRecord) => {
    setDetailVisible(true);
    setDetailLoading(true);
    try {
      const { data: { messages = [] } = {} } = await messageApi.fetch_conversation_messages({
        conversation_id: record.id,
        offset: 0,
        limit: 1000,
      });

      const formattedMessages = messages.map((item: any = {}) => {
        // Parse question
        let questionContent = "";
        let userFiles: any[] = [];
        try {
          // item.message 可能是字符串或已解析的对象
          let msg = item.message;
          if (typeof msg === "string") {
            msg = JSON.parse(msg || "[]");
          }
          const question = (Array.isArray(msg) ? msg[0] : msg) || {};
          questionContent = extractTextContent(question.content);
          userFiles = question.user_files || [];
        } catch {
          questionContent = "";
        }

        // Parse answer with error handling (与 Vue 对齐)
        let answerContent = item.answer || "";
        try {
          const parsedAnswer = answerContent && JSON.parse(answerContent);
          if (parsedAnswer && typeof parsedAnswer === "object") {
            if (isParsedAnswerError(parsedAnswer)) {
              answerContent = t("agent_app.failed_tip") || "请求失败";
            } else {
              // answer 也可能是数组格式
              answerContent = extractTextContent(parsedAnswer);
            }
          } else if (
            !parsedAnswer ||
            (typeof parsedAnswer === "string" && parsedAnswer.includes("Invalid token"))
          ) {
            answerContent = t("agent_app.failed_tip") || "请求失败";
          }
        } catch (err) {
          if (isParsedAnswerCatchError(answerContent)) {
            answerContent = t("agent_app.failed_tip") || "请求失败";
          }
        }

        return {
          question: {
            content: questionContent,
            user_files: userFiles,
          },
          answer: {
            content: answerContent,
            loading: false,
            reasoning_content: item.reasoning_content || "",
            reasoning_expanded: true,
          },
        };
      });

      setMessageList(formattedMessages);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
      setMessageList([]);
    } finally {
      setDetailLoading(false);
    }
  };

  // Copy text to clipboard
  const onCopy = async (text: string = "") => {
    await copyToClip(text);
    message.success(t("action_copy_success") || "复制成功");
  };

  // Handle pagination
  const handleTableChange = (page: number, pageSize: number) => {
    setFilterForm((prev) => ({ ...prev, page, pageSize }));
  };

  // Fetch on mount and filter change
  useEffect(() => {
    fetchData();
  }, [
    filterForm.date,
    filterForm.keyword,
    filterForm.page,
    filterForm.pageSize,
  ]);

  return (
    <div
      className={`h-full overflow-y-auto bg-white rounded-lg px-8 py-7 box-border overflow-hidden ${className || ""}`}
    >
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <div className="flex-none w-[250px]">
          <FilterDateRange
            value={filterForm.date}
            onChange={(date) =>
              setFilterForm((prev) => ({ ...prev, date, page: 1 }))
            }
          />
        </div>
        <div className="flex-1 w-0" />
        <Search
          mode="expanded"
          value={filterForm.keyword}
          onDebouncedChange={(val) => {
            setFilterForm((prev) => ({
              ...prev,
              keyword: val,
            }));
            fetchData();
          }}
          className="max-w-[268px]"
          placeholder={t(type === "agent" ? "user/mobile" : "keyword")}
        />
      </div>

      {/* Table */}
      <Table
        className="mt-5"
        columns={columns}
        dataSource={tableList}
        rowKey="id"
        loading={tableLoading}
        pagination={{
          current: filterForm.page,
          pageSize: filterForm.pageSize,
          total: tableTotal,
          showSizeChanger: true,
          onChange: handleTableChange,
        }}
        onRow={(record) => ({
          onClick: () => onRowClick?.(record) || handleDetail(record),
          className: "group cursor-pointer",
        })}
      />

      {/* Detail Drawer - 与 Vue 版本对齐，使用 Bubble 组件 */}
      <Drawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        title={t("dialogue_detail")}
        destroyOnHidden
        styles={{ wrapper: { width: 697 } }}
      >
        <Spin spinning={detailLoading}>
          {messageList.length === 0 ? (
            <div className="text-center text-gray-500 py-8">{t("no_data") || "暂无对话记录"}</div>
          ) : (
            <XBubbleList messages={messageList} className="px-4 relative py-4">
              {messageList.map((msg, index) => (
                <div key={index}>
                  <XBubbleUser
                    content={msg.question.content}
                    files={msg.question.user_files}
                    menu={
                      !msg.answer.loading && (
                        <SvgIcon
                          name="copy"
                          width="16"
                          height="16"
                          className="cursor-pointer"
                          onClick={() => onCopy(msg.question.content)}
                        />
                      )
                    }
                  />
                  <XBubbleAssistant
                    content={msg.answer.content}
                    reasoning={msg.answer.reasoning_content}
                    reasoningExpanded={msg.answer.reasoning_expanded}
                    streaming={msg.answer.loading}
                    menu={
                      !msg.answer.loading && (
                        <SvgIcon
                          name="copy"
                          width="16"
                          height="16"
                          className="cursor-pointer"
                          onClick={() => onCopy(msg.answer.content)}
                        />
                      )
                    }
                  />
                </div>
              ))}
            </XBubbleList>
          )}
        </Spin>
      </Drawer>
    </div>
  );
}

export default DialogueRecord;
