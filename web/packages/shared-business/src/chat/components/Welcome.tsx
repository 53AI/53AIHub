import { memo } from "react";
import { BubbleAssistant } from "@km/hub-ui-x-react";
import { DEFAULT_AGENT_IMG } from "../stores/conversation";

export interface WelcomeProps {
  agentInfo: {
    agent_id?: number | string;
    name?: string;
    logo?: string;
    description?: string;
    user_group_ids?: number[];
    settings?: {
      opening_statement?: string;
      suggested_questions?: Array<{ id: string; content: string }>;
    };
  };
  onSuggestion?: (content: string) => void;
  className?: string;
  /** 渲染使用范围标签 - 如 AuthTagGroup */
  renderAuthTags?: (props: { userGroupIds: number[] }) => React.ReactNode;
}

function handleImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const target = e.target as HTMLImageElement;
  if (target.src.endsWith(DEFAULT_AGENT_IMG)) return;
  target.src = DEFAULT_AGENT_IMG;
}

function WelcomeInner({ agentInfo, onSuggestion, className, renderAuthTags }: WelcomeProps) {
  // 支持 settings 和 settings_obj 两种属性名
  const settings = agentInfo?.settings || (agentInfo as any)?.settings_obj || {};
  const openingStatement = settings.opening_statement || "";
  const suggestedQuestions = settings.suggested_questions || [];

  const showWelcome = openingStatement?.replace(/\s/g, "") ||
    (suggestedQuestions && suggestedQuestions.some((item: any) => item.content?.replace(/\s/g, "")));

  return (
    <div className={className}>
      {/* Agent Info Header */}
      <div
        className="w-full mt-2 flex items-center gap-3 box-border p-6 rounded-xl overflow-hidden"
        style={{
          background:
            "linear-gradient(90deg, rgba(243, 249, 254, 1) 0%, rgba(247, 243, 255, 1) 100%)",
        }}
      >
        <img
          className="flex-none size-10 rounded-full overflow-hidden"
          src={agentInfo?.logo || DEFAULT_AGENT_IMG}
          alt={agentInfo?.name || "Agent"}
          onError={handleImageError}
        />
        <div className="flex-1 flex flex-col gap-1">
          <div className="text-xl font-semibold text-[#1F2123]">
            {agentInfo?.name || "Agent"}
          </div>
          <div className="text-sm text-[#616264] break-words whitespace-pre-wrap">
            {agentInfo?.description || ""}
          </div>
        </div>
      </div>

      {/* Auth Tags / 使用范围 */}
      {renderAuthTags && (
        <div className="my-5">
          {renderAuthTags({ userGroupIds: agentInfo?.user_group_ids || [] })}
        </div>
      )}

      {/* Welcome Message */}
      {showWelcome && (
        <BubbleAssistant
          type="welcome"
          content={openingStatement}
          suggestions={suggestedQuestions}
          onSuggestion={(content: string) => onSuggestion?.(content)}
        />
      )}
    </div>
  );
}

const Welcome = memo(WelcomeInner);
Welcome.displayName = "Welcome";

export default Welcome;