import { useCallback, useState } from 'react';
import { CloseOutlined, RightOutlined } from '@ant-design/icons';
import type { IAgentInfo } from '@km/shared-business/chat';
import { t } from '@/locales';
import AuthTagGroup from '@/components/AuthTagGroup';
import UserMemory from '@/components/UserMemory';
import SkillPanel from './Skill';
import { AGENT_USAGES } from '@/constants/agent';
import { SvgIcon } from '@km/shared-components-react';
import { usePlatformAccessItems } from './hooks/usePlatformAccessItems';

interface SettingProps {
  /** Agent 信息 */
  agent: IAgentInfo;
  /** 关闭回调 */
  onClose?: () => void;
  /** 点击技能按钮时触发（用于延迟拉取技能列表） */
  onSkillOpen?: () => void;
  /** 使用技能回调（将技能添加到对话框） */
  onUseSkill?: (skill: { id: string; display_name: string; skill_name: string; icon?: string }) => void;
}

/**
 * 通用卡片区块
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-xs text-placeholder mb-2">{title}</div>
      <div className="bg-[#F7F8FA] rounded-xl px-[14px] py-3">{children}</div>
    </div>
  );
}

/**
 * 模型设置区域
 */
function ModelSetting({
  title,
  subtitle,
  icon,
  items,
}: {
  title: string;
  subtitle: string;
  icon: string;
  items: { label: string; value?: string }[];
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="size-8 rounded-lg bg-[#F7F8FA] flex items-center justify-center">
          <SvgIcon name={icon} className="text-primary" />
        </div>
        <div className="flex-1">
          <div className="text-sm text-primary">{title}</div>
          <div className="text-xs text-placeholder">{subtitle}</div>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="bg-white py-3 px-[14px] rounded-lg flex items-center justify-between">
            <span className="text-sm text-primary">{item.label}</span>
            <span className="text-xs text-placeholder">{item.value || '--'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 菜单项（记忆、技能等）
 */
function MenuItem({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick?: () => void;
}) {
  return (
    <div
      className="bg-[#F7F8FA] rounded-xl px-[14px] py-3 flex items-center gap-3 mb-2 cursor-pointer hover:opacity-80"
      onClick={onClick}
    >
      <div className="w-8 h-8 rounded-lg bg-[#F7F8FA] flex items-center justify-center flex-shrink-0">
        <SvgIcon name={icon} className="text-primary" size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-primary">{title}</div>
        <div className="text-xs text-placeholder mt-0.5 truncate">{desc}</div>
      </div>
      <RightOutlined className="text-xs text-[#A0A7B5]" />
    </div>
  );
}

/**
 * 基本信息卡片
 */
function BasicInfoSection({ agent }: { agent: IAgentInfo }) {
  const DEFAULT_IMG = '/images/default_agent.png';

  return (
    <Section title={t('setting.basic_info')}>
      <div className="flex items-center gap-3">
        <img
          src={agent.logo || DEFAULT_IMG}
          alt={agent.name}
          className="size-8 rounded-xl object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src = DEFAULT_IMG;
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-primary truncate">
            {agent.name || '--'}
          </div>
          <div className="text-xs text-placeholder mt-0.5">
            {agent.description || '--'}
          </div>
        </div>
      </div>
    </Section>
  );
}

/**
 * 设置信息卡片（仅模型设置）
 */
function SettingsSection({ agent }: { agent: IAgentInfo }) {
  const agentUsage = agent.agent_usage ?? 0;
  const settings = agent.settings_obj || agent.settings || {};

  // 工作AI：规划推理模型 + 技能执行模型
  if (agentUsage === AGENT_USAGES.WORK_AI) {
    return (
      <Section title={t('setting.model_setting')}>
        <ModelSetting
          title={t('setting.model_setting')}
          subtitle={t('setting.current_model')}
          icon="coordinate-system"
          items={[
            { label: t('setting.planning_reasoning'), value: (settings.fast_reasoning_config as any)?.model_name },
            { label: t('setting.skill_execution'), value: (settings.skill_run_config as any)?.model_name },
          ]}
        />
      </Section>
    );
  }

  // AI搜问：快速回答模型 + 深度思考模型
  if (agentUsage === AGENT_USAGES.KM_AI_SEARCH) {
    return (
      <Section title={t('setting.model_setting')}>
        <ModelSetting
          title={t('setting.model_setting')}
          subtitle={t('setting.current_model')}
          icon="coordinate-system"
          items={[
            { label: t('setting.quick_response'), value: (settings.fast_reasoning_config as any)?.model_name },
            { label: t('setting.deep_thinking'), value: (settings.deep_thinking_config as any)?.model_name },
          ]}
        />
      </Section>
    );
  }

  return null;
}

/**
 * 记忆与技能卡片（工作AI）
 */
function MemoryAndSkillSection({ onMemoryClick, onSkillClick }: { onMemoryClick?: () => void; onSkillClick?: () => void }) {
  return (
    <div className='-mt-3 mb-5'>
      <MenuItem
        icon="brain"
        title={t('setting.memory')}
        desc={t('setting.memory_desc')}
        onClick={onMemoryClick}
      />
      <div className="border-t border-[#F0F2F5]" />
      <MenuItem
        icon="skill"
        title={t('setting.skill')}
        desc={t('setting.skill_desc')}
        onClick={onSkillClick}
      />
    </div>
  );
}

/**
 * 生成设置卡片（AI搜问专用）
 */
function GenerateSettingSection({ agent }: { agent: IAgentInfo }) {
  const settings = agent.settings_obj || agent.settings || {};
  const webSearch = settings.web_search_setting as any;
  const graphSearch = settings.graph_search_setting as any;

  return (
    <div className='bg-[#F7F8FA] rounded-xl px-[14px] py-3 -mt-3 mb-5'>
      <ModelSetting
        title={t('setting.generate_setting')}
        subtitle={t('setting.generate_setting_desc')}
        icon="terminal"
        items={[
          { label: t('setting.default_range'), value: t('setting.all_knowledge_base') },
          { label: t('chat.knowledge_graph'), value: graphSearch?.enable ? t('setting.enabled') : t('setting.disabled') },
          { label: t('chat.online_search'), value: webSearch?.enable ? t('setting.enabled') : t('setting.disabled') },
        ]}
      />
    </div>
  );
}

/**
 * 使用范围卡片
 */
function UseScopeSection({ agent }: { agent: IAgentInfo }) {
  return (
    <Section title={t('setting.use_scope')}>
      <AuthTagGroup
        value={agent.user_group_ids}
        scopes={agent.scopes}
        hideLabel
      />
    </Section>
  );
}

/**
 * 平台接入卡片（非工作AI和AI搜问的其他类型）
 */
function PlatformAccessSection({ agent }: { agent: IAgentInfo }) {
  const { items: platformItems, loading } = usePlatformAccessItems(agent);

  if (loading) {
    return null;
  }

  if (!platformItems || platformItems.length === 0) {
    return null;
  }

  return (
    <Section title={t('setting.info')}>
      <ModelSetting
        title={t('setting.platform_access')}
        subtitle={t('setting.platform_auth_info')}
        icon="app-one"
        items={platformItems}
      />
    </Section>
  );
}

export function Setting({ agent, onClose, onSkillOpen, onUseSkill }: SettingProps) {
  const agentUsage = agent?.agent_usage ?? 0;
  const [showMemory, setShowMemory] = useState(false);
  const [isMemoryFullscreen, setIsMemoryFullscreen] = useState(false);
  const [showSkill, setShowSkill] = useState(false);

  // 点击技能按钮：先触发技能列表拉取，再展示技能面板
  const handleSkillClick = useCallback(() => {
    onSkillOpen?.();
    setShowSkill(true);
  }, [onSkillOpen]);

  if (!agent) {
    return (
      <div className="h-full bg-white flex items-center justify-center">
        <span className="text-sm text-[#A0A7B5]">{t('common.no_data')}</span>
      </div>
    );
  }

  // 点击记忆 → 展示记忆面板（记忆面板有全屏样式特殊处理，保持条件渲染）
  if (showMemory) {
    return (
      <div className={`flex flex-col bg-white h-full ${isMemoryFullscreen ? "fixed inset-0 z-[201]" : ""}`}>
        <UserMemory
          agentId={String(agent.agent_id)}
          onClose={() => {
            setShowMemory(false);
            setIsMemoryFullscreen(false);
          }}
          onToggleFullscreen={() => setIsMemoryFullscreen(!isMemoryFullscreen)}
          isFullscreen={isMemoryFullscreen}
        />
      </div>
    );
  }

  return (
    <div className="h-full bg-white relative">
      {/* 技能面板 */}
      {showSkill && (<div className={`absolute inset-0 z-10`}>
        <SkillPanel agentId={agent.agent_id} onClose={() => setShowSkill(false)} onUseSkill={onUseSkill} />
      </div>)}

      {/* 正常设置内容 */}
      <div className={`h-full flex flex-col ${showSkill ? 'hidden' : ''}`}>
        {/* Header */}
        <div className="h-15 flex items-center justify-between px-5 flex-shrink-0 bg-white border-b">
          <span className="text-lg text-primary">{t('setting.title')}</span>
          {onClose && (
            <div
              className="size-7 cursor-pointer rounded flex items-center justify-center hover:bg-[#F7F8FA]"
              onClick={onClose}
            >
              <CloseOutlined />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* 基本信息 */}
          <BasicInfoSection agent={agent} />

          {/* 模型设置 - 工作AI和AI搜问 */}
          {(agentUsage === AGENT_USAGES.WORK_AI || agentUsage === AGENT_USAGES.KM_AI_SEARCH) && (
            <SettingsSection agent={agent} />
          )}

          {/* 平台接入 - 其他类型（非工作AI和AI搜问） */}
          {agentUsage !== AGENT_USAGES.WORK_AI && agentUsage !== AGENT_USAGES.KM_AI_SEARCH && (
            <PlatformAccessSection agent={agent} />
          )}

          {/* 记忆与技能 - 仅工作AI */}
          {agentUsage === AGENT_USAGES.WORK_AI && (
            <MemoryAndSkillSection onMemoryClick={() => setShowMemory(true)} onSkillClick={handleSkillClick} />
          )}

          {/* 生成设置 - 仅AI搜问 */}
          {agentUsage === AGENT_USAGES.KM_AI_SEARCH && <GenerateSettingSection agent={agent} />}

          {/* 使用范围 */}
          <UseScopeSection agent={agent} />
        </div>
      </div>
    </div>
  );
}

export default Setting;