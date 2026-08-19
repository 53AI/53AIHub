import { useEffect, useRef, useState } from "react";
import { Spin, message } from "antd";
import type { RecordingConfig } from "@/api/modules/recording/type";
import recordingApi from "@/api/modules/recording";
import { AssistantList } from "./components/AssistantList";
import { AGENT_USAGES } from "@/constants/agent";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";

interface DocumentAppProps {
  recordingConfig: RecordingConfig | null;
  onConfigChange?: (config: Partial<RecordingConfig>) => void;
  onLoading?: (loading: boolean) => void;
}

export function DocumentApp({
  recordingConfig,
  onConfigChange,
  onLoading,
}: DocumentAppProps) {
  const [isLoading, setIsLoading] = useState(false);
  // 防止快速连点时旧请求覆盖新状态
  const updateTokenRef = useRef(0);

  // "参谋洞察"开关（insight_regenerate_enabled）
  const handleInsightToggle = async (checked: boolean) => {
    const token = ++updateTokenRef.current;
    const previous = recordingConfig?.insight_regenerate_enabled ?? false;
    onConfigChange?.({ insight_regenerate_enabled: checked });
    try {
      await recordingApi.updateConfig({
        insight_regenerate_enabled: checked,
      });
      if (token !== updateTokenRef.current) return;
      message.success(
        checked ? t("action_enable_success") : t("action_disable_success"),
      );
    } catch (e) {
      if (token !== updateTokenRef.current) return;
      console.error(e);
      onConfigChange?.({ insight_regenerate_enabled: previous });
    }
  };

  useEffect(() => {
    onLoading?.(isLoading);
  }, [isLoading, onLoading]);

  return (
    <Spin
      spinning={isLoading}
      classNames={{
        root: "h-full",
        container: "h-full overflow-auto",
      }}
    >
      <div className="h-full bg-white py-5 px-2 overflow-auto">
        <AssistantList
          agentUsage={AGENT_USAGES.KM_RECORDING_CHAT}
          hideMap
          configCard={{
            titleKey: "module.staff_insight",
            descriptionKey: "module.staff_insight_desc",
            // 图标资源补齐前的占位：复用现有 compass 矢量图标
            icon: getPublicPath("/images/recording/insight.png"),
            enabled: !!recordingConfig?.insight_regenerate_enabled,
            onToggle: handleInsightToggle,
          }}
        />
      </div>
    </Spin>
  );
}

export default DocumentApp;