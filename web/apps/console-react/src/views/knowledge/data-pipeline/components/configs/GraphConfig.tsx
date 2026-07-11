import { useState, useEffect } from "react";
import { Empty, Switch } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { graphTemplatesApi } from "@/api/modules/graph-templates";
import type { GraphTemplateListItem } from "@/api/modules/graph-templates/types";
import { api_host } from "@/utils/config";

type GraphGenerationConfig = {
  graph_template_id?: string;
  enable_smart_match?: boolean;
  enable_smart_generation?: boolean;
};

interface GraphConfigProps {
  config: GraphGenerationConfig;
  manageable?: boolean;
  onUpdateConfig?: (value: GraphGenerationConfig) => void;
}

const DEFAULT_GRAPH_LOGO = `${api_host}/api/images/library/graph-icon.png`;

const safeParseArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const splitPreview = (
  value: unknown,
  maxShown = 2,
  field?: "name" | "predicate"
): { shown: string[]; more: number } => {
  const list = safeParseArray<unknown>(value)
    .map((item) => {
      if (field && typeof item === "object" && item !== null) {
        const fieldValue = (item as Record<string, unknown>)[field];
        return typeof fieldValue === "string" ? fieldValue : "";
      }
      return typeof item === "string" ? item : "";
    })
    .filter(Boolean);
  const shown = list.slice(0, maxShown);
  const more = Math.max(0, list.length - shown.length);
  return { shown, more };
};

