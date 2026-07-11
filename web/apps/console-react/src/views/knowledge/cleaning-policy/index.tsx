import { useState, useEffect } from "react";
import { t } from "@/locales";
import { Button, Switch, Spin, message } from "antd";
import { RightOutlined, KeyOutlined, AppstoreOutlined } from "@ant-design/icons";
import { ragStrategyApi, ragPipelineApi } from "@/api";
import type { Strategy } from "@/api/modules/rag-strategy";

// Field labels
const getFieldLabel = (field: string, t: (key: string) => string) => {
  const keyMap: Record<string, string> = {
    extension: "cleaning_policy.field_extension",
    filename: "cleaning_policy.field_filename",
    foldername: "cleaning_policy.field_foldername",
    space_name: "cleaning_policy.field_space_name",
  };
  return keyMap[field] ? t(keyMap[field]) : field;
};

// Operator labels
const getOperatorLabel = (op: string, t: (key: string) => string) => {
  const keyMap: Record<string, string> = {
    in: "cleaning_policy.operator_in",
    contains: "cleaning_policy.operator_contains",
    eq: "cleaning_policy.operator_eq",
    starts_with: "cleaning_policy.operator_starts_with",
    ends_with: "cleaning_policy.operator_ends_with",
  };
  return keyMap[op] ? t(keyMap[op]) : op;
};

// Merge conditions with same type and operator
const getMergedConditions = (rule: Strategy) => {
  try {
    const conditionsJson =
      typeof rule.conditions_json === "string" && rule.conditions_json !== ""
        ? JSON.parse(rule.conditions_json)
        : rule.conditions_json;
    const matchers = conditionsJson?.matchers || [];
    const mergedMap = new Map<
      string,
      { type: string; operator: string; values: string[] }
    >();

    matchers.forEach(
      (cond: { type: string; operator: string; value: string | string[] }) => {
        const key = `${cond.type}_${cond.operator}`;
        const value = Array.isArray(cond.value)
          ? cond.value
          : [cond.value].filter(Boolean);

        if (mergedMap.has(key)) {
          const existing = mergedMap.get(key)!;
          existing.values.push(...value);
        } else {
          mergedMap.set(key, {
            type: cond.type,
            operator: cond.operator,
            values: [...value],
          });
        }
      },
    );

    mergedMap.forEach((group) => {
      group.values = Array.from(new Set(group.values));
    });

    return Array.from(mergedMap.values());
  } catch {
    return [];
  }
};

// Rule item component
interface RuleItemProps {
  rule: Strategy;
  index: number;
  pipelines: { value: string; label: string; icon: string }[];
  t: (key: string) => string;
  onToggle: (rule: Strategy) => void;
  getPipelineIcon: (id: string | number) => string;
}

function RuleItem({
  rule,
  index,
  pipelines,
  t,
  onToggle,
  getPipelineIcon,
}: RuleItemProps) {
  const mergedConditions = getMergedConditions(rule);

  return (
    <div className="bg-white rounded-lg shadow hover:shadow-lg transition-all group relative">
      <div className="flex items-stretch">
        {/* Index */}
        <div className="w-14 flex-none flex flex-col items-center justify-center gap-2 bg-gray-50">
          <div className="text-[10px] text-gray-400 font-mono">
            #{index + 1}
          </div>
        </div>

        {/* Rule content */}
        <div className="flex-1 space-y-2 pl-5 py-4">
          <div className="flex items-center justify-between">
            <div className="text-base font-medium">{rule.name}</div>
          </div>

          {/* Condition -> Action */}
          <div
            className="grid overflow-hidden"
            style={{ gridTemplateColumns: "1fr auto auto auto" }}
          >
            <div className="min-h-10 px-4 py-2 rounded-lg flex items-center gap-2 text-xs flex-wrap bg-gray-50">
              <span className="text-gray-400">{t("cleaning_policy.when")}</span>
              {mergedConditions.map((group, gIdx) => (
                <span key={gIdx} className="flex items-center gap-1">
                  {gIdx > 0 && (
                    <span className="text-blue-500 font-medium mx-1">
                      {rule.logic === 2
                        ? t("cleaning_policy.or")
                        : t("cleaning_policy.and")}
                    </span>
                  )}
                  <span className="text-gray-600">
                    {getFieldLabel(group.type, t)}
                  </span>
                  <span className="text-gray-400">
                    {getOperatorLabel(group.operator, t)}
                  </span>
                  <div className="flex flex-wrap gap-1.5 ml-1">
                    {group.values.map((val, vIdx) => (
                      <span
                        key={vIdx}
                        className="px-2 py-0.5 bg-blue-50 text-blue-500 rounded border border-blue-200 text-[11px]"
                      >
                        {val}
                      </span>
                    ))}
                  </div>
                </span>
              ))}
            </div>
            <div className="min-h-10 flex items-center justify-center px-3">
              <RightOutlined className="text-gray-300" />
            </div>
            <div className="min-h-10 flex items-center">
              <div className="h-10 px-2 max-w-40 flex items-center gap-1.5 bg-green-50 text-green-600 rounded text-sm border border-green-200">
                {getPipelineIcon(rule.pipeline_id) && (
                  <img
                    src={getPipelineIcon(rule.pipeline_id)}
                    className="flex-shrink-0 w-4 h-4"
                    alt=""
                  />
                )}
                <span className="flex-1 truncate">{rule.pipeline_name}</span>
              </div>
            </div>
            <div className="flex-none w-[100px]" />
          </div>
        </div>

        {/* Actions - only toggle */}
        <div className="flex items-center gap-4 pr-5">
          <Switch
            checked={rule.enabled}
            onChange={(checked) => onToggle({ ...rule, enabled: checked })}
          />
        </div>
      </div>
    </div>
  );
}

