import { useState, Suspense, lazy, useRef, useMemo, useEffect } from "react";
import { Spin, Switch } from "antd";
import { PageLayoutTabs } from "@/components/PageLayout";
import { t } from "@/locales";
import type { RecordingConfig } from "@/api/modules/recording/type";
import recordingApi from "@/api/modules/recording";
import "./index.css";

const Setting = lazy(() => import("./Setting"));
const Statistic = lazy(() => import("./Statistic"));

export function RecordingPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [recordingConfig, setRecordingConfig] = useState<RecordingConfig | null>(null);
  const settingRef = useRef<any>(null);

  // 加载录音配置
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      try {
        const config = await recordingApi.getConfig();
        setRecordingConfig(config);
      } catch (e) {
        console.error("Failed to load recording config:", e);
      } finally {
        setIsLoading(false);
      }
    };
    loadConfig();
  }, []);

  const handleStatusChange = (enable: boolean) => {
    if (settingRef.current?.handleStatusChange) {
      settingRef.current.handleStatusChange(enable);
    }
  };

  // 更新录音配置（供 Setting 组件调用）
  const handleConfigChange = (config: Partial<RecordingConfig>) => {
    setRecordingConfig((prev) => prev ? { ...prev, ...config } : prev);
  };

  const tabs = useMemo(
    () => [
      {
        key: "setting",
        label: t("agent.app_setting"),
        children: (
          <Suspense fallback={<Spin />}>
            <Setting
              ref={settingRef}
              recordingConfig={recordingConfig}
              onConfigChange={handleConfigChange}
              onLoading={setIsLoading}
            />
          </Suspense>
        ),
      },
      {
        key: "statistic",
        label: t("agent.app_statistic"),
        children: (
          <Suspense fallback={<Spin />}>
            <Statistic />
          </Suspense>
        ),
      },
    ],
    [recordingConfig],
  );

  // 使用录音配置中的 enabled 状态
  const isEnabled = !!recordingConfig?.enabled;

  return (
    <PageLayoutTabs
      header={{
        title: t("module.recording"),
        description: t("recording.desc"),
        icon: {
          svgIcon: "voice_filled",
          customStyle: {
            background: "linear-gradient(135deg, #61A3FF 0%, #2563EB 100%)",
          },
        },
        right: (
          <div className="flex items-center gap-2">
            <Switch
              checked={isEnabled}
              onChange={handleStatusChange}
            />
            <span className="text-sm">
              {isEnabled ? t("action_enable") : t("action_disable")}
            </span>
          </div>
        ),
      }}
      tabs={tabs}
    />
  );
}

export default RecordingPage;
