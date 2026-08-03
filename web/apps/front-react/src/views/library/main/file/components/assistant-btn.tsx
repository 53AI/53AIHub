import { Tooltip } from "antd";
import { useLibraryStore } from "@/stores/modules/library";
import { eventBus } from "@km/shared-utils";
import { t } from "@/locales";
import { AI_ICON_URL } from "./sidebar-app-item";

export function AssistantBtn() {
  const assistantInstall = useLibraryStore((state) => state.assistantInstall);
  const assistantVisible = useLibraryStore((state) => state.assistantVisible);
  const setAssistantVisible = useLibraryStore(
    (state) => state.setAssistantVisible,
  );

  if (!assistantInstall) return null;

  const handleClick = () => {
    if (!assistantVisible) {
      setAssistantVisible(true);
      return;
    }
    eventBus.emit("assistant-toggle");
  };

  return (
    <Tooltip title={t("library.document_chat")}>
      <div
        role="button"
        aria-label={t("library.document_chat")}
        className={`size-8 flex-center rounded cursor-pointer hover:bg-[#F0F2F5] ${assistantVisible ? "bg-[#F0F2F5]" : ""}`}
        onClick={handleClick}
      >
        <img className="size-5" src={AI_ICON_URL} alt="" />
      </div>
    </Tooltip>
  );
}

export default AssistantBtn;