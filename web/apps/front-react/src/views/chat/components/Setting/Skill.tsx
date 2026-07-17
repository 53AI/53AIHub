import { useEffect, useMemo, useState } from 'react';
import { LeftOutlined } from '@ant-design/icons';
import { Button, Empty, message, Modal, Tooltip } from 'antd';
import type { AgentSkillBindingItem } from '@/api/modules/skill/types';
import { skillApi } from '@/api/modules/skill';
import { useSkillsStore } from '@/stores/modules/skills';
import { SvgIcon } from '@km/shared-components-react';
import { GroupList } from '@/views/skills/components/GroupList';
import { t } from '@/locales';

interface SkillPanelProps {
  agentId: string | number;
  onClose: () => void;
  /** 使用技能回调（将技能添加到对话框） */
  onUseSkill?: (skill: { id: string; display_name: string; skill_name: string; icon?: string }) => void;
}

export default function SkillPanel({ agentId, onClose, onUseSkill }: SkillPanelProps) {
  const [showAddPicker, setShowAddPicker] = useState(false);

  // 从 store 获取状态和方法
  const agentSkillsMap = useSkillsStore((state) => state.agentSkillsMap);
  const agentSkillsLoading = useSkillsStore((state) => state.agentSkillsLoading);
  const loadAgentSkills = useSkillsStore((state) => state.loadAgentSkills);
  const removeAgentSkill = useSkillsStore((state) => state.removeAgentSkill);
  const currentSkillGroupId = useSkillsStore((state) => state.currentSkillGroupId);
  const clearSkillListCache = useSkillsStore((state) => state.clearSkillListCache);

  // 组件卸载时清除缓存
  useEffect(() => {
    return () => {
      clearSkillListCache();
    };
  }, []);

  // 当前 agent 的技能列表（使用 String(agentId) 作为 key）
  const skills = agentSkillsMap.get(String(agentId)) || [];
  const loading = agentSkillsLoading;

  // 过滤掉已禁用的技能（status 为 disabled）
  const filteredSkills = useMemo(() => {
    return skills.filter((s) => s.status !== 'disabled');
  }, [skills]);

  // 已添加的技能 ID 列表（用于在弹窗中标记已添加状态）
  const addedSkillIds = useMemo(() => {
    return filteredSkills.map((s) => String(s.id));
  }, [filteredSkills]);

  useEffect(() => {
    loadAgentSkills(agentId);
    // 加载分类列表，供 GroupList 的 Tabs 使用
    useSkillsStore.getState().loadCategorys();
  }, [agentId, loadAgentSkills]);

  // 删除用户技能
  const handleDelete = (skill: AgentSkillBindingItem) => {
    if (skill.bind_type !== 'user') return;
    Modal.confirm({
      title: '确认删除',
      content: `确定要移除技能「${skill.display_name}」吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        await skillApi.deleteAgentSkill(agentId, skill.binding_id);
        // 直接更新 store，无需重新请求
        removeAgentSkill(agentId, skill.binding_id);
        message.success('已删除');
      },
    });
  };

  // 添加技能成功回调（添加操作已在 SkillCard 中完成）
  const handleAddFromGroup = (skillId: string) => {
    // 不关闭弹窗，让用户可以继续添加其他技能
    loadAgentSkills(agentId);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="h-16 flex items-center px-4 flex-shrink-0">
        <LeftOutlined
          className="text-primary cursor-pointer mr-3"
          onClick={() => {
            clearSkillListCache();
            onClose();
          }}
        />
        <span className="text-base text-primary">技能</span>
      </div>

      {/* Sub-header：描述 + 添加按钮 */}
      <div className="flex items-center justify-between px-4 pb-2 flex-shrink-0">
        <span className="text-xs text-placeholder">可添加/移除已添加的技能，也可从技能库添加更多</span>
        <Button
          type="primary"
          className="px-4 py-1.5 rounded-md text-sm"
          onClick={() => setShowAddPicker(true)}
        >
          添加
        </Button>
      </div>

      {/* 技能列表 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 h-full">
        {loading ? (
          <div className="text-center py-8 text-sm text-[#A0A7B5]">加载中...</div>
        ) : filteredSkills.length === 0 ? (
          <div className="h-full flex-center"><Empty description="暂无技能" className="py-8" /></div>
        ) : (
          <div className="space-y-2">
            {filteredSkills.map((skill) => (
              <SkillCard key={skill.binding_id} skill={skill} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* 技能库选择弹窗 */}
      <Modal
        open={showAddPicker}
        onCancel={() => setShowAddPicker(false)}
        footer={null}
        width={1260}
        destroyOnClose
      >
        <div className="h-[732px] flex flex-col">
          {/* 自定义 Header */}
          <div className="flex items-center justify-between overflow-visible">
            <div className="flex items-center gap-2 relative">
              <span className="text-lg leading-6 font-medium text-[#1D1E1F]">{t("agent.explore")}</span>
              <SvgIcon
                name="explore"
                size={20}
                className="absolute -right-5 -top-2"
                color="var(--el-color-primary, #2563eb)"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto pt-3">
            <GroupList
              onAdd={handleAddFromGroup}
              sticky={false}
              addedAgentId={agentId}
              addedSkillIds={addedSkillIds}
              onUseSkill={onUseSkill}
              paginated
              initialGroupId={currentSkillGroupId}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * 单个技能卡片
 */
function SkillCard({
  skill,
  onDelete,
}: {
  skill: AgentSkillBindingItem;
  onDelete: (skill: AgentSkillBindingItem) => void;
}) {
  const isBuiltin = skill.bind_type === 'builtin';
  const isDisabled = skill.admin_status === 'disabled';

  return (
    <Tooltip title={isDisabled ? '该技能权限已失效，请联系管理员' : ''} placement="top">
      <div className={`bg-[#F7F8FA] rounded-xl px-4 py-3 flex items-center gap-3 group ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        {/* 图标 */}
        <div className="size-8 rounded-lg bg-[#F0F2F5] flex items-center justify-center flex-shrink-0 mt-0.5">
          <SvgIcon name="skill" size={16} color="#2563EB" />
        </div>
        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${isDisabled ? 'text-[#A0A7B5]' : 'text-primary'}`}>{skill.display_name || skill.skill_name}</span>
            {isBuiltin && (
              <span className="px-1.5 py-0.5 text-[10px] bg-[#EFF0F2] text-placeholder rounded">内置</span>
            )}
          </div>
          <p className={`text-xs mt-0.5 line-clamp-1 ${isDisabled ? 'text-[#A0A7B5]' : 'text-[#7A8494]'}`}>{skill.description}</p>
        </div>
        {/* 操作：仅用户技能显示删除按钮 */}
        {!isBuiltin && !isDisabled && (
          <button
            className="size-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 mt-0.5"
            onClick={() => onDelete(skill)}
          >
            <SvgIcon name="delete" color="#999" />
          </button>
        )}
      </div>
    </Tooltip>
  );
}
