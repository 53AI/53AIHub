import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Spin, Empty, Button } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { sharesApi } from "@/api/modules/share";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { BubbleList, BubbleUser, BubbleAssistant } from "@km/hub-ui-x-react";
import { Chunk, Quotation, SpecifiedFiles } from "@/components/Chat";
import { getSimpleDateFormatString, decodeShortId, JSONParse } from "@km/shared-utils";
import { formatFileInfo } from "@/api/modules/files/transform";
import { buildUrl } from "@/utils/router";
import { t } from "@/locales";
import "./share.css";

type From = "agent" | "index" | "file";

interface CurrentFile {
  file_icon: string;
  file_id: string;
  library_id: string;
  file_name: string;
  library_name: string;
}

export function ShareChatView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isSoftStyle = useIsSoftStyle();
  const chunkRef = useRef<any>(null);
  const chunkSourceRef = useRef<any>(null);
  const isMountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ nickname: string; avatar: string } | null>(null);
  const [agent, setAgent] = useState<{ agent_id: string; name: string; logo: string } | null>(null);
  const [conversation, setConversation] = useState<{ created_time: string } | null>(null);
  const [messageList, setMessageList] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [space, setSpace] = useState("");
  const [currentFile, setCurrentFile] = useState<CurrentFile>({
    file_icon: "",
    file_id: "",
    library_id: "",
    file_name: "",
    library_name: "",
  });

  const shareId = searchParams.get("share_id");
  const from = (searchParams.get("from") as From) || "agent";
  const infoId = searchParams.get("info");

  const handleSourceReferenceHover = useCallback(
    (data: any, message: any) => {
      if (!localStorage.getItem("access_token")) return;
      if (chunkRef.current) {
        chunkRef.current.openWithSource && chunkRef.current.openWithSource(data, chunkSourceRef);
      }
    },
    []
  );

  const renderSource = useCallback(
    (type: string, number: number, message: any) => {
      if (message.rag_stats?.type === "web_search") {
        return number;
      }
      return from === "index" ? type + "-" + number : number;
    },
    [from]
  );

  const handleOpenAgent = useCallback(() => {
    if (from === "agent" && agent) {
      navigate(
        `${isSoftStyle ? "" : "/index"}/chat?agent_id=${agent.agent_id}`
      );
    } else if (from === "index") {
      navigate("/index");
    } else if (from === "file") {
      const file = messageList?.[0]?.rag_stats?.file_quotations?.[0];
      if (file) {
        const url = buildUrl(
          `/library/${file.library_id}/file/${file.file_id}?openAi=true`
        );
        window.open(url, "_blank");
      }
    }
  }, [from, agent, messageList, isSoftStyle, navigate]);

  const handleBackHome = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleClickFile = useCallback(() => {
    if (currentFile.file_id) {
      const url = buildUrl(
        `/library/${currentFile.library_id}/file/${currentFile.file_id}?openAi=true`
      );
      window.open(url, "_blank");
    }
  }, [currentFile]);

  useEffect(() => {
    isMountedRef.current = true;

    const formatRagStats = (ragStats: any) => {
      if (!ragStats) return null;

      const chunks = ragStats.document_search?.chunks || [];
      const document_quotations = ragStats.document_quotations || [];
      const file_quotations = ragStats.file_quotations || [];

      const filesSearch = chunks
        .filter((item: any) => ["web_page", "knowledge"].includes(item.chunk_type))
        .map((chunk: any) => {
          const file = formatFileInfo(chunk.file_name || "");
          return {
            ...chunk,
            library_id: String(chunk.library_id),
            file_id: String(chunk.file_id),
            file_name: file.fname || chunk.file_name,
            file_icon: file.icon,
          };
        });

      const fileIds = [...new Set(filesSearch.map((chunk: any) => chunk.file_id))];
      const libraryIds = [...new Set(filesSearch.map((chunk: any) => chunk.library_id))];

      const documentQuotations = document_quotations
        .map((chunk_id: any) => filesSearch.find((item: any) => item.chunk_id === String(chunk_id)))
        .filter(Boolean);

      const fileQuotations = file_quotations
        .map((file_id: any) => filesSearch.find((chunk: any) => chunk.file_id === String(file_id)))
        .filter(Boolean);

      return {
        ...ragStats,
        chunks: filesSearch,
        library_search: libraryIds
          .map((id: any) => filesSearch.find((chunk: any) => chunk.library_id === id))
          .filter(Boolean),
        files_search: fileIds
          .map((id: any) => filesSearch.find((chunk: any) => chunk.file_id === id))
          .filter(Boolean),
        document_quotations: documentQuotations,
        file_quotations: fileQuotations,
      };
    };

    const processMessages = (messages: any[]) => {
      const list = [];
      for (const item of messages) {
        const message = JSONParse(
          item.message,
          typeof item.message === "string" ? [{ role: "user", content: item.message }] : []
        );
        const userMessage = message.find((m: any) => m.role === "user") || { content: "" };
        const userInfo = message.find((m: any) => m.role === "info");

        let specified_files: any[] = [];
        let specified_content = "";
        let questionText = "";

        const userContent = JSONParse(userMessage.content, null);
        if (Array.isArray(userContent)) {
          const textItem = userContent.find((item: any) => item?.type === "text");
          questionText = textItem?.content || "";
        } else {
          const content = userMessage.content;
          questionText = typeof content === "string" ? content : (content?.text || content?.content || "");
        }

        if (userInfo) {
          const infoContent = JSONParse(userInfo.content, {});
          if (infoContent?.type === "specified_files") {
            specified_files = infoContent.list.map((fileItem: any) => {
              const file = formatFileInfo(fileItem.name, fileItem.isfolder);
              return { icon: file.icon, ...fileItem };
            });
          } else if (infoContent?.type === "specified_content") {
            specified_content = infoContent.content || "";
          }
        }

        list.push({
          ...item,
          question: questionText,
          answer: item.answer?.replaceAll("<decision>DONE</decision>", ""),
          rag_stats: formatRagStats(item.rag_stats, item.process_records),
          specified_files,
          specified_content,
        });
      }
      return list;
    };

    const loadShareData = async () => {
      if (!shareId) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const res = await sharesApi.find(shareId);
        if (!isMountedRef.current) return;

        const processedMessages = processMessages(res.messages || []);

        setMessageList(processedMessages);
        setUser(res.user);
        setAgent(res.agent);
        setConversation({
          created_time: getSimpleDateFormatString({
            date: res.conversation.created_time,
          }),
        });

        // 处理文件信息
        if (from === "file") {
          const fileQuotation = processedMessages?.[0]?.rag_stats?.file_quotations?.[0] || {};
          const fileNameInfo = formatFileInfo(res.messages?.[0]?.file_name || "");
          setCurrentFile({
            ...fileQuotation,
            file_name: fileNameInfo.fname || "",
          });
        }

        // 计算 title
        let computedTitle = "";
        let computedSpace = "";

        switch (from) {
          case "agent":
            computedTitle = `${res.user?.nickname || ""}与${res.agent?.name || "--"}的对话`;
            break;
          case "index":
            if (infoId) {
              try {
                const info = await decodeShortId(infoId);
                const parsed = JSON.parse(info);
                computedTitle = parsed.name || "--";
                computedSpace = parsed.space || "";
              } catch {
                computedTitle = "知识库对话";
              }
            } else {
              computedTitle = "知识库对话";
            }
            break;
          case "file":
            const fileName = formatFileInfo(res.messages?.[0]?.file_name || "").fname || "--";
            computedTitle = `${res.user?.nickname || ""}与文档《${fileName}》的对话`;
            break;
        }

        if (isMountedRef.current) {
          setTitle(computedTitle);
          setSpace(computedSpace);
        }
      } catch (error) {
        console.error("Failed to load share data:", error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    loadShareData();

    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]); // 只依赖 shareId，其他值稳定

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#F1F4FB]">
        <Spin size="large" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-[#F1F4FB]">
        <Empty description={t("chat.no_available_agent_desc")} />
        <Button type="primary" onClick={handleBackHome}>
          {t("common.back_home")}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#F1F4FB] overflow-hidden">
      <div className="w-11/12 md:w-[900px] h-[90%] overflow-hidden rounded-3xl m-auto bg-white flex flex-col">
        {/* Header */}
        <div className="flex-none h-[110px] flex items-center gap-2 max-md:h-20 border-b md:px-10 px-3">
          <img
            src={user?.avatar || "/images/default_avatar.png"}
            title={user?.nickname}
            className="w-14 h-14 rounded-full"
            alt=""
          />
          <div className="flex-1 flex flex-col justify-between items-start max-w-[calc(100%-68px)] md:max-w-[calc(100%-96px)]">
            {title && (
              <h2 className="md:text-xl text-[#1D1E1F] font-bold w-full truncate">
                {title}
              </h2>
            )}
            <div className="text-[#939499] text-sm">
              分享于{conversation?.created_time}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto h-[calc(100%-180px)] md:h-[calc(100%-232px)]">
          <BubbleList
            autoScroll={false}
            className="flex-1 md:px-10 px-3"
            mainClass="mt-5"
            messages={messageList}
          >
            {messageList.map((message: any, index: number) => (
              <div key={message.id}>
                {/* User message */}
                <BubbleUser
                  content={message.original_question || message.question}
                  files={message.user_files}
                  style={{
                    "--hubx-color-bg-message": "#EBF1FF",
                  }}
                  header={
                    from === "file" ? (
                      <SpecifiedFiles
                        files={message.specified_files}
                        content={message.specified_content}
                        isExpanded
                      />
                    ) : undefined
                  }
                />

                {/* Assistant message */}
                <BubbleAssistant
                  content={message.answer}
                  reasoning={message.reasoning_content}
                  reasoningExpanded={message.reasoning_expanded}
                  streaming={message.loading}
                  alwaysShowMenu={index === messageList.length - 1}
                  renderSource={(type: string, number: number) =>
                    renderSource(type, number, message)
                  }
                  sourceEnabled
                  onSourceReferenceHover={(data: any) =>
                    handleSourceReferenceHover(data, message)
                  }
                  footer={
                    <>
                      {from === "index" &&
                        message.rag_stats?.file_quotations?.length > 0 && (
                          <Quotation
                            type={message.rag_stats.type}
                            files={message.rag_stats.file_quotations}
                          />
                        )}
                      {from === "file" &&
                        index === messageList.length - 1 && (
                          <div
                            className="mt-5 pt-5 border-t border-dashed cursor-pointer"
                            onClick={handleClickFile}
                          >
                            <div className="text-sm mb-2">知识文档</div>
                            <div className="h-[88px] p-4 bg-[#F5F5F5] rounded-xl flex items-center">
                              <img
                                src={currentFile?.file_icon}
                                alt=""
                                className="size-12 md:size-14 rounded-md mr-3"
                              />
                              <div className="flex-1 flex flex-col justify-between max-w-[calc(100%-88px)] mr-2">
                                <div className="text-base md:text-lg w-full truncate">
                                  {currentFile?.file_name}
                                </div>
                                <div className="text-xs text-[#999999] w-full truncate">
                                  {space}/{currentFile?.library_name}
                                </div>
                              </div>
                              <div className="text-[#939499]">
                                <ArrowRightOutlined style={{ fontSize: 20 }} />
                              </div>
                            </div>
                          </div>
                        )}
                    </>
                  }
                />
              </div>
            ))}
          </BubbleList>
          <Chunk ref={chunkRef} />
        </div>

        {/* Footer */}
        <div className="flex-none h-[80px] md:h-[122px] flex items-center justify-center relative">
          <div
            className={`h-10 flex items-center gap-2 bg-[#2563EB] rounded-xl px-3 cursor-pointer hover:bg-[#1D5ECD] text-white ${
              from === "agent" ? "" : "w-11/12 md:w-[400px]"
            }`}
            onClick={handleOpenAgent}
          >
            {from === "agent" ? (
              <>
                <img
                  src={agent?.logo}
                  title={agent?.name}
                  className="h-6 rounded-full"
                  alt=""
                />
                <span className="text-sm truncate max-w-80">
                  跟"{agent?.name || "--"}"聊一聊
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl">💬</span>
                <div className="flex-1 flex flex-col justify-between">
                  <div>去知识库</div>
                  <div className="text-sm text-[#FCFDFF]">
                    知识库+联网搜索，解答更精准
                  </div>
                </div>
                <ArrowRightOutlined style={{ fontSize: 20 }} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShareChatView;
