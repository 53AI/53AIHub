import { useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Empty, Input, Modal, Spin, Tag, message } from 'antd'
import skillApi from '@/api/modules/skill'
import type { SkillEnvVarItem, SkillEnvVarTemplate } from '@/api/modules/skill/types'

interface SkillEnvVarsDrawerProps {
  open: boolean
  skillId: string
  skillDisplayName?: string
  /** 外部已提供的 env_vars 模板，若提供则跳过 getDetail 调用 */
  envTemplates?: SkillEnvVarTemplate[]
  onClose: () => void
}

const MASK_VALUE = '***'

const SkillEnvVarsDrawer: React.FC<SkillEnvVarsDrawerProps> = ({
  open,
  skillId,
  skillDisplayName,
  envTemplates: externalEnvTemplates,
  onClose,
}) => {
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [envTemplates, setEnvTemplates] = useState<SkillEnvVarTemplate[]>([])
  const [userEnvVars, setUserEnvVars] = useState<SkillEnvVarItem[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState('')

  const userEnvMap = useMemo(() => {
    return new Map(userEnvVars.map((item) => [item.key, item]))
  }, [userEnvVars])

  const loadData = async () => {
    if (!skillId) return

    setLoading(true)
    try {
      // 如果外部已提供 envTemplates，只获取用户环境变量
      if (externalEnvTemplates) {
        setEnvTemplates(externalEnvTemplates)
        const userVars = await skillApi.getMyEnvVars(skillId)
        setUserEnvVars(userVars)
      } else {
        const [detail, userVars] = await Promise.all([
          skillApi.getDetail(skillId),
          skillApi.getMyEnvVars(skillId),
        ])
        setEnvTemplates(detail.env_vars || [])
        setUserEnvVars(userVars)
      }
    } catch (error) {
      message.error('获取环境变量失败，请重试')
      console.error('获取技能环境变量失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const refreshUserEnvVars = async () => {
    const userVars = await skillApi.getMyEnvVars(skillId)
    setUserEnvVars(userVars)
  }

  useEffect(() => {
    if (!open || !skillId) {
      setEditingKey(null)
      setDraftValue('')
      return
    }
    void loadData()
  }, [open, skillId, externalEnvTemplates])

  const handleStartEdit = (key: string) => {
    const current = userEnvMap.get(key)
    setEditingKey(key)
    setDraftValue(current?.value || '')
  }

  const handleCancelEdit = () => {
    setEditingKey(null)
    setDraftValue('')
  }

  const handleSave = async (item: SkillEnvVarTemplate) => {
    const value = draftValue.trim()
    if (!value) {
      message.warning('请输入自定义值')
      return
    }

    const current = userEnvMap.get(item.key)
    setSavingKey(item.key)
    try {
      if (current) {
        await skillApi.updateMyEnvVar(skillId, current.id, {
          key: item.key,
          value,
          sensitive: item.sensitive,
        })
      } else {
        await skillApi.createMyEnvVar(skillId, {
          key: item.key,
          value,
          sensitive: item.sensitive,
        })
      }
      message.success('保存成功')
      await refreshUserEnvVars()
      setEditingKey(null)
      setDraftValue('')
    } catch (error) {
      message.error('保存失败，请重试')
      console.error('保存技能环境变量失败:', error)
    } finally {
      setSavingKey(null)
    }
  }

  const handleClear = (item: SkillEnvVarTemplate) => {
    const current = userEnvMap.get(item.key)
    if (!current) {
      message.info('当前使用企业默认值')
      return
    }

    Modal.confirm({
      title: '清空自定义值',
      content: `确认清空 ${item.key} 的自定义值吗？清空后将恢复企业默认值。`,
      okText: '确认清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await skillApi.deleteMyEnvVar(skillId, current.id)
          message.success('已恢复企业默认值')
          await refreshUserEnvVars()
          if (editingKey === item.key) {
            handleCancelEdit()
          }
        } catch (error) {
          message.error('清空失败，请重试')
          console.error('清空技能环境变量失败:', error)
        }
      },
    })
  }

  return (
    <Drawer
      open={open}
      width={720}
      title={`环境变量设置${skillDisplayName ? ` · ${skillDisplayName}` : ''}`}
      onClose={onClose}
      destroyOnClose
      className="skill-env-vars-drawer"
    >
      <div className="mb-4 rounded-xl border border-[#E7EEF8] bg-[#F8FBFF] px-4 py-3 text-sm text-[#5B657A]">
        这里只展示企业后台已配置的 key，企业默认值不会显示。已设置的自定义值会直接展示并可编辑，清空后会回到企业默认值。
      </div>

      {loading ? (
        <div className="flex min-h-[260px] items-center justify-center">
          <Spin />
        </div>
      ) : envTemplates.length === 0 ? (
        <div className="flex min-h-[260px] items-center justify-center">
          <Empty description="当前技能没有可配置的环境变量" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {envTemplates.map((item) => {
            const current = userEnvMap.get(item.key)
            const isEditing = editingKey === item.key

            return (
              <div
                key={item.key}
                data-testid={`skill-env-var-${item.key}`}
                className="rounded-xl border border-[#E6E8EB] bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[#1D1E1F]">
                        {item.key}
                      </span>
                      <Tag color={item.sensitive ? 'red' : 'blue'}>
                        {item.sensitive ? '敏感' : '普通'}
                      </Tag>
                      <Tag color={current ? 'gold' : 'default'}>
                        {current ? '已设置' : '企业默认'}
                      </Tag>
                    </div>
                    <div className="mt-1 text-xs text-[#8A94A6]">
                      当前设置：
                      <span className="ml-1 break-all font-medium text-[#1D1E1F]">
                        {current ? current.value || '（空）' : MASK_VALUE}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="link"
                      size="small"
                      onClick={() =>
                        isEditing ? handleCancelEdit() : handleStartEdit(item.key)
                      }
                    >
                      {isEditing ? '收起' : '设置'}
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      danger
                      disabled={!current}
                      onClick={() => handleClear(item)}
                    >
                      清空
                    </Button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Input
                      value={draftValue}
                      placeholder="输入自定义值"
                      onChange={(e) => setDraftValue(e.target.value)}
                      className="flex-1"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      type="primary"
                      loading={savingKey === item.key}
                      aria-label="保存"
                      onClick={() => handleSave(item)}
                    >
                      保存
                    </Button>
                    <Button aria-label="取消" onClick={handleCancelEdit}>
                      取消
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Drawer>
  )
}

export default SkillEnvVarsDrawer
