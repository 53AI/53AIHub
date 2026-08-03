import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Modal, Select, message } from 'antd';
import { SvgIcon } from '@km/shared-components-react';
import { t } from '@/locales';
import { skillApi } from '@/api/modules/skill';
import agentShortcutsApi from '@/api/modules/agent-shortcuts';
import type { AgentShortcutItem } from '@/api/modules/agent-shortcuts/types';
import { AGENT_USAGES } from '@/constants/agent';
import { checkPermission } from '@/utils/permission';

interface AddSkillModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 技能 ID */
  skillId: string;
  /** 技能分组 IDs（用于权限检查） */
  groupIds?: number[];
  /** 直接添加到指定 agentId（可选，设置后不显示选择下拉） */
  directAddAgentId?: string | number;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 添加成功后的回调 */
  onSuccess?: () => void;
}

/**
 * 添加技能到小助理的弹窗组件
 *
 * 功能：
 * - 如果指定了 directAddAgentId，弹窗打开时自动执行添加（带权限检查）
 * - 否则显示选择小助理下拉框，用户手动确认添加
 */
export function AddSkillModal({
  open,
  skillId,
  groupIds = [],
  directAddAgentId,
  onClose,
  onSuccess,
}: AddSkillModalProps) {
  const [loading, setLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | string>();
  // 小助理列表（与侧边栏同源：用户已添加的快捷方式，仅 WORK_AI 类型）
  const [workAiAgents, setWorkAiAgents] = useState<AgentShortcutItem[]>([]);
  // 用于追踪 directAddAgentId 模式是否已执行，避免重复触发
  const directAddExecutedRef = useRef(false);

  // 弹窗打开时，加载侧边栏快捷方式列表并过滤出 WORK_AI（仅在非直接添加模式下）
  useEffect(() => {
    if (!open || directAddAgentId) return;

    let cancelled = false;
    (async () => {
      try {
        const list = (await agentShortcutsApi.list()) || [];
        if (cancelled) return;
        setWorkAiAgents(
          list.filter((a) => a.agent_usage === AGENT_USAGES.WORK_AI),
        );
      } catch (error) {
        if (!cancelled) setWorkAiAgents([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, directAddAgentId]);

  // 当小助理列表加载完成后，设置默认选中项
  useEffect(() => {
    if (!open || directAddAgentId) return;
    // 已有选中值时不覆盖
    if (selectedAgentId !== undefined) return;
    if (workAiAgents.length > 0) {
      setSelectedAgentId(workAiAgents[0].agent_id);
    }
  }, [open, directAddAgentId, workAiAgents, selectedAgentId]);

  // 弹窗关闭时重置状态
  useEffect(() => {
    if (!open) {
      directAddExecutedRef.current = false;
      setSelectedAgentId(undefined);
    }
  }, [open]);

  // 刷新技能列表 - 使用 ref 存储回调，避免依赖变化
  const onSuccessRef = useRef(onSuccess);
  const onCloseRef = useRef(onClose);
  onSuccessRef.current = onSuccess;
  onCloseRef.current = onClose;

  // 确认添加 - 使用 ref 存储 loading 状态，避免依赖变化
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const handleConfirm = useCallback(async () => {
    const targetAgentId = directAddAgentId || selectedAgentId;
    if (!targetAgentId || loadingRef.current) return;

    try {
      setLoading(true);
      await skillApi.addAgentSkill(targetAgentId, skillId);
      message.success(t('action.add_success'));
      onSuccessRef.current?.();
      onCloseRef.current();
    } catch (error: any) {
      const errMsg = error?.response?.data?.message || error?.message || '';
      if (errMsg.includes('skill already exists as builtin in this agent')) {
        // 从 workAiAgents 找到对应的 agent 名称
        const agentId = directAddAgentId || selectedAgentId;
        const agentName = workAiAgents.find(
          (a) => String(a.agent_id) === String(agentId),
        )?.agent_name || '';
        message.error(`${t('skill.skill_already_added', {name: agentName})}`);
      } else {
        message.error(`${t('action.operation_failed')}，${t('common.try_again')}`);
      }
    } finally {
      setLoading(false);
    }
  }, [directAddAgentId, selectedAgentId, skillId]);

  // 直接添加模式：弹窗打开时自动执行添加（仅执行一次）
  useEffect(() => {
    if (!open || !directAddAgentId) return;
    if (directAddExecutedRef.current) return;
    if (loadingRef.current) return;

    directAddExecutedRef.current = true;

    // 延迟执行，避免在 useEffect 同步阶段触发状态更新
    const timer = setTimeout(() => {
      checkPermission({
        groupIds,
        onClick: handleConfirm,
      });
    }, 0);

    return () => clearTimeout(timer);
  }, [open, directAddAgentId, groupIds, handleConfirm]);

  // 如果是直接添加模式，不渲染弹窗
  if (directAddAgentId) {
    return null;
  }

  return (
    <Modal
      open={open}
      title={t('skill.add_skill')}
      onCancel={onClose}
      destroyOnClose={false}
      forceRender
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('action.cancel')}
        </Button>,
        <Button
          key="ok"
          type="primary"
          loading={loading}
          disabled={!selectedAgentId}
          onClick={() => {
            checkPermission({
              groupIds,
              onClick: handleConfirm,
            });
          }}
        >
          {t('action.ok')}
        </Button>,
      ]}
    >
      <div className="flex items-center gap-3 py-4">
        <span className="text-sm text-[#1D1E1F] whitespace-nowrap">
          {t('skill.add_to_agent')}
        </span>
        <Select
          className="flex-1"
          value={selectedAgentId}
          onChange={setSelectedAgentId}
          placeholder={t('skill.select_agent')}
          options={workAiAgents.map((agent) => ({
            value: agent.agent_id,
            label: (
              <div className="flex items-center gap-2">
                {agent.agent_logo ? (
                  <img
                    src={agent.agent_logo}
                    alt=""
                    className="size-5 rounded object-cover"
                  />
                ) : (
                  <SvgIcon name="workbench" size={20} />
                )}
                <span>{agent.agent_name || '小助理'}</span>
              </div>
            ),
          }))}
        />
      </div>
    </Modal>
  );
}

export default AddSkillModal;
