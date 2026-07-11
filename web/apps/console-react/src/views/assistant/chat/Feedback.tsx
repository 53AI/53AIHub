import { Feedback } from "@/views/search/feedback/Feedback";

interface FeedbackProps {
  agentId?: string | number;
}

export default function ChatFeedback({ agentId }: FeedbackProps) {
  return <Feedback agentId={agentId} />;
}
