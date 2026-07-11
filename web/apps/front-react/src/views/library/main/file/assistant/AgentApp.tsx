import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Tooltip, message, Spin } from "antd";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import conversationApi from "@/api/modules/conversation";
import fileBodiesApi from "@/api/modules/file-bodies";
import chatApi from "@/api/modules/chat";
import { useFileConversationStore } from "./conversation";
import "./AgentApp.css";

interface WorkflowOutput {
  id: string;
  label: string;
  type: string;
  variable: string;
  value: string;
}

interface AgentAppProps {
  agentInfo: any;
  fileInfo: any;
}

export interface AgentAppRef {
  regenerate: () => void;
}

const ERROR_INFO = {
  UPSTREAM_ERROR: "upstream_error",
  TOKEN_FAILED: "token验证失败",
  BAD_REQUEST: "BadRequest",
  PARAM_FAILED: "请求参数有误",
  AUTH_ERROR: "authentication_error",
  INVALID_REQUEST_ERROR: "invalid_request_error",
  RESOURCE_NOT_FOUND: "Resource not found",
  Unauthorized: "Unauthorized",
  InvalidApiKey: "InvalidApiKey",
};

const ERROR_TYPES = [
  ERROR_INFO.UPSTREAM_ERROR,
  ERROR_INFO.BAD_REQUEST,
  ERROR_INFO.AUTH_ERROR,
  ERROR_INFO.INVALID_REQUEST_ERROR,
  ERROR_INFO.Unauthorized,
];

const ERROR_MESSAGES = [
  ERROR_INFO.TOKEN_FAILED,
  ERROR_INFO.PARAM_FAILED,
  ERROR_INFO.RESOURCE_NOT_FOUND,
];

const isUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const AgentApp = forwardRef<AgentAppRef, AgentAppProps>(
  ({ agentInfo, fileInfo }, ref) => {
    const [messageList, setMessageList] = useState<any[]>([]);
    const [workflowResult, setWorkflowResult] = useState<WorkflowOutput[]>([]);
    const [workflowResultStr, setWorkflowResultStr] = useState("");
    const [curConversationId, setCurConversationId] = useState("");
    const [fullContent, setFullContent] = useState("");
    const [loading, setLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);

    const convStore = useFileConversationStore();
    const abortControllerRef = useRef<AbortController | null>(null);

    const isWorkflow = agentInfo?.is_workflow;

    const formatMessage = (item: any, currentAgent: any) => {
      const data = {
        ...item,
        id: item.id,
        question: "",
        answer: item.answer || item.content,
        loading: false,
        reasoning_content: item.reasoning_content || "",
        reasoning_expanded: true,
      };

      // Parse message content
      try {
        const content = JSON.parse(item.message)?.[0];
        if (content) {
          if (content.type === "text") {
            data.question = content.content;
          }
          if (Array.isArray(content)) {
            const textItem = content.find((item: any) => item.type === "text");
            if (textItem) data.question = textItem.content;
            data.user_files = content.filter(
              (item: any) => item.type === "image",
            );
          }
        }
      } catch {
        // Not JSON
      }

      // Check for error in answer
      try {
        const parsedAnswer = data.answer && JSON.parse(data.answer);
        if (parsedAnswer && typeof parsedAnswer === "object") {
          const type = parsedAnswer?.error?.type;
          const msg = parsedAnswer?.error?.message;
          if (ERROR_TYPES.includes(type) || ERROR_MESSAGES.includes(msg)) {
            data.answer = t("agent.failed_tip");
          }
          if (parsedAnswer?.status === 401) {
            data.answer = t("agent.failed_tip");
          }
          if (parsedAnswer?.code === ERROR_INFO.InvalidApiKey) {
            data.answer = t("agent.failed_tip");
          }
        } else if (
          (!parsedAnswer &&
            ["coze_agent_cn", "fastgpt_agent", "app_builder", "tencent", "maxkb_agent", "dify_agent", "prompt"].includes(
              currentAgent?.custom_config_obj?.agent_type,
            )) ||
          (typeof parsedAnswer === "string" &&
            parsedAnswer.includes("Invalid token"))
        ) {
          data.answer = t("agent.failed_tip");
        }
      } catch {
        if (
          data.answer?.startsWith("Upstream Error") ||
          data.answer?.includes("App access denied")
        ) {
          data.answer = t("agent.failed_tip");
        }
      }

      return data;
    };

    const getLatestConversation = async () => {
      if (!agentInfo?.agent_id || !fileInfo?.id) return false;

      setMessageList([]);
      setWorkflowResult([]);
      setWorkflowResultStr("");

      try {
        const res = await conversationApi.agentList(agentInfo.agent_id, {
          file_id: fileInfo.id,
          limit: 1,
        });
        const items = res?.items || res || [];

        if (items.length > 0) {
          const convId = items[0].id || items[0].conversation_id;
          setCurConversationId(convId);
          // 同步更新 Zustand store，确保后续操作能正确复用历史会话
          convStore.setCurrentState(agentInfo.agent_id, convId);
          // 添加到 conversations 数组，让 currentConversation getter 能找到
          convStore.addConversation({
            ...items[0],
            conversation_id: convId,
            id: convId,
          });

          const msgRes = await conversationApi.messasges(convId, { limit: 1 });
          const messages = msgRes?.messages || msgRes?.data?.messages || [];

          if (messages.length === 0) return false;

          if (isWorkflow) {
            const outputs =
              agentInfo?.output_fields?.map((item: WorkflowOutput) => ({
                id: item.id,
                label: item.label,
                type: item.type,
                variable: item.variable,
                value: messages[0]?.parsed_answer?.[item.variable] || "",
              })) || [];
            setWorkflowResult(outputs);
            setWorkflowResultStr(
              outputs.map((item) => `${item.value}`).join("\n"),
            );
          } else {
            const formattedMessages = messages.map((msg: any) =>
              formatMessage(msg, agentInfo),
            );
            setMessageList(formattedMessages);
          }
          return true; // 有历史消息
        }
        return false;
      } catch (error) {
        console.error("Failed to get latest conversation:", error);
        return false;
      }
    };

    const getFullContent = async () => {
      if (!fileInfo?.id) return;
      try {
        const res = await fileBodiesApi.find(String(fileInfo.id));
        // Truncate if over 100k
        if (res.content?.length > 100000) {
          setFullContent(res.content.slice(0, 100000));
        } else {
          setFullContent(res.content || "");
        }
      } catch (error) {
        console.error("Failed to get full content:", error);
      }
    };

    const replaceVariable = (val: string) => {
      if (!val) return "";
      const title = fileInfo?.name || "";
      const summary = fileInfo?.summary || "";
      const content = fullContent || "";
      return String(val)
        .replace(/\{#title#\}/g, title)
        .replace(/\{#summary#\}/g, summary)
        .replace(/\{#fullContent#\}/g, content);
    };

    const getQuestion = () => {
      if (!agentInfo) return;

      const question = agentInfo?.input_fields?.reduce(
        (acc: any, item: any) => {
          let result = replaceVariable(agentInfo?.field_mapping?.[item.id]);
          if (isWorkflow) {
            let value;
            if (
              [
                "tag",
                "file",
                "array_image",
                "array_audio",
                "array_video",
                "array_file",
              ].includes(item.type)
            ) {
              value = [];
            } else if (item.type === "select" && item.multiple) {
              value = [];
            } else if (item.type === "array_text") {
              value = [""];
            } else {
              value = "";
            }
            if (result) {
              if (Array.isArray(value)) {
                result = result.split(",") || [];
              } else {
                result = result || "";
              }
            }
          }
          if (result) {
            acc[item.variable] = result;
          }
          return acc;
        },
        {},
      );
      return question;
    };

    const createConversation = async (question: string) => {
      const currentConversation = convStore.currentConversation();
      if (currentConversation?.conversation_id) return currentConversation;

      const conversation = await convStore.createConversation(
        agentInfo?.agent_id,
        question,
        fileInfo?.id,
      );

      convStore.addConversation({
        ...conversation,
        id: conversation.conversation_id,
        virtual_id: (currentConversation as any)?.virtual_id,
      });
      convStore.setCurrentState(
        agentInfo?.agent_id,
        conversation.conversation_id,
        false,
      );

      return conversation;
    };

    const formatFiles = (userFiles: any[]): any[] =>
      userFiles?.map((item: any) => ({
        type: "image",
        content: `file_id:${item.id}`,
        filename: item.name,
        size: item.size,
        mime_type: item.mime_type,
        url: item.url,
      })) || [];

    const sendMessage = async (question: string) => {
      if (isStreaming) return;

      const userFiles = fileInfo?.id
        ? [
            {
              id: fileInfo.id,
              name: fileInfo.name,
              icon: fileInfo.icon,
              library_id: fileInfo.library_id,
            },
          ]
        : [];

      const conversation = await createConversation(question);

      const newMessage = {
        id: Date.now(),
        question,
        answer: "",
        loading: true,
        reasoning_content: "",
        reasoning_expanded: true,
        user_files: userFiles,
      };

      setMessageList((prev) => [...prev, newMessage]);

      setIsStreaming(true);
      abortControllerRef.current = new AbortController();

      const configs = JSON.parse(agentInfo?.configs || "{}");
      const completionParams = configs.completion_params || {};
      let processedLength = 0;

      try {
        let content = question;
        if (userFiles.length > 0) {
          content = JSON.stringify([
            { type: "text", content: question },
            ...formatFiles(userFiles),
          ]);
        }

        await chatApi.completions(
          {
            conversation_id: conversation?.conversation_id || useFileConversationStore.getState().current_conversationid,
            model: `agent-${agentInfo.agent_id}`,
            messages: [{ content, role: "user" }],
            frequency_penalty: 0,
            presence_penalty: 0,
            stream: true,
            temperature: 0,
            top_p: 0,
            ...completionParams,
          },
          {
            responseType: "stream",
            onDownloadProgress: (e: any) => {
              const fullResponse = e.event?.target?.response || "";
              const newChunk = fullResponse.substring(processedLength);
              processedLength = fullResponse.length;

              const lines = newChunk
                .split("\n")
                .filter(
                  (line: string) =>
                    line.trim() !== "" && line.trim() !== "data: [DONE]",
                );

              for (const line of lines) {
                if (line.startsWith("data:")) {
                  try {
                    const text = line.split(/data\:\s*/g);
                    const data = JSON.parse(text[1]);
                    const content = data.choices?.[0]?.delta?.content;
                    const reasoningContent =
                      data.choices?.[0]?.delta?.reasoning_content;
                    const messageId = data.message_id;

                    // 更新最后一条消息（与 Vue 版本保持一致）
                    setMessageList((prev) => {
                      if (prev.length === 0) return prev;
                      const lastIndex = prev.length - 1;
                      const lastMsg = prev[lastIndex];
                      let newAnswer = lastMsg.answer;
                      if (content) {
                        if (
                          content.startsWith("Upstream Error") ||
                          content.startsWith("Error: 当前应用模型余额不足")
                        ) {
                          newAnswer = t("agent.failed_tip");
                        } else {
                          newAnswer += content;
                        }
                      }
                      const newMsg = {
                        ...lastMsg,
                        answer: newAnswer,
                        reasoning_content: reasoningContent
                          ? lastMsg.reasoning_content + reasoningContent
                          : lastMsg.reasoning_content,
                        id: messageId || lastMsg.id,
                      };
                      return [...prev.slice(0, lastIndex), newMsg];
                    });
                  } catch {
                    // Parse error, ignore
                  }
                }
              }
            },
            signal: abortControllerRef.current?.signal,
          },
        );
      } catch (err: any) {
        if (err.message !== "canceled") {
          message.warning(t("agent.failed_tip"));
          // 更新最后一条消息为错误状态
          setMessageList((prev) => {
            if (prev.length === 0) return prev;
            const lastIndex = prev.length - 1;
            return [
              ...prev.slice(0, lastIndex),
              { ...prev[lastIndex], answer: t("agent.failed_tip"), loading: false },
            ];
          });
        }
      } finally {
        // 更新最后一条消息的 loading 状态（与 Vue 版本保持一致）
        setMessageList((prev) => {
          if (prev.length === 0) return prev;
          const lastIndex = prev.length - 1;
          return [
            ...prev.slice(0, lastIndex),
            { ...prev[lastIndex], loading: false },
          ];
        });
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    };

    const runWorkflow = async (question: any) => {
      if (loading) return;

      setWorkflowResult([]);
      setWorkflowResultStr("");
      setLoading(true);

      try {
        const conversation = await createConversation(question.input || "");

        const data = {
          conversation_id: conversation.conversation_id,
          model: `agent-${agentInfo.agent_id}`,
          parameters: question,
          stream: true,
        };

        const response = await chatApi.workflow.run(data, {
          responseType: "stream",
        });

        const res = JSON.parse(response);
        const output = agentInfo?.output_fields?.reduce(
          (result: WorkflowOutput[], item: WorkflowOutput) => {
            if (!res.data?.workflow_output_data?.[item.variable]) return result;
            result.push({
              id: item.id,
              label: item.label,
              type: item.type,
              variable: item.variable,
              value: res.data.workflow_output_data[item.variable] || "",
            });
            return result;
          },
          [],
        );

        setWorkflowResult(output || []);
        setWorkflowResultStr(
          output?.map((item) => `${item.value}`).join("\n") || "",
        );
      } catch (error) {
        console.error("Workflow run failed:", error);
        message.error(t("agent.failed_tip"));
      } finally {
        setLoading(false);
      }
    };

    const handleSendMessage = async () => {
      const question = getQuestion();
      if (!isWorkflow) {
        setMessageList([]);
        await sendMessage(question?.input || "");
      } else {
        await runWorkflow(question);
      }
    };

    const handleRegenerate = async () => {
      if (!fullContent) {
        await getFullContent();
      }
      await handleSendMessage();
    };

    const handleCopy = async (text: string) => {
      await copyToClip(text);
      message.success(t("action.copy_success"));
    };

    // Get URL from object value
    const getSrc = (value: any, id: string): string => {
      if (typeof value === "object" && value !== null) {
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            const val = value[key];
            if (typeof val === "string" && isUrl(val)) {
              return val;
            }
          }
        }
        setWorkflowResult((prev) => prev.filter((item) => item.id !== id));
        message.error(t("chat.not_found_url"));
      }
      return value;
    };

    useImperativeHandle(ref, () => ({
      regenerate: handleRegenerate,
    }));

    useEffect(() => {
      let cancelled = false;

      const initAgentApp = async () => {
        if (!agentInfo?.agent_id || !fileInfo?.id) return;

        const hasHistory = await getLatestConversation();
        if (cancelled) return;

        // 如果没有历史消息，自动触发生成（与 Vue 版本保持一致）
        if (!hasHistory) {
          await getFullContent();
          if (cancelled) return;
          await handleSendMessage();
        }
      };

      initAgentApp();

      return () => {
        cancelled = true;
      };
    }, [agentInfo?.agent_id, fileInfo?.id]);

    if (!isWorkflow) {
      // Non-workflow mode: show message list
      return (
        <div className="px-5">
          <div className="agent-app-bubble-list flex-1 mt-4">
            {messageList.map((msg) => (
              <div key={msg.id} className="flex-1">
                <div className="assistant-message p-4 bg-[#F7F8FA] rounded-lg">
                  {msg.loading ? (
                    <div className="flex items-center gap-2">
                      <SvgIcon name="loading" className="animate-spin" />
                      <span className="text-gray-500">
                        {t("chat.completion_thinking")}
                      </span>
                    </div>
                  ) : (
                    <div className="prose max-w-none">{msg.answer}</div>
                  )}
                  {!msg.loading && (
                    <div className="flex items-center gap-2 mt-2">
                      <Tooltip title={t("action.copy")}>
                        <div
                          className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
                          onClick={() => handleCopy(msg.answer)}
                        >
                          <SvgIcon name="copy" className="text-[#9B9B9B]" />
                        </div>
                      </Tooltip>
                      <Tooltip title={t("chat.regenerate")}>
                        <div
                          className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
                          onClick={handleRegenerate}
                        >
                          <SvgIcon name="refresh" className="text-[#9B9B9B]" />
                        </div>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Workflow mode: show workflow result
    return (
      <div className="px-5">
        <div className="w-full max-h-[78vh] overflow-y-auto p-4 mt-4 bg-[#F7F8FA] rounded-lg">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Spin size="large" />
            </div>
          )}
          {!loading &&
            workflowResult.map((item) => (
              <div key={item.id}>
                <div className="text-sm text-[#1D1E1F] mt-2">
                  {item.type === "markdown" && (
                    <div
                      className="prose"
                      dangerouslySetInnerHTML={{ __html: item.value }}
                    />
                  )}
                  {item.type?.includes("image") && (
                    <div className="overflow-hidden flex flex-col gap-5">
                      {(Array.isArray(item.value)
                        ? item.value
                        : [item.value]
                      ).map((src, index) => (
                        <img
                          key={index}
                          src={src}
                          className="max-w-full h-auto object-contain rounded"
                          alt=""
                        />
                      ))}
                    </div>
                  )}
                  {item.type?.includes("video") && (
                    <div className="overflow-hidden flex flex-col gap-5">
                      {(Array.isArray(item.value)
                        ? item.value
                        : [item.value]
                      ).map((src, index) => (
                        <video
                          key={index}
                          src={getSrc(src, item.id)}
                          controls
                          className="max-w-full h-auto"
                        />
                      ))}
                    </div>
                  )}
                  {item.type?.includes("audio") && (
                    <div className="overflow-hidden flex flex-col gap-5">
                      {(Array.isArray(item.value)
                        ? item.value
                        : [item.value]
                      ).map((src, index) => (
                        <audio
                          key={index}
                          src={getSrc(src, item.id)}
                          controls
                          className="max-w-full"
                        />
                      ))}
                    </div>
                  )}
                  {item.type?.includes("text") && (
                    <div>
                      {(Array.isArray(item.value)
                        ? item.value
                        : [item.value]
                      ).map((text, index) => (
                        <p
                          key={index}
                          className="whitespace-pre-wrap break-all"
                        >
                          {text}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <Tooltip title={t("action.copy")}>
            <div
              className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
              onClick={() => handleCopy(workflowResultStr)}
            >
              <SvgIcon name="copy" className="text-[#9B9B9B]" />
            </div>
          </Tooltip>
          <Tooltip title={t("chat.regenerate")}>
            <div
              className="h-6 px-1 rounded flex items-center justify-center cursor-pointer hover:bg-[#E1E2E3]"
              onClick={handleRegenerate}
            >
              <SvgIcon name="refresh" className="text-[#9B9B9B]" />
            </div>
          </Tooltip>
        </div>
      </div>
    );
  },
);

AgentApp.displayName = "AgentApp";

export { AgentApp };
export default AgentApp;
