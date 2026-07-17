import { forwardRef, useImperativeHandle, useEffect, useState, useRef } from "react";
import { Form, Button, Tooltip } from "antd";
import { DeleteOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { useAgentForm, parseModelValue, encodeModelValue, validateModelConfig } from "../hooks";
import { useAgentCreateAdapter, ChannelOption } from "../adapters";
import { BaseConfig, RelateAgents, RoleInstruction } from "../components";
import { ModelSelect, SvgIcon } from "@km/shared-components-react";
import { MAX_SKILLS_COUNT, DEFAULT_FAST_REASONING_CONFIG } from "../constants";

interface WorkbenchProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface WorkbenchRef {
  validateForm: () => Promise<boolean>;
}

/** 默认技能执行配置 */
const DEFAULT_SKILL_RUN_CONFIG = {
  enable: true,
  channel_id: 0,
  channel_type: 0,
  model_name: "",
  temperature: 0.7,
};

const DEFAULT_SETTINGS = {
  prompt: "你是一个全能的数字员工。你不仅能回答问题，还能使用浏览器、代码解释器等工具自主完成复杂任务。面对任务时，请先进行规划(Plan)，然后逐步执行(Execute)，并在每一步后进行观察(0bserve)和反思(Reflect)。",
  settings: {
    fast_reasoning_config: DEFAULT_FAST_REASONING_CONFIG,
    skill_run_config: DEFAULT_SKILL_RUN_CONFIG,
    skills: [] as Array<{ skill_id: string; display_name: string; skill_name?: string }>,
  },
};

export const Workbench = forwardRef<WorkbenchRef, WorkbenchProps>(
  ({ showChannelConfig, className }, ref) => {
    const [antdForm] = Form.useForm();
    const form = useAgentForm();
    const adapter = useAgentCreateAdapter();
    const t = adapter.t || ((key: string) => key);
    const [modelOptions, setModelOptions] = useState<ChannelOption[]>([]);
    const [modelLoading, setModelLoading] = useState(false);
    const skillPickerRef = useRef<any>(null);

    // 加载模型列表
    useEffect(() => {
      if (showChannelConfig && adapter.loadModels) {
        setModelLoading(true);
        adapter.loadModels()
          .then(setModelOptions)
          .finally(() => setModelLoading(false));
      }
    }, [showChannelConfig, adapter]);

    // 初始化默认设置
    useEffect(() => {
      if (showChannelConfig) {
        form.updateFields({
          prompt: form.formData.prompt || DEFAULT_SETTINGS.prompt,
          settings: {
            ...DEFAULT_SETTINGS.settings,
            ...form.formData.settings,
          },
        });
      }
    }, [showChannelConfig]);

    const validateForm = async () => {
      try {
        await antdForm.validateFields();

        // 验证模型配置（仅在 showChannelConfig 模式下）
        if (showChannelConfig) {
          const fastConfig = form.formData.settings?.fast_reasoning_config;
          const skillConfig = form.formData.settings?.skill_run_config;

          // 验证规划推理模型
          if (!validateModelConfig({
            config: fastConfig,
            label: t('work_ai.planning_reasoning_model'),
            t,
            required: true,
          })) {
            return false;
          }

          // 验证技能执行模型
          if (!validateModelConfig({
            config: skillConfig,
            label: t('work_ai.skill_execution_model'),
            t,
            required: true,
          })) {
            return false;
          }
        }

        return true;
      } catch {
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      validateForm,
    }));

    // 规划推理模型值
    const fastReasoningConfig = form.formData.settings?.fast_reasoning_config;
    const fastReasoningValue = fastReasoningConfig?.channel_id
      ? encodeModelValue({
          channel_id: fastReasoningConfig.channel_id,
          model_name: fastReasoningConfig.model_name || "",
          channel_type: fastReasoningConfig.channel_type || 0,
        })
      : "";

    const setFastReasoningValue = (value: string) => {
      const parsed = parseModelValue(value);
      form.updateFields({
        settings: {
          ...form.formData.settings,
          fast_reasoning_config: {
            ...form.formData.settings?.fast_reasoning_config,
            ...parsed,
          },
        },
      });
    };

    // 技能执行模型值
    const skillRunConfig = form.formData.settings?.skill_run_config;
    const skillRunValue = skillRunConfig?.channel_id
      ? encodeModelValue({
          channel_id: skillRunConfig.channel_id,
          model_name: skillRunConfig.model_name || "",
          channel_type: skillRunConfig.channel_type || 0,
        })
      : "";

    const setSkillRunValue = (value: string) => {
      const parsed = parseModelValue(value);
      form.updateFields({
        settings: {
          ...form.formData.settings,
          skill_run_config: {
            ...form.formData.settings?.skill_run_config,
            ...parsed,
          },
        },
      });
    };

    // 已选择的技能
    const selectedSkills = form.formData.settings?.skills || [];

    const handleSkillRemove = (skillLibraryId: string | number) => {
      form.updateFields({
        settings: {
          ...form.formData.settings,
          skills: selectedSkills.filter((s: any) => (s.skill_library_id || s.id) !== skillLibraryId),
        },
      });
    };

    // 技能选择变更
    const handleSkillsChange = (skills: any[]) => {
      form.updateFields({
        settings: {
          ...form.formData.settings,
          skills,
        },
      });
    };

    // 技能选择器组件
    const SkillPickerComponent = adapter.SkillPickerComponent;

    return (
      <div className={`${className || ""}`}>
        {showChannelConfig ? (
          <>
            {/* 模型配置 */}
            <div className="text-sm text-primary mb-3">{t('work_ai.model_setting')}</div>
            <div className="p-4 border rounded-xl bg-white mb-4">
              <div className="flex flex-col gap-4">
                {/* 规划推理模型 */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 w-[120px] flex-none">
                    {/* <Checkbox
                      checked={form.formData.settings?.fast_reasoning_config?.enable}
                      disabled
                    /> */}
                    <span className="text-sm text-primary">
                      {t('work_ai.planning_reasoning_model')}
                    </span>
                    <Tooltip title={t('work_ai.planning_reasoning_model_tip')} placement="top">
                      <QuestionCircleOutlined className="text-hint cursor-help" />
                    </Tooltip>
                  </div>
                  <div className="flex-1 min-w-0">
                    {adapter.OtherComponents?.ModelSelectPopover ? (
                      <adapter.OtherComponents.ModelSelectPopover
                        value={fastReasoningValue}
                        channelId={form.formData.settings?.fast_reasoning_config?.channel_id}
                        modelName={form.formData.settings?.fast_reasoning_config?.model_name}
                        temperature={form.formData.settings?.fast_reasoning_config?.temperature}
                        type="1"
                        onChange={setFastReasoningValue}
                        onTemperatureChange={(value: number) => form.updateFields({
                          settings: {
                            ...form.formData.settings,
                            fast_reasoning_config: {
                              ...form.formData.settings?.fast_reasoning_config,
                              temperature: value,
                            },
                          },
                        })}
                      />
                    ) : (
                      <ModelSelect
                        className="w-full"
                        value={fastReasoningValue}
                        onChange={setFastReasoningValue}
                        options={modelOptions}
                        loading={modelLoading}
                        t={t}
                      />
                    )}
                  </div>
                </div>

                {/* 技能执行模型 */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 w-[120px] flex-none">
                    {/* <Checkbox
                      checked={form.formData.settings?.skill_run_config?.enable}
                      disabled
                    /> */}
                    <span className="text-sm text-primary">
                      {t('work_ai.skill_execution_model')}
                    </span>
                    <Tooltip title={t('work_ai.skill_execution_model_tip')} placement="top">
                      <QuestionCircleOutlined className="text-hint cursor-help" />
                    </Tooltip>
                  </div>
                  <div className="flex-1 min-w-0">
                    {adapter.OtherComponents?.ModelSelectPopover ? (
                      <adapter.OtherComponents.ModelSelectPopover
                        value={skillRunValue}
                        channelId={form.formData.settings?.skill_run_config?.channel_id}
                        modelName={form.formData.settings?.skill_run_config?.model_name}
                        temperature={form.formData.settings?.skill_run_config?.temperature}
                        type="1"
                        onChange={setSkillRunValue}
                        onTemperatureChange={(value: number) => form.updateFields({
                          settings: {
                            ...form.formData.settings,
                            skill_run_config: {
                              ...form.formData.settings?.skill_run_config,
                              temperature: value,
                            },
                          },
                        })}
                      />
                    ) : (
                      <ModelSelect
                        className="w-full"
                        value={skillRunValue}
                        onChange={setSkillRunValue}
                        options={modelOptions}
                        loading={modelLoading}
                        t={t}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 元指令 - 使用 RoleInstruction 组件 */}
            <RoleInstruction title={t('work_ai.meta_instruction')} />

            {/* 技能配置 */}
            <div className="flex items-center justify-between mb-3 mt-4">
              <div className="text-sm font-medium text-primary">{t('work_ai.skill_config')}</div>
              {SkillPickerComponent && (
                <SkillPickerComponent
                  ref={skillPickerRef}
                  value={selectedSkills}
                  onChange={handleSkillsChange}
                  disabled={selectedSkills.length >= MAX_SKILLS_COUNT}
                  translate={t}
                />
              )}
            </div>
            <div className="flex flex-col gap-2">
              {selectedSkills.map((skill: any) => (
                <div
                  key={skill.skill_library_id || skill.id}
                  className="rounded-lg px-2 py-3 flex items-center justify-between bg-white group"
                >
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {skill.logo ? (
                      <img
                        className="size-8 rounded-full overflow-hidden shrink-0"
                        src={skill.logo}
                        alt=""
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={`size-8 bg-[#F0F2F5] rounded flex items-center justify-center shrink-0 ${skill.logo ? 'hidden' : ''}`}>
                      <SvgIcon name="lightning" size="18" color="#2563EB" />
                    </div>
                    <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
                      <div className="text-sm text-primary truncate">
                        {skill.display_name || skill.skill_name}
                      </div>
                      {skill.description && (
                        <div className="text-xs text-secondary truncate">
                          {skill.description}
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    color="danger" variant="link"
                    className="invisible group-hover:visible"
                    icon={<DeleteOutlined />}
                    type="link"
                    onClick={() => handleSkillRemove(skill.skill_library_id || skill.id)}
                  />
                </div>
              ))}
              {selectedSkills.length === 0 && (
                <div className="text-sm text-placeholder text-center py-2">
                  {t('no_data')}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium text-[#9CA3AF] py-1.5">{t('agent.chat_enhance')}</div>
            <BaseConfig />
            <RelateAgents />
            <div className="h-3"></div>
          </>
        )}
      </div>
    );
  }
);

Workbench.displayName = "Workbench";

export default Workbench;
