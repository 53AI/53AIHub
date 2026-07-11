import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Empty, Switch, message } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { CheckOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { graphTemplatesApi } from "@/api";
import type {
  GraphTemplateDetail,
  GraphTemplateEntity,
  GraphTemplateListItem,
  GraphTemplateRelation,
} from "@/api/modules/graph-templates/types";
import { api_host } from "@/utils/config";
import "./GraphConfig.css";

interface GraphGenerationConfig {
  graph_template_id?: string;
  enable_smart_match?: boolean;
  enable_smart_generation?: boolean;
}

interface GraphConfigProps {
  config: GraphGenerationConfig;
  manageable?: boolean;
  onChange?: (config: GraphGenerationConfig) => void;
}

const DEFAULT_GRAPH_LOGO = `${api_host}/api/images/library/graph-icon.png`;

export function GraphConfig({
  config,
  manageable = false,
  onChange,
}: GraphConfigProps) {
  const [templates, setTemplates] = useState<GraphTemplateListItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [selectedDetail, setSelectedDetail] =
    useState<GraphTemplateDetail | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  const isSmartMatchEnabled = useMemo(
    () => Boolean(config?.enable_smart_match),
    [config?.enable_smart_match],
  );
  const isSmartGenerateEnabled = useMemo(
    () => Boolean(config?.enable_smart_generation),
    [config?.enable_smart_generation],
  );

  const getConfigTemplateId = () => config?.graph_template_id || null;

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

  const updateConfig = useCallback(
    (patch: Partial<GraphGenerationConfig>) => {
      onChange?.({ ...config, ...patch });
    },
    [config, onChange],
  );

  const selectTemplate = useCallback(
    async (id: string, opts?: { syncConfig?: boolean }) => {
      if (!id) return;
      setSelectedTemplateId(id);
      if (opts?.syncConfig !== false) {
        updateConfig({ graph_template_id: id, enable_smart_match: false });
      }
      try {
        const detail = await graphTemplatesApi.get(id);
        setSelectedDetail(detail);
      } catch (error) {
        console.error("获取图谱模板详情失败", error);
        setSelectedDetail(null);
      }
    },
    [updateConfig],
  );

  const syncSelectionFromConfig = useCallback(async () => {
    if (isSmartMatchEnabled) {
      setSelectedTemplateId(null);
      return;
    }

    const id = getConfigTemplateId();
    if (!id) {
      if (templates.length) {
        await selectTemplate(templates[0].id);
        return;
      }
      setSelectedTemplateId(null);
      return;
    }

    if (templates.some((t) => t.id === id)) {
      await selectTemplate(id, { syncConfig: false });
      return;
    }

    if (templates.length) {
      await selectTemplate(templates[0].id);
      return;
    }

    setSelectedTemplateId(null);
    updateConfig({ graph_template_id: "" });
  }, [isSmartMatchEnabled, templates, selectTemplate, updateConfig]);

  const fetchTemplates = useCallback(async () => {
    setIsLoadingTemplates(true);
    try {
      const res = await graphTemplatesApi.list({ offset: 0, limit: 50 });
      const items = (res.items || []).map((item) => ({
        ...item,
        logo: item.logo || DEFAULT_GRAPH_LOGO,
      }));
      setTemplates(items);
    } catch (error) {
      console.error("获取图谱模板列表失败", error);
    } finally {
      setIsLoadingTemplates(false);
    }
  }, []);

  const handleSmartMatchChange = useCallback(
    (value: boolean) => {
      if (value) {
        setSelectedTemplateId(null);
        updateConfig({
          enable_smart_match: true,
          graph_template_id: "",
          enable_smart_generation: config?.enable_smart_generation ?? true,
        });
      } else {
        const firstTemplateId = templates[0]?.id || "";
        setSelectedTemplateId(firstTemplateId || null);
        updateConfig({
          enable_smart_match: false,
          graph_template_id: firstTemplateId,
          enable_smart_generation: false,
        });
      }
    },
    [templates, config?.enable_smart_generation, updateConfig],
  );

  const handleSmartGenerateChange = useCallback(
    (value: boolean) => {
      updateConfig({ enable_smart_generation: value });
    },
    [updateConfig],
  );

  const handleTemplateCardClick = useCallback(
    (id: string) => {
      if (isSmartMatchEnabled) return;
      selectTemplate(id);
    },
    [isSmartMatchEnabled, selectTemplate],
  );

  // Watch for config changes
  useEffect(() => {
    syncSelectionFromConfig();
  }, [
    config?.graph_template_id,
    config?.enable_smart_match,
    syncSelectionFromConfig,
  ]);

  // Initial load
  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const shownTemplates = useMemo(() => templates.slice(0, 3), [templates]);
  const moreTemplates = useMemo(() => templates.slice(3), [templates]);

  const handleManageTemplates = () => {
    console.log("Manage templates");
  };

  const moreMenuItems: MenuProps["items"] = [
    ...moreTemplates.map((t) => ({
      key: t.id,
      label: (
        <span
          className={`text-sm max-w-[120px] truncate ${t.id === selectedTemplateId ? "text-[#2563EB]" : "text-[#1D1E1F]"}`}
        >
          {t.name}
        </span>
      ),
      onClick: () => handleTemplateCardClick(t.id),
    })),
    ...(manageable
      ? [
          {
            key: "manage",
            type: "divider" as const,
          },
          {
            key: "manage-btn",
            label: (
              <div className="flex items-center">
                <SvgIcon name="setting2" size={16} className="text-[#2563EB]" />
                <span className="ml-1 text-sm text-[#2563EB]">管理模板</span>
              </div>
            ),
            onClick: handleManageTemplates,
          },
        ]
      : []),
  ];

  // Helper to split preview items
  const splitPreview = (
    value: unknown,
    maxShown = 2,
    field?: "name" | "predicate",
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

  return (
    <div className="flex flex-col justify-start relative w-full">
      <div className="flex flex-col justify-start">
        {/* 智能匹配开关 */}
        <div className="flex items-center gap-2 mb-5">
          <span className="text-base text-[#1D1E1F]">智能匹配</span>
          <Switch
            checked={isSmartMatchEnabled}
            onChange={handleSmartMatchChange}
          />
          <span className="text-sm text-[#9A9A9A]">{isSmartMatchEnabled ? '智能选择本体模板' : '手动选择本体模板'}</span>
        </div>

        {!isLoadingTemplates && templates.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity ${isSmartMatchEnabled ? "opacity-60 pointer-events-none" : ""}`}
          >
            {isLoadingTemplates ? (
              <>
                {[1, 2, 3, 4].map((idx) => (
                  <div
                    key={`loading-${idx}`}
                    className="flex flex-col bg-white border border-[#E8EEFA] rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="size-7 rounded-lg bg-slate-100 animate-pulse" />
                      <div className="h-5 bg-slate-100 rounded w-1/2 animate-pulse" />
                    </div>
                    <div className="space-y-2 mb-4">
                      <div className="h-4 bg-slate-100 rounded w-full animate-pulse" />
                      <div className="h-4 bg-slate-100 rounded w-4/5 animate-pulse" />
                    </div>
                    <div className="flex gap-2">
                      <div className="h-6 w-16 bg-slate-100 rounded animate-pulse" />
                      <div className="h-6 w-14 bg-slate-100 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </>
            ) : (
              templates.map((item) => (
                <div
                  key={item.id}
                  className={`flex flex-col bg-white border rounded-xl p-4 transition-all cursor-pointer relative ${
                    item.id === selectedTemplateId && !isSmartMatchEnabled
                      ? "border-[#2563EB] shadow-[0_0_0_2px_rgba(37,99,235,0.08)]"
                      : "border-[#E8EEFA] hover:border-[#C6D4F7]"
                  }`}
                  onClick={() => handleTemplateCardClick(item.id)}
                >
                  {item.id === selectedTemplateId && !isSmartMatchEnabled && (
                    <div className="absolute top-0 right-0">
                      <div className="w-0 h-0 border-t-[30px] border-t-[#2563EB] border-l-[30px] border-l-transparent rounded-tr-xl" />
                      <CheckOutlined
                        style={{ fontSize: 12 }}
                        className="absolute top-1 right-1 text-white"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <div className="size-7 rounded-lg bg-[#EBF1FF] overflow-hidden flex items-center justify-center">
                      <img
                        src={item.logo || DEFAULT_GRAPH_LOGO}
                        className="size-full object-cover"
                        alt=""
                      />
                    </div>
                    <h3
                      className="flex-1 text-base font-medium text-[#1D1E1F] truncate"
                      title={item.name}
                    >
                      {item.name}
                    </h3>
                  </div>
                  <p
                    className="text-sm text-[#999999] mb-4 min-h-[20px] line-clamp-1"
                    title={item.description}
                  >
                    {item.description || "暂无描述"}
                  </p>
                  <div className="flex items-center overflow-hidden">
                    <div className="flex items-center text-[#999999] gap-1 mr-3 shrink-0">
                      <SvgIcon name="application-two" size={16} />
                      <span className="text-xs">实体类型</span>
                    </div>
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                      {splitPreview(item.entities, 2, "name").shown.length >
                      0 ? (
                        <>
                          {splitPreview(item.entities, 2, "name").shown.map(
                            (name, idx) => (
                              <span
                                key={`${item.id}-entity-${name}-${idx}`}
                                className="px-2 py-1 bg-[#F7F7F8] text-[#4F5052] text-xs rounded whitespace-nowrap max-w-[80px] truncate"
                              >
                                {name}
                              </span>
                            ),
                          )}
                          {splitPreview(item.entities, 2, "name").more > 0 && (
                            <span className="px-2 py-1 bg-[#F7F7F8] text-[#2563EB] text-xs rounded shrink-0">
                              +{splitPreview(item.entities, 2, "name").more}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-[#999999]">暂无标签</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 智能匹配开启时显示智能生成选项 */}
        {isSmartMatchEnabled && (
          <>
            <div className="mt-5 flex items-center gap-2">
              <SvgIcon name="trending-down" size={16} />
              <span className="text-sm text-[#4F5052]">
                若无最匹配模板，将兜底执行
              </span>
            </div>
            <div className="mt-2 border border-[#E6E8EB] rounded-xl bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-10 rounded-md bg-[#EBF1FF] flex items-center justify-center">
                    <SvgIcon
                      name="globe"
                      size={16}
                      className="text-[#2563EB]"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-base text-[#1D1E1F]">智能生成</span>
                    <span className="text-sm text-[#9A9A9A]">
                      未匹配到本体模板时，将对文档进行智能抽取
                    </span>
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
