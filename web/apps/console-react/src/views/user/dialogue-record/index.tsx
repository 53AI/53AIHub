import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { t } from "@/locales";
import DialogueRecordView from "@/components/DialogueRecord/index";

export function UserDialogueRecordPage() {
  const { user_id } = useParams<{ user_id: string }>();

  const pageTitle = useMemo(() => {
    return t("dialogue_record");
  }, []);

  return (
    <div className="px-[60px] py-8">
      <h1 className="font-semibold text-gray-800 mb-4">{pageTitle}</h1>
      <div className="mt-5">
        <DialogueRecordView type="user" relatedId={user_id || ""} />
      </div>
    </div>
  );
}

export default UserDialogueRecordPage;
