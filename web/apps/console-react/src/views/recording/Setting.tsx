import {
    useState,
    useEffect,
    useImperativeHandle,
    forwardRef,
} from "react";
import { Button, message, Spin, Divider } from "antd";
import { t } from "@/locales";
import type { RecordingConfig } from "@/api/modules/recording/type";
import recordingApi from "@/api/modules/recording";
import { SelectPlus } from "@/components/SelectPlus";

export interface RecordingSettingRef {
  handleStatusChange: (enable: boolean) => void;
}

interface RecordingSettingProps {
  recordingConfig: RecordingConfig | null;
  onConfigChange?: (config: Partial<RecordingConfig>) => void;
  onLoading?: (loading: boolean) => void;
}

export const RecordingSetting = forwardRef<RecordingSettingRef, RecordingSettingProps>(
  ({ recordingConfig, onConfigChange, onLoading }, ref) => {
    const [isLoading, setIsLoading] = useState(false);
    const [form, setForm] = useState<{ settings: { parser_platform: string } }>({
      settings: {
        parser_platform: "",
      },
    });
    const [parseAppOptions, setParseAppOptions] = useState<any[]>([]);

    useEffect(() => {
      onLoading?.(isLoading);
    }, [isLoading, onLoading]);

    // 当录音配置变化时更新 form
    useEffect(() => {
      if (recordingConfig) {
        setForm({
          settings: {
            parser_platform: recordingConfig.parser_platform || "",
          },
        });
      }
    }, [recordingConfig]);

    useImperativeHandle(ref, () => ({
      handleStatusChange: async (enable: boolean) => {
        try {
          await recordingApi.updateConfig({
            enabled: enable,
            parser_platform: form.settings.parser_platform || "",
          });
          onConfigChange?.({ enabled: enable });
          message.success(
            enable ? t("action_enable_success") : t("action_disable_success"),
          );
        } catch (e) {
          console.error(e);
        }
      },
    }));

    const handleSave = async () => {
      try {
        await recordingApi.updateConfig({
          enabled: recordingConfig?.enabled ?? false,
          parser_platform: form.settings.parser_platform,
        });
        // 重新获取录音配置
        const newConfig = await recordingApi.getConfig();
        onConfigChange?.(newConfig);
        message.success(t("action_save_success"));
      } catch (e) {
        console.error(e);
      }
    };

    // 获取解析平台列表，只取通义听悟
    const loadParserPlatforms = async () => {
      setIsLoading(true);
      try {
        const platformsData = await recordingApi.getParserPlatforms();
        const tingwu = platformsData?.platforms?.find(
          (p) => p.platform_key === "tingwu" && p.configured,
        );
        if (tingwu) {
          setParseAppOptions([
            {
              label: tingwu.display_name,
              value: tingwu.platform_key,
              icon: window.$getPublicPath?.("/images/tools/tingwu.png"),
            },
          ]);
        } else {
          // 没有可用的解析平台，清空当前选择
          setParseAppOptions([]);
          setForm({
            settings: {
              parser_platform: "",
            },
          });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };

    useEffect(() => {
      loadParserPlatforms();
    }, []);

    return (
      <Spin
        spinning={isLoading}
        classNames={{
          root: "h-full",
          container: "flex flex-col h-full overflow-y-auto",
        }}
      >
        <div className="flex-1 flex flex-col bg-white mt-3 box-border">
          <div className="max-w-3xl">
            {/* 解析模型 */}
            <div className="flex mb-4">
              <div className="flex-none w-[80px] h-8 flex items-center">
                <div className="text-sm text-primary">
                  {t("recording.parse_model")}
                </div>
              </div>
              <div className="flex-1">
                <SelectPlus
                  value={form.settings.parser_platform}
                  onChange={(val) =>
                    setForm({
                      settings: {
                        parser_platform: val,
                      },
                    })
                  }
                  options={parseAppOptions}
                  useI18n={false}
                  className="w-[500px]"
                />
              </div>
            </div>
          </div>
        </div>

        <Divider />
        <div>
          <Button
            type="primary"
            onClick={handleSave}
            loading={isLoading}
          >
            {t("work_ai.publish_update")}
          </Button>
        </div>
      </Spin>
    );
  },
);

export default RecordingSetting;