import { Switch } from "antd";
import { useAgentCreateAdapter } from "../../adapters";
import { useAgentForm } from "../../hooks";
import { CollapsibleSection } from "../shared/CollapsibleSection";

export function ExpandConfig() {
  // 使用 adapter 获取翻译函数
  const adapter = useAgentCreateAdapter();
  const t = adapter.t || ((key: string) => key);

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
        <CollapsibleSection
          title={t("app.file_parse")}
          actions={
            <Switch
              checked={fileParseEnable}
              onChange={(checked) => updateFileParse({ enable: checked })}
            />
          }
        >
          <div className="text-sm text-[#9CA3AF]">
            {t('agent.file_parse_tip')}
          </div>
        </CollapsibleSection>
      )}

      {supportImage && (
        <CollapsibleSection
          title={t("app.image_parse")}
          actions={
            <Switch
              checked={imageParseEnable}
              onChange={(checked) => updateImageParse({ enable: checked })}
            />
          }
        >
          <div className="text-sm text-[#9CA3AF]">
            {t('agent.image_parse_tip')}
          </div>
        </CollapsibleSection>
      )}
    </>
  );
}

export default ExpandConfig;
