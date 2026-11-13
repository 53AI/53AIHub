import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapAssistant } from "./Map";

const { agentMessages } = vi.hoisted(() => ({ agentMessages: vi.fn() }));

vi.mock("@/locales", () => ({ t: (key: string) => key }));
vi.mock("@/utils/config", () => ({ getPublicPath: (path: string) => path }));
vi.mock("@km/shared-components-react", () => ({ SvgIcon: () => null }));
vi.mock("@/components/Chat", () => ({
  MessageMenu: () => null,
  FeedbackPanel: () => null,
}));
vi.mock("@km/hub-ui-x-react", () => ({
  BubbleAssistant: ({ content }: { content: string }) => (
    <div data-testid="map-answer">{content}</div>
  ),
}));
vi.mock("@/api/modules/files", () => ({
  filesApi: { recordQueryMap: vi.fn(), generateKnowledgeMap: vi.fn() },
}));
vi.mock("@/api/modules/conversation", () => ({ default: { agentMessages } }));
vi.mock("@/hooks/usePoll", () => ({
  usePoll: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@km/shared-business/chat", () => ({
  useChatFeedback: () => ({
    loadFeedbackConfig: vi.fn(),
    handleClickFeedbackBtn: vi.fn(),
    handleToggleFeedbackBtn: vi.fn(),
    handleCloseFeedback: vi.fn(),
    handleSubmitFeedback: vi.fn(),
    loadMessageFeedback: vi.fn().mockResolvedValue({}),
    resetFeedbackSuccessState: vi.fn(),
  }),
}));

describe("MapAssistant", () => {
  beforeEach(() => {
    agentMessages.mockResolvedValue({
      messages: [
        {
          id: "19515",
          answer: [
            "```mermaid",
            "mindmap",
            "  root((【4 技术规范】7 TSG Z8002-2022 特种设备检验人员考核规则(附2023年第1号修改单).pdf.md))",
            "    正文修改",
            "```",
          ].join("\n"),
        },
      ],
    });
  });

  it("normalizes the root label in the generated message before rendering", async () => {
    render(
      <MapAssistant
        agentInfo={{ agent_id: "178" }}
        fileInfo={{ id: "21455", knowledge_map: "" }}
      />,
    );

    const answer = await screen.findByTestId("map-answer");
    expect(answer.textContent).toContain(
      "root((【4 技术规范】7 TSG Z8002-2022 特种设备检验人员考核规则.pdf.md))",
    );
    expect(answer.textContent).not.toContain("(附2023年第1号修改单)");
  });
});
