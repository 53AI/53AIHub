import { Switch } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { t } from "@/locales";

interface SummaryConfigProps {
  config: {
    summary_faq?: { enabled: boolean };
    entity_extraction?: { enabled: boolean };
    knowledge_map?: { enabled: boolean };
  };
  onUpdateConfig?: (config: SummaryConfigProps["config"]) => void;
}

const SUMMARY_ITEMS = [
  {
    key: "summary_faq" as const,
    name: t("data_pipeline.summary_doc_summary"),
    desc: t("data_pipeline.summary_doc_summary_desc"),
    icon: "doc-detail",
    color: "#2563EB",
    bgColor: "#EBF1FF",
  },
  {
    key: "entity_extraction" as const,
    name: t("data_pipeline.summary_doc_tag"),
    desc: t("data_pipeline.summary_doc_tag_desc"),
    icon: "tag-one",
    color: "#EE7702",
    bgColor: "#FFF5EB",
  },
  {
    key: "knowledge_map" as const,
    name: t("data_pipeline.summary_knowledge_map"),
    desc: t("data_pipeline.summary_knowledge_map_desc"),
    icon: "circle-five-line",
    color: "#8063E3",
    bgColor: "#F1EDFF",
  },
];

export function SummaryConfig({ config, onUpdateConfig }: SummaryConfigProps) {
  // Helper function to update config
  const updateConfig = (patch: Partial<SummaryConfigProps["config"]>) => {
    onUpdateConfig?.({
      ...config,
      ...patch,
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="space-y-4">
        {SUMMARY_ITEMS.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between p-5 rounded-xl hover:shadow-md transition-all group"
            style={{
              backgroundColor: config[item.key]?.enabled ? "#F5F9FF" : "white",
            }}
          >
            <div className="flex items-center gap-4">
              <div
                className="size-12 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform"
                style={{ color: item.color, backgroundColor: item.bgColor }}
              >
                <SvgIcon name={item.icon} width={24} height={24} />
              </div>
              <div>
                <div className="text-sm font-bold text-gray-800">
                  {item.name}
                </div>
                <div className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">
                  {item.desc}
                </div>
              </div>
            </div>
            <Switch
              checked={config[item.key]?.enabled}
              onChange={(checked) => {
                if (config[item.key]) {
                  updateConfig({
                    [item.key]: {
                      ...config[item.key],
                      enabled: checked,
                    },
                  });
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default SummaryConfig;
