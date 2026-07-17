import { useState, useEffect, useMemo } from "react";
import { t } from "@/locales";
import { Button, Spin, Switch } from "antd";
import { RightOutlined, KeyOutlined, HolderOutlined } from "@ant-design/icons";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SvgIcon } from "@km/shared-components-react";
import { CSS } from "@dnd-kit/utilities";
import { ragStrategyApi } from "@/api";
import type { Strategy } from "@/api/modules/rag-strategy";
import { PipelineProvider, PipelineAdapterProvider, DEFAULT_PIPELINE_STEP } from "@km/shared-business/knowledge-pipeline";
import type { PipelineStep } from "@km/shared-business/knowledge-pipeline";
import { useLocaleStore } from "@/stores/modules/locale";
import { createPipelineAdapter } from "./adapters";
import { useRuleEditor } from "./hooks/useRuleEditor";
import { RuleEditorDrawer } from "./components/RuleEditorDrawer";
import { PipelineSteps } from "./components/PipelineStepNode";

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
    const mergedMap = new Map<string, { type: string; operator: string; values: string[] }>();

    matchers.forEach((cond: { type: string; operator: string; value: string | string[] }) => {
      const key = `${cond.type}_${cond.operator}`;
      const value = Array.isArray(cond.value) ? cond.value : [cond.value].filter(Boolean);

      if (mergedMap.has(key)) {
        mergedMap.get(key)!.values.push(...value);
      } else {
        mergedMap.set(key, { type: cond.type, operator: cond.operator, values: [...value] });
      }
    });

    mergedMap.forEach((group) => {
      group.values = Array.from(new Set(group.values));
    });

    return Array.from(mergedMap.values());
  } catch {
    return [];
  }
};

// Sortable item component
interface SortableItemProps {
  rule: Strategy;
  index: number;
  onEdit: (rule: Strategy) => void;
  onDelete: (rule: Strategy) => void;
  onToggle: (rule: Strategy) => void;
}

