import { Input, Button, Divider, message, Spin } from "antd";
import { useCallback, useEffect, useState } from "react";
import { t } from "@/locales";
import { useSettingStore } from "@/stores/modules/setting";
import { debounce } from "@/directive/debounce";

const STATISTICS_KEYS = {
  HEAD: "third_party_statistic_header",
  CSS: "third_party_statistic_css",
} as const;

interface SettingItem {
  setting_id: number;
  key: string;
  value: string;
}

export function StatisticsPage() {
  const settingStore = useSettingStore();
  const [loading, setLoading] = useState(false);
  const [head, setHead] = useState<SettingItem>({
    setting_id: 0,
    key: STATISTICS_KEYS.HEAD,
    value: "",
  });
  const [css, setCss] = useState<SettingItem>({
    setting_id: 0,
    key: STATISTICS_KEYS.CSS,
    value: "",
  });

  // Initialize data
  useEffect(() => {
    const initializeData = async () => {
      setLoading(true);
      try {
        const settingsData = await settingStore.loadListData();

        // Find and update head setting
        const headSetting = settingsData.find(
          (item) => item.key === STATISTICS_KEYS.HEAD,
        );
        if (headSetting) {
          setHead(headSetting as SettingItem);
        }

        // Find and update CSS setting
        const cssSetting = settingsData.find(
          (item) => item.key === STATISTICS_KEYS.CSS,
        );
        if (cssSetting) {
          setCss(cssSetting as SettingItem);
        }
      } finally {
        setLoading(false);
      }
    };

    initializeData();
  }, []);

  // Handle save
  const handleSave = useCallback(
    debounce(
      async () => {
        try {
          const [headResult, cssResult] = await Promise.all([
            settingStore.save(head.setting_id, {
              key: head.key,
              value: head.value,
            }),
            settingStore.save(css.setting_id, {
              key: css.key,
              value: css.value,
            }),
          ]);

          // Update setting IDs
          setHead((prev) => ({
            ...prev,
            setting_id: headResult.setting_id || 0,
          }));
          setCss((prev) => ({
            ...prev,
            setting_id: cssResult.setting_id || 0,
          }));

          message.success(t("action_save_success"));
        } catch (error) {
          console.error("Save statistics error:", error);
        }
      },
      1000,
      true,
    ),
    [head, css, settingStore],
  );

  return (
    <div className="h-full flex flex-col bg-white px-2 overflow-y-auto">
      <Spin spinning={loading}>
        <div className="flex-1 max-h-[calc(100vh-240px)] overflow-auto">
          {/* Page title and description */}
          <h1 className="font-semibold text-primary">
            {t("module.statistics_header_title")}
          </h1>
          <div className="text-disabled text-sm mt-4">
            {t("module.statistics_header_desc")}
          </div>

          {/* Head statistics code input */}
          <div className="text-disabled text-sm mt-6">
            {t("module.statistics_textarea_label_1")}
          </div>
          <Input.TextArea
            value={head.value}
            onChange={(e) =>
              setHead((prev) => ({ ...prev, value: e.target.value }))
            }
            className="mt-3 !w-[600px]"
            style={{ backgroundColor: "#f7f8fa", resize: "none" }}
            placeholder={t("module.statistics_textarea_label_1_example")}
            rows={8}
          />

          {/* CSS style code input */}
          <div className="text-disabled text-sm mt-6">
            {t("module.statistics_textarea_label_2")}
          </div>
          <Input.TextArea
            value={css.value}
            onChange={(e) =>
              setCss((prev) => ({ ...prev, value: e.target.value }))
            }
            className="mt-3 !w-[600px]"
            style={{ backgroundColor: "#f7f8fa", resize: "none" }}
            placeholder={t("module.statistics_textarea_label_2_example")}
            rows={8}
          />
        </div>

        {/* Footer actions */}
        <Divider />
        <div>
          <Button type="primary" onClick={handleSave}>
            {t("action_save")}
          </Button>
        </div>
      </Spin>
    </div>
  );
}

export default StatisticsPage;