export function GraphConfig({
  config,
  onUpdateConfig,
}: GraphConfigProps) {
  const [templates, setTemplates] = useState<GraphTemplateListItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  const isSmartMatchEnabled = Boolean(config?.enable_smart_match);
  const isSmartGenerateEnabled = Boolean(config?.enable_smart_generation);

  const updateConfig = (patch: Partial<GraphGenerationConfig>) => {
    onUpdateConfig?.({
      ...config,
      ...patch,
    });
  };

  const selectTemplate = async (id: string, opts?: { syncConfig?: boolean }) => {
    if (!id) return;
    setSelectedTemplateId(id);
    if (opts?.syncConfig !== false) {
      updateConfig({ graph_template_id: id, enable_smart_match: false });
    }
  };

  const handleTemplateCardClick = (id: string) => {
    if (isSmartMatchEnabled) return;
    selectTemplate(id);
  };

  const handleSmartMatchChange = (isEnabled: boolean) => {
    if (isEnabled) {
      setSelectedTemplateId(null);
      updateConfig({
        enable_smart_match: true,
        graph_template_id: "",
        enable_smart_generation: config?.enable_smart_generation ?? true,
      });
      return;
    }

    const firstTemplateId = templates[0]?.id || "";
    setSelectedTemplateId(firstTemplateId || null);
    updateConfig({
      enable_smart_match: false,
      graph_template_id: firstTemplateId,
      enable_smart_generation: false,
    });
  };

  const handleSmartGenerateChange = (value: boolean) => {
    updateConfig({ enable_smart_generation: value });
  };

  const syncSelectionFromConfig = async () => {
    if (isSmartMatchEnabled) {
      setSelectedTemplateId(null);
      return;
    }

    const id = config?.graph_template_id || null;
    if (!id) {
      if (templates.length) {
        await selectTemplate(templates[0].id);
        return;
      }
      setSelectedTemplateId(null);
      return;
    }

    if (templates.some((t) => t.id === id)) {
      setSelectedTemplateId(id);
      return;
    }

    if (templates.length) {
      await selectTemplate(templates[0].id);
      return;
    }

    setSelectedTemplateId(null);
    updateConfig({ graph_template_id: "" });
  };

  const fetchTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const res = await graphTemplatesApi.list({ offset: 0, limit: 50 });
      const items = (res.items || []).map((item) => ({
        ...item,
        logo: item.logo || DEFAULT_GRAPH_LOGO,
      }));
      setTemplates(items);

      // Sync selection after templates loaded
      if (!isSmartMatchEnabled) {
        const configTemplateId = config?.graph_template_id;
        if (configTemplateId && items.some((t) => t.id === configTemplateId)) {
          setSelectedTemplateId(configTemplateId);
        } else if (items.length) {
          await selectTemplate(items[0].id);
        }
      }
    } catch (error) {
      console.error("获取图谱模板列表失败", error);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  useEffect(() => {
    fetchTemplates().then(() => {
      syncSelectionFromConfig();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch config.graph_template_id changes
  useEffect(() => {
    syncSelectionFromConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.graph_template_id]);

  // Watch enable_smart_match changes
  useEffect(() => {
    if (isSmartMatchEnabled) {
      setSelectedTemplateId(null);
    } else {
      syncSelectionFromConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSmartMatchEnabled]);

  return (
    <div className="flex flex-col justify-start relative w-full">
      <div className="flex flex-col justify-start">
        {/* 智能匹配开关 */}
        <div className="flex items-center gap-2 mb-5">
          <span className="text-base text-primary">智能匹配</span>
          <Switch
            checked={isSmartMatchEnabled}
            onChange={handleSmartMatchChange}
          />
          <span className="text-sm text-disabled">{isSmartMatchEnabled ? '智能选择本体模板' : '手动选择本体模板'}</span>
        </div>

        {/* 模板列表 */}
        {!isLoadingTemplates && templates.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity">
            {isLoadingTemplates ? (
              // Loading skeletons
              [...Array(4)].map((_, idx) => (
                <div
                  key={`template-loading-${idx}`}
                  className="flex flex-col bg-white border border-[#E8EEFA] rounded-xl p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="size-7 rounded-lg bg-slate-100 animate-pulse"></div>
                    <div className="h-5 bg-slate-100 rounded w-1/2 animate-pulse"></div>
                  </div>
                  <div className="space-y-2 mb-4">
                    <div className="h-4 bg-slate-100 rounded w-full animate-pulse"></div>
                    <div className="h-4 bg-slate-100 rounded w-4/5 animate-pulse"></div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-6 w-16 bg-slate-100 rounded animate-pulse"></div>
                    <div className="h-6 w-14 bg-slate-100 rounded animate-pulse"></div>
                  </div>
                </div>
              ))
            ) : (
              templates.map((item) => {
                const isSelected = item.id === selectedTemplateId && !isSmartMatchEnabled;
                const entities = splitPreview(item.entities, 2, "name");
                return (
                  <div
                    key={item.id}
                    className={`flex flex-col bg-white border rounded-xl p-4 transition-all cursor-pointer relative ${
                      isSelected
                        ? "border-[#2563EB] shadow-[0_0_0_2px_rgba(37,99,235,0.08)]"
                        : "border-[#E8EEFA]"
                    } ${isSmartMatchEnabled ? "cursor-not-allowed" : "hover:border-[#C6D4F7]"}`}
                    onClick={() => handleTemplateCardClick(item.id)}
                  >
                    {isSelected && (
                      <div className="absolute top-0 right-0">
                        <div className="w-0 h-0 border-t-[30px] border-t-[#2563EB] border-l-[30px] border-l-transparent rounded-tr-xl"></div>
                        <CheckOutlined className="absolute top-1 right-1 text-white" style={{ fontSize: 10 }} />
                      </div>
                    )}

                    <div className="flex items-center gap-2 mb-3">
                      <div className="size-7 rounded-lg bg-[#EBF1FF] overflow-hidden flex items-center justify-center">
                        <img src={item.logo || DEFAULT_GRAPH_LOGO} className="size-full object-cover" alt={item.name} />
                      </div>
                      <h3 className="flex-1 text-base font-medium text-primary truncate" title={item.name}>
                        {item.name}
                      </h3>
                    </div>
                    <p className="text-sm text-placeholder mb-4 min-h-[20px] line-clamp-1" title={item.description}>
                      {item.description || "暂无描述"}
                    </p>
                    <div className="flex items-center overflow-hidden">
                      <div className="flex items-center text-placeholder gap-1 mr-3 shrink-0">
                        <SvgIcon name="application-two" width={16} height={16} />
                        <span className="text-xs">实体类型</span>
                      </div>
                      {entities.shown.length > 0 ? (
                        <div className="flex items-center gap-2 overflow-hidden flex-1">
                          {entities.shown.map((name, idx) => (
                            <span
                              key={`${item.id}-entity-${name}-${idx}`}
                              className="px-2 py-1 bg-[#F7F7F8] text-secondary text-xs rounded whitespace-nowrap max-w-[80px] truncate"
                            >
                              {name}
                            </span>
                          ))}
                          {entities.more > 0 && (
                            <span className="px-2 py-1 bg-[#F7F7F8] text-brand text-xs rounded shrink-0">
                              +{entities.more}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-placeholder">暂无标签</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 智能匹配开启时显示智能生成选项 */}
        {isSmartMatchEnabled && (
          <>
            <div className="mt-5 flex items-center gap-2">
              <SvgIcon name="trending-down" width={16} height={16} />
              <span className="text-sm text-secondary">若无最匹配模板，将兜底执行</span>
            </div>
            <div className="mt-2 border border-[#E6E8EB] rounded-xl bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-10 rounded-md bg-[#EBF1FF] flex items-center justify-center">
                    <SvgIcon name="globe" width={16} height={16} color="#2563EB" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-base text-primary">智能生成</span>
                    <span className="text-sm text-disabled">未匹配到本体模板时，将对文档进行智能抽取</span>
                  </div>
                </div>
                <Switch
                  checked={isSmartGenerateEnabled}
                  onChange={handleSmartGenerateChange}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default GraphConfig;