function SortableItem({ rule, index, onEdit, onDelete, onToggle }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const mergedConditions = getMergedConditions(rule);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white rounded-lg shadow hover:shadow-lg transition-all group relative cursor-pointer"
      onClick={() => onEdit(rule)}
    >
      <div className="flex items-stretch">
        {/* Drag handle */}
        <div
          className="w-14 flex-none flex flex-col items-center justify-center gap-2 bg-gray-50 cursor-move"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <HolderOutlined className="text-gray-300 hover:text-gray-500" />
          <div className="text-[10px] text-gray-400 font-mono">#{index + 1}</div>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-2 pl-5 py-4">
          <div className="text-base font-medium">{rule.name}</div>

          {/* Condition -> Action */}
          <div className="grid overflow-hidden" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
            <div className="min-h-10 px-4 py-2 rounded-lg flex items-center gap-2 text-xs flex-wrap bg-gray-50">
              <span className="text-gray-400">{t("cleaning_policy.when")}</span>
              {mergedConditions.map((group, gIdx) => (
                <span key={gIdx} className="flex items-center gap-1">
                  {gIdx > 0 && (
                    <span className="text-blue-500 font-medium mx-1">
                      {rule.logic === 2 ? t("cleaning_policy.or") : t("cleaning_policy.and")}
                    </span>
                  )}
                  <span className="text-gray-600">{getFieldLabel(group.type, t)}</span>
                  <span className="text-gray-400">{getOperatorLabel(group.operator, t)}</span>
                  <div className="flex flex-wrap gap-1.5 ml-1">
                    {group.values.map((val, vIdx) => (
                      <span key={vIdx} className="px-2 py-0.5 bg-blue-50 text-blue-500 rounded border border-blue-200 text-[11px]">
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
              <PipelineSteps steps={rule.pipeline_profile?.steps || []} />
            </div>

            <div className="flex-none w-[92px]" />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 pr-5" onClick={(e) => e.stopPropagation()}>
          <Button
            type="text"
            icon={<SvgIcon name="edit" />}
            onClick={() => onEdit(rule)}
            className="px-0 opacity-0 group-hover:opacity-100 transition-opacity"
          />
          <div className="w-px h-4 mr-2 bg-gray-200" />
          <Switch checked={rule.enabled} onChange={(checked) => onToggle({ ...rule, enabled: checked })} />
        </div>
      </div>
    </div>
  );
}

// Default rule card component
interface DefaultRuleCardProps {
  rule: Strategy;
  onEdit: () => void;
}

function DefaultRuleCard({ rule, onEdit }: DefaultRuleCardProps) {
  return (
    <div
      className="bg-white border border-gray-100 rounded-lg hover:shadow-lg transition-all group relative overflow-hidden cursor-pointer"
      onClick={onEdit}
    >
      <div className="flex items-stretch">
        <div className="w-14 flex-none flex flex-col items-center justify-center bg-gray-50 border-r border-gray-100">
          <div className="w-8 h-8 flex items-center justify-center text-purple-500">
            <KeyOutlined />
          </div>
        </div>

        <div className="flex-1 space-y-2 pl-5 py-4 bg-purple-50 flex flex-col justify-center">
          <div className="h-6 flex items-center gap-2">
            <div className="text-base font-medium">{rule.name}</div>
            <span className="px-3 py-1 bg-purple-100 text-purple-500 text-sm rounded">
              {t("cleaning_policy.fallback_strategy")}
            </span>
          </div>

          <div className="grid overflow-hidden" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
            <div className="h-10 px-4 rounded-lg flex-1 flex items-center gap-2 text-xs bg-gray-50">
              <span className="text-gray-600">{t("cleaning_policy.other_all_files")}</span>
            </div>
            <div className="min-h-10 flex items-center justify-center px-3">
              <RightOutlined className="text-gray-300" />
            </div>
            <div className="min-h-10 flex items-center">
              <PipelineSteps steps={rule.pipeline_profile?.steps || []} />
            </div>
            <div className="flex-none w-[92px]" />
          </div>
        </div>

        <div className="flex items-center justify-end pr-5 w-[146px] bg-purple-50" onClick={(e) => e.stopPropagation()}>
          <Button type="text" icon={<SvgIcon name="edit" />} onClick={onEdit} className="opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );
}

// Main component
export function KnowledgeCleaningPolicy() {
  const locale = useLocaleStore((state) => state.locale);
  const adapter = useMemo(() => createPipelineAdapter(), []);

  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<Strategy[]>([]);
  const [defaultRule, setDefaultRule] = useState<Strategy | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Transform strategy to rule format
  const transformStrategyToRule = (strategy: Strategy): Strategy => {
    const isDefault = strategy.priority === 9999;
    const defaultConditionsJson = { matchers: [{ type: "extension", operator: "eq", value: "" }] };
    try {
      const conditionsJson =
        typeof strategy.conditions_json === "string" && strategy.conditions_json !== ""
          ? JSON.parse(strategy.conditions_json)
          : strategy.conditions_json;

      // 解析 pipeline.profile_json 字符串为对象
      let pipelineProfile: Strategy['pipeline_profile'] | undefined;
      if (strategy.pipeline?.profile_json) {
        try {
          const parsed = typeof strategy.pipeline.profile_json === 'string'
            ? JSON.parse(strategy.pipeline.profile_json)
            : strategy.pipeline.profile_json;

          // 补全缺失字段：使用 DEFAULT_PIPELINE_STEP 作为基准
          if (parsed?.steps && Array.isArray(parsed.steps)) {
            pipelineProfile = {
              steps: parsed.steps.map((inputStep: Partial<PipelineStep>) => {
                // 找到对应的默认步骤
                const defaultStep = DEFAULT_PIPELINE_STEP.find(d => d.step_key === inputStep.step_key)

                if (!defaultStep) {
                  // 如果没有找到对应的默认步骤，至少填充基本字段
                  return {
                    step_key: inputStep.step_key || '',
                    run_mode: inputStep.run_mode || 'auto',
                    name: inputStep.name || inputStep.step_key || '',
                    description: inputStep.description || '',
                    config: inputStep.config || {},
                  }
                }

                // 合并：默认值 + 输入值（输入值覆盖默认值）
                return {
                  ...defaultStep,
                  ...inputStep,
                  config: {
                    ...defaultStep.config,
                    ...(inputStep.config || {}),
                  },
                }
              })
            }
          } else {
            pipelineProfile = parsed
          }
        } catch {
          console.warn('Failed to parse pipeline.profile_json');
        }
      }

      return {
        ...strategy,
        conditions_json: conditionsJson?.matchers ? conditionsJson : defaultConditionsJson,
        is_default: isDefault,
        pipeline_profile: pipelineProfile,
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
      setDefaultRule(transformed.find((s) => s.is_default) || null);
      setRules(transformed.filter((s) => !s.is_default));
    } finally {
      setLoading(false);
    }
  };

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = rules.findIndex((r) => r.id === active.id);
      const newIndex = rules.findIndex((r) => r.id === over.id);
      const newRules = arrayMove(rules, oldIndex, newIndex);
      setRules(newRules);

      try {
        await ragStrategyApi.reorder({ strategy_ids: newRules.map((r) => r.id) });
        await loadRules();
      } catch (error) {
        console.error("Failed to reorder rules:", error);
      }
    }
  };

  const editor = useRuleEditor({ rules, onSuccess: loadRules });

  useEffect(() => {
    loadRules();
  }, []);

  return (
    <PipelineProvider lang={locale as 'zh-cn' | 'zh-tw' | 'en' | 'ja'}>
      <PipelineAdapterProvider adapter={adapter}>
        <div className="py-5 px-2 h-full overflow-y-auto">
          <div className="text-sm text-primary mb-4">{t("cleaning_policy.custom_rules")}</div>

          <Spin spinning={loading}>
            <div className="space-y-4">
              {/* Rules list */}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                  {rules.map((rule, index) => (
                    <SortableItem
                      key={rule.id}
                      rule={rule}
                      index={index}
                      onEdit={editor.handleEdit}
                      onDelete={editor.handleDelete}
                      onToggle={editor.handleToggle}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            {/* Default fallback rule */}
            {defaultRule && (
              <div className="mt-8">
                <div className="flex items-center gap-2 mb-4 text-gray-400 text-sm">
                  <SvgIcon name="trending-down" />
                  {t("cleaning_policy.fallback_execute")}
                </div>
                <DefaultRuleCard rule={defaultRule} onEdit={() => editor.handleEditDefault(defaultRule)} />
              </div>
            )}
          </Spin>

          {/* Editor Drawer */}
          <RuleEditorDrawer
            visible={editor.drawerVisible}
            currentStep={editor.currentStep}
            editingRule={editor.editingRule}
            currentPipeline={editor.currentPipeline}
            submitting={editor.submitting}
            isEditingDefault={editor.isEditingDefault}
            editorRef={editor.editorRef}
            lastInputRef={editor.lastInputRef}
            onClose={editor.handleDrawerClose}
            onNextStep={editor.handleNextStep}
            onPrevStep={editor.handlePrevStep}
            onSave={editor.handleSave}
            onPipelineChange={editor.handlePipelineChange}
            onToggleLogic={editor.toggleLogicOperator}
            onAddCondition={editor.addCondition}
            onRemoveCondition={editor.removeCondition}
            onUpdateCondition={editor.updateCondition}
            onRuleChange={editor.setEditingRule}
            onPipelineUpdate={editor.setCurrentPipeline}
          />
        </div>
      </PipelineAdapterProvider>
    </PipelineProvider>
  );
}

export default KnowledgeCleaningPolicy;
