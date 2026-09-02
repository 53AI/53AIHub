import { useLibraryStore } from "@/stores/modules/library";
import { eventBus } from "@km/shared-utils";
import { t } from "@/locales";
import { IconAction } from "@km/shared-components-react";
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
    <IconAction
      title={t("library.document_chat")}
      size="medium"
      onClick={handleClick}
      activeClassName={assistantVisible ? "bg-[#F2F6FE]" : ""}
    >
      <img className="size-5" src={AI_ICON_URL} alt="" />
    </IconAction>
  );
}

export default AssistantBtn;