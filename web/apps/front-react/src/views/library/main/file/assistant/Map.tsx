import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Spin, message, Button } from "antd";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { getPublicPath } from "@/utils/config";
import { MessageMenu, FeedbackPanel } from "@/components/Chat";
import { BubbleAssistant } from "@km/hub-ui-x-react";
import { filesApi } from "@/api/modules/files";
import conversationApi from "@/api/modules/conversation";
import { usePoll } from "@/hooks/usePoll";
import { useChatFeedback } from "@km/shared-business/chat";
import "./Map.css";

interface MapProps {
  agentInfo: any;
  fileInfo: any;
  autoSelectEnabled?: boolean;
  onMermaidClick?: (event: any) => void;
}

export interface MapRef {
  regenerate: () => void;
}

const MapAssistant = forwardRef<MapRef, MapProps>(
  ({ agentInfo, fileInfo, autoSelectEnabled = false, onMermaidClick }, ref) => {
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [count, setCount] = useState(0);
    const [msg, setMsg] = useState<any>({
      answer: "",
      id: "",
      original_question: "",
      question: "",
      feedback_type: "",
      description: "",
      feedbackId: "",
      feedbackVisible: false,
      submitBtnDisabled: true,
      feedbackSuccessful: false,
      feedbackTypeOptions: new Map<string, boolean>(),
      showErrorDetails: false,
    });

    const {
      loadFeedbackConfig,
      handleClickFeedbackBtn: handleClickFeedbackBtnBase,
      handleToggleFeedbackBtn,
      handleCloseFeedback,
      handleSubmitFeedback,
      loadMessageFeedback,
      resetFeedbackSuccessState,
    } = useChatFeedback();

    const countRef = useRef(count);

    const { start: startPoll, stop: stopPoll } = usePoll(async () => {
      countRef.current += 3;
      setCount(countRef.current);

      if (!agentInfo?.agent_id || !fileInfo?.id) return;

      const res = await conversationApi.agentMessages(agentInfo.agent_id, {
        file_id: fileInfo.id,
      });
      if (res.messages?.length > 0) {
        const newMessage = res.messages[0];
        if (newMessage.id !== msg.id) {
          stopPoll();
          setGenerating(false);
          loadMessages();
        }
      }
    }, 3000);

    const loadMessages = async () => {
      if (!agentInfo?.agent_id || !fileInfo?.id) return;

      setLoading(true);
      try {
        const res = await conversationApi.agentMessages(agentInfo.agent_id, {
          file_id: fileInfo.id,
        });
        const messages = res.messages || [];

        if (messages.length > 0) {
          const firstMsg = messages[0];

          // Load feedback
          const feedbackParams = await loadMessageFeedback(firstMsg.id);

          setMsg({
            ...firstMsg,
            id: firstMsg.id,
            answer: firstMsg.answer,
            original_question: firstMsg.original_question,
            question: firstMsg.file_name,
            ...feedbackParams,
          });
          filesApi.recordQueryMap(fileInfo.id);
        } else {
          // Use knowledge_map from fileInfo if available
          const raw = fileInfo.knowledge_map ?? "";
          // Process the knowledge map format - same as Vue
          // root(( )) 固定结构，只去掉双括号内部的 () 内容，如 (2)、(副本)
          const processedAnswer = raw.replace(
            /root\(\(((?:[^()]|\([^)]*\))*)\)\)/g,
            (_, inner) => "root((" + inner.replace(/\([^)]*\)/g, "") + "))",
          );
          setMsg((prev: any) => ({ ...prev, id: "", answer: processedAnswer }));
        }
      } catch (error) {
        console.error("Failed to load messages:", error);
      } finally {
        setLoading(false);
      }
    };

    const handleGenerateKnowledgeMap = async () => {
      if (generating || !fileInfo?.id) return;

      countRef.current = -3;
      setCount(countRef.current);
      setGenerating(true);

      try {
        await filesApi.generateKnowledgeMap(fileInfo.id);
        startPoll();
      } catch (error) {
        console.error("Failed to generate knowledge map:", error);
        setGenerating(false);
        message.error(t("action.generate_failed"));
      }
    };

    const handleClickFeedbackBtn = async (
      type: "satisfied" | "unsatisfied",
    ) => {
      if (!msg.id) {
        message.warning(t("library.regenerate_knowledge_map"));
        return;
      }
      const updatedMsg = await handleClickFeedbackBtnBase(msg, type);
      setMsg(updatedMsg);
    };

    const handleMermaidClickEvent = (event: any) => {
      onMermaidClick?.(event);
    };

    useImperativeHandle(ref, () => ({
      regenerate: handleGenerateKnowledgeMap,
    }));

    useEffect(() => {
      loadMessages();
      loadFeedbackConfig("knowledge_map");
    }, [agentInfo?.agent_id, fileInfo?.id]);

    if (loading) {
      return (
        <div className="h-full overflow-y-auto p-5 flex items-center justify-center">
          <Spin size="large" />
        </div>
      );
    }

    if (generating) {
      return (
        <div className="h-full overflow-y-auto p-5">
          <div className="max-w-[494px] mx-auto">
            <img
              src={getPublicPath("/images/library/ai_map_loading.png")}
              alt={t("library.knowledge_map")}
              className="w-full"
            />
            <div
              className="h-11 px-4 flex items-center gap-2 border rounded-xl mt-4 bg-[#FAFCFF]"
              style={{
                borderImage:
                  "linear-gradient(270deg, #FFC187 0%, #EA89DF 31.42%, #F884D9 63.62%, #66C0FF 100%) 8",
              }}
            >
              <div className="size-4 animate-spin">
                <SvgIcon name="refresh" className="text-[#2A82E4]" />
              </div>
              <p className="flex-1 text-sm text-[#1D1E1F]">
                {t("library.generating_knowledge_map")}（
                {t("library.elapsed_time")} {count} {t("time.seconds")}）
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (msg.answer) {
      return (
        <div className="h-full overflow-y-auto p-5">
          <BubbleAssistant
            content={msg.answer}
            mermaidClickable
            viewerClass="assistant-map-viewer"
            onMermaidClick={handleMermaidClickEvent}
          />
          <div className="flex items-center">
            <MessageMenu
              type="assistant"
              content={msg.answer}
              feedbackType={msg.feedback_type}
              features={{ feedback: !!msg.id, addAsFile: false }}
              onRegenerate={handleGenerateKnowledgeMap}
              onFeedback={(type) => handleClickFeedbackBtn(type)}
            />
          </div>

          <FeedbackPanel
            visible={msg.feedbackVisible}
            feedbackType={msg.feedback_type}
            feedbackTypeOptions={msg.feedbackTypeOptions}
            submitBtnDisabled={msg.submitBtnDisabled}
            feedbackSuccessful={msg.feedbackSuccessful}
            description={msg.description}
            onClose={() => {
              const updatedMsg = handleCloseFeedback(msg);
              setMsg(updatedMsg);
            }}
            onToggle={(key) => {
              const updatedMsg = handleToggleFeedbackBtn(msg, key);
              setMsg(updatedMsg);
            }}
            onSubmit={async () => {
              const updatedMessage = await handleSubmitFeedback(msg);
              setMsg(updatedMessage);
              // 2秒后重置成功状态
              setTimeout(() => {
                setMsg((prev: any) => ({ ...prev, feedbackSuccessful: false }));
              }, 2000);
            }}
            onDescriptionChange={(value) =>
              setMsg((prev: any) => ({ ...prev, description: value }))
            }
          />
        </div>
      );
    }

    // Empty state - show intro with banner image
    return (
      <div className="h-full overflow-y-auto p-5">
        <img
          src={getPublicPath("/images/library/ai_map_banner.png")}
          alt={t("library.knowledge_map")}
          className="w-full"
        />
        <div className="text-2xl text-[#1D1E1F] mt-5">
          {t("library.knowledge_map")}
        </div>
        <div className="text-sm text-[#999999] mt-1.5">
          {t("library.knowledge_map_desc")}
        </div>
        <div className="flex items-center gap-2 mt-5">
          <div className="text-sm text-[#1D1E1F]">{t("library.use_cases")}</div>
        </div>
        <div className="text-sm text-[#4F5052] mt-1.5">
          <p>- {t("library.use_case_1")}</p>
          <p>- {t("library.use_case_2")}</p>
          <p>- {t("library.use_case_3")}</p>
        </div>
        <div className="mt-7">
          <Button
            className="w-full"
            type="primary"
            size="large"
            onClick={handleGenerateKnowledgeMap}
          >
            {t("chat.start_generate")}
          </Button>
        </div>
        <div className="text-xs text-[#999999] text-center mt-3">
          {t("library.ai_disclaimer")}
        </div>
      </div>
    );
  },
);

MapAssistant.displayName = "MapAssistant";

export { MapAssistant };
export default MapAssistant;
