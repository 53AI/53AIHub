import { Switch } from "antd";
import { t } from "@/locales";
import { useAgentForm } from "../../hooks";

export function ExpandConfig() {
  // 使用 hook 获取状态和方法
  const {
    formData,
    supportImage,
    getSupportFile,
    updateFileParse,
    updateImageParse,
  } = useAgentForm();
  const supportFile = getSupportFile();
  const fileParseEnable = formData.settings.file_parse?.enable;
  const imageParseEnable = formData.settings.image_parse?.enable;

  // Only render if support_file or support_image
  if (!supportFile && !supportImage) {
    return null;
  }

  return (
    <>
      {supportFile && (
        <div className="flex items-center gap-2 mt-4">
          <div className="flex-1">
            <div className="text-sm text-secondary">
              {t("agent_file_parse")}
            </div>
          </div>
          <div className="flex-none text-sm text-secondary flex gap-2">
            {fileParseEnable ? t("action_open") : t("action_close")}
            <Switch checked={fileParseEnable} onChange={updateFileParse} />
          </div>
        </div>
      )}

      {supportImage && (
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1">
            <div className="text-sm text-secondary">
              {t("agent_image_parse")}
            </div>
          </div>
          <div className="flex-none text-sm text-secondary flex gap-2">
            {imageParseEnable ? t("action_open") : t("action_close")}
            <Switch checked={imageParseEnable} onChange={updateImageParse} />
          </div>
        </div>
      )}
    </>
  );
}

export default ExpandConfig;