// Main component
export function KnowledgeCleaningPolicy() {
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<Strategy[]>([]);
  const [defaultRule, setDefaultRule] = useState<Strategy | null>(null);
  const [pipelines, setPipelines] = useState<
    { value: string; label: string; icon: string }[]
  >([]);

  // Get pipeline icon
  const getPipelineIcon = (id: string | number) => {
    return pipelines.find((p) => p.value === id)?.icon || "";
  };

  // Load pipelines
  const loadPipelines = async () => {
    const data = await ragPipelineApi.getList();
    setPipelines(
      data.map((p) => ({
        value: p.id,
        label: p.name,
        icon: p.icon,
      })),
    );
  };

  // Transform strategy to rule format
  const transformStrategyToRule = (strategy: Strategy): Strategy => {
    const isDefault = strategy.priority === 9999;
    const defaultConditionsJson = {
      matchers: [{ type: "extension", operator: "eq", value: "" }],
    };
    try {
      const conditionsJson =
        typeof strategy.conditions_json === "string" &&
        strategy.conditions_json !== ""
          ? JSON.parse(strategy.conditions_json)
          : strategy.conditions_json;
      return {
        ...strategy,
        conditions_json: conditionsJson?.matchers
          ? conditionsJson
          : defaultConditionsJson,
        is_default: isDefault,
      };
    } catch {
      return {
        ...strategy,
        conditions_json: defaultConditionsJson,
        is_default: isDefault,
      };
    }
  };

  // Load rules
  const loadRules = async () => {
    setLoading(true);
    try {
      const strategies = await ragStrategyApi.getList();
      const transformed = strategies.map(transformStrategyToRule);
      const defaultItem = transformed.find((s) => s.is_default);
      setDefaultRule(defaultItem || null);
      setRules(transformed.filter((s) => !s.is_default));
    } finally {
      setLoading(false);
    }
  };

  // Handle toggle
  const handleToggle = async (rule: Strategy) => {
    await ragStrategyApi.update(rule.id, { enabled: rule.enabled });
    setRules(rules.map((r) => (r.id === rule.id ? rule : r)));
    message.success(t("action_save_success"));
  };

  useEffect(() => {
    loadPipelines();
    loadRules();
  }, []);

  return (
    <div className="py-5 px-2 h-full overflow-y-auto">
      <div className="text-sm text-primary mb-6">
        {t("cleaning_policy.description")}
      </div>

      <Spin spinning={loading}>
        <div className="space-y-4">
          {/* Rules list */}
          {rules.map((rule, index) => (
            <RuleItem
              key={rule.id}
              rule={rule}
              index={index}
              pipelines={pipelines}
              t={t}
              onToggle={handleToggle}
              getPipelineIcon={getPipelineIcon}
            />
          ))}
        </div>

        {/* Default fallback rule */}
        {defaultRule && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4 text-gray-400 text-sm">
              <span className="i-tabler-trending-down" />
              {t("cleaning_policy.fallback_execute")}
            </div>
            <div className="bg-white border border-gray-100 rounded-lg hover:shadow-lg transition-all group relative overflow-hidden">
              <div className="flex items-stretch">
                <div className="w-14 flex-none flex flex-col items-center justify-center bg-gray-50 border-r border-gray-100">
                  <div className="w-8 h-8 flex items-center justify-center text-purple-500">
                    <KeyOutlined />
                  </div>
                </div>

                <div className="flex-1 space-y-2 pl-5 py-4 bg-purple-50 flex flex-col justify-center">
                  <div className="h-6 flex items-center gap-2">
                    <div className="text-base font-medium">
                      {defaultRule.name}
                    </div>
                    <span className="px-3 py-1 bg-purple-100 text-purple-500 text-sm rounded">
                      {t("cleaning_policy.fallback_strategy")}
                    </span>
                  </div>

                  <div
                    className="grid overflow-hidden"
                    style={{ gridTemplateColumns: "1fr auto auto auto" }}
                  >
                    <div className="h-10 px-4 rounded-lg flex-1 flex items-center gap-2 text-xs bg-gray-50">
                      <span className="text-gray-400">
                        {t("cleaning_policy.when")}
                      </span>
                      <span className="text-gray-600">
                        {t("cleaning_policy.other_all_files")}
                      </span>
                    </div>
                    <div className="min-h-10 flex items-center justify-center px-3">
                      <RightOutlined className="text-gray-300" />
                    </div>
                    <div className="min-h-10 flex items-center">
                      <div className="h-10 flex items-center gap-1.5 px-3 bg-purple-50 text-purple-500 rounded text-sm border border-purple-200">
                        {getPipelineIcon(defaultRule.pipeline_id) ? (
                          <img
                            src={getPipelineIcon(defaultRule.pipeline_id)}
                            className="w-4 h-4"
                            alt=""
                          />
                        ) : (
                          <AppstoreOutlined />
                        )}
                        <span className="flex-1 truncate">
                          {defaultRule.pipeline_name ||
                            t("cleaning_policy.general_parse")}
                        </span>
                      </div>
                    </div>
                    <div className="flex-none w-[100px]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Spin>
    </div>
  );
}

export default KnowledgeCleaningPolicy;