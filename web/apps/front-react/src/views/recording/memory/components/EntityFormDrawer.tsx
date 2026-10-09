import { PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, Select, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { SvgIcon } from '@km/shared-components-react';
import { getSimpleDateFormatString } from '@km/shared-utils';
import recordingApi from '@/api/modules/recording';
import type {
  RecordingMemoryEntityDetail,
  RecordingMemoryEntityItem,
  RecordingMemoryEntitySchemas,
  RecordingMemoryEntityType,
} from '@/api/modules/recording/types';
import { factEntityTypeLabel, formatSourceFile, isEnumAttribute } from './utils';
import { FactCard } from './FactCard';
import { RelationPickerModal } from './RelationPickerModal';
import { t } from '@/locales';

// 编辑/添加共用的弹窗组件。按图片排版:
//   - 「记忆」section:记忆类型 chip(添加时可选 / 编辑时锁定) + 名称 + 属性 + 内容
//   - 「相关」section:事实时间线(可标记删除) + 「+ 添加关联」打开选实体弹窗(RelationPickerModal)
//   - footer:取消 / 保存
// 「相关」section 的添加 / 删除不再即时调 API:
//   - 添加:RelationPickerModal 选中实体先入 stagedPickedEntities,保存时由 onSubmit
//     拼到 create/update 请求体的 facts 字段一次性落库。
//   - 删除:点删除仅把 fact.id 入 stagedDeletedFactIds,渲染层过滤掉(用户视觉上消失),
//     保存时由 onSubmit 拼到 update 请求体的 deleted_fact_ids 一次性落库。
// 这样取消操作不会留下脏改动,且 add 模式一次性带 facts 创建、不再有"先建实体再循环建关联"的两步。
export function EntityFormDrawer({
  mode,
  open,
  entity,
  schema,
  onClose,
  onSaved,
}: {
  mode: 'edit' | 'add'
  open: boolean
  entity: RecordingMemoryEntityDetail | null
  schema: RecordingMemoryEntitySchemas
  onClose: () => void
  onSaved: () => void
}) {
  const [form] = Form.useForm()
  // add 模式下默认选 schema 第一个类型；edit 模式用实体自身的类型；初次渲染 schema 还没拿到时回落 'person'。
  const [entityType, setEntityType] = useState<RecordingMemoryEntityType>(
    entity?.entity_type ?? schema[0]?.type ?? 'person',
  )
  const [currentEntity, setCurrentEntity] = useState<RecordingMemoryEntityDetail | null>(entity)
  const [saving, setSaving] = useState(false)
  // 「相关」section 编辑暂存,均在保存时落库:
  //   - stagedPickedEntities:picker 多选结果 → 新增关联 → facts: [{related_entity_id}]
  //   - stagedDeletedFactIds:已标删除的事实 id → deleted_fact_ids
  // 已存的未删除 fact 也会在保存时一并回填 facts: [{ id, related_entity_id }],
  // 让历史数据里 related_entity_id 缺省的事实也能在 update 时拿到完整 shape。
  // 取消操作不会留下脏改动:后端契约由 POST/PATCH 的 facts + deleted_fact_ids 承载。
  // add 模式没有已存事实,只有 stagedPickedEntities 起作用。
  const [relationModalOpen, setRelationModalOpen] = useState(false)
  const [stagedPickedEntities, setStagedPickedEntities] = useState<RecordingMemoryEntityItem[]>([])
  const [stagedDeletedFactIds, setStagedDeletedFactIds] = useState<Array<string | number>>([])
  // 是否打开过抽屉:关闭时只在"打开过→关闭"的转换里清空 form,
  // 避免首次挂载(open=false、表单尚未连接)就调 form 方法触发 antd 的 unhooked 警告。
  const hasOpenedRef = useRef(false)

  // 打开时同步外部 entity / 重置 form;关闭后清空,避免下次打开看到上次残留输入。
  // 暂存区(stagedPickedEntities / stagedDeletedFactIds)在两种模式下都要清空:
  //   - edit:防止上次打开残留的暂存项污染下一次编辑;新 currentEntity 已就位,旧暂存项已无意义。
  //   - add:同上,且 add 模式不会产生 deleted 项,但保险起见也清。
  // 【bug 修复】form 实例挂在常驻的 EntityFormDrawer 上,destroyOnClose 只销毁字段组件、
  // 不清 form store;而 setFieldsValue 内部是深合并(@rc-component/form useForm#setFieldsValue
  // 走 set.merge)而非整体替换。于是"先编辑属性有值的实体 A,再编辑属性为空(或缺字段)的
  // 实体 B"时,B 的属性框会残留 A 的旧值,保存时残留值还会被当成 B 的变更提交。
  // 因此 edit 分支必须先 resetFields() 把 store 整体清空再回填;关闭时也清一次,
  // 让下次打开瞬间字段挂载读到的就是干净 store,不闪现旧值。
  useEffect(() => {
    if (!open) {
      // 关闭动画期间字段仍挂载(form 仍 connected),此时清 store 不会有 unhooked 警告。
      if (hasOpenedRef.current) form.resetFields()
      return
    }
    hasOpenedRef.current = true
    if (mode === 'edit' && entity) {
      // 先整体重置再回填:resetFields 把 store 替换回 initialValues(本组件未设置,即全空),
      // 之后 setFieldsValue 的深合并基准是空 store,不会带上一个实体的残留属性。
      form.resetFields()
      form.setFieldsValue({
        canonical_name: entity.canonical_name,
        summary: entity.summary,
        attributes: entity.attributes ?? {},
      })
      setEntityType(entity.entity_type)
      setCurrentEntity(entity)
      setStagedPickedEntities([])
      setStagedDeletedFactIds([])
    } else {
      form.resetFields()
      // 添加模式:默认选 schema 第一个类型;而不是写死 'person',后端 schema 调整类型顺序/新增类型时无需发版。
      const firstType = schema[0]?.type ?? 'person'
      setEntityType(firstType)
      setCurrentEntity(null)
      setStagedPickedEntities([])
      setStagedDeletedFactIds([])
    }
  }, [open, mode, entity, form])

  const attributeDefs = (schema.find((s) => s.type === entityType)?.attributes ?? []).map((def) => ({
    key: def.key,
    label: def.label,
    options: isEnumAttribute(def.values) ? def.values : undefined,
  }))

  const onSubmit = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (mode === 'edit' && currentEntity) {
        const changedAttributes = Object.fromEntries(
          Object.entries(values.attributes || {}).filter(([key, value]) => value !== currentEntity.attributes[key]),
        ) as Record<string, string>
        // 「相关」section 暂存项统一在保存时落库:
        //   - 已存 fact（未标删）→ facts: [{ id, related_entity_id }]
        //     即使本次没有修改也要带上:历史数据里部分事实只有 id、related_entity_id 缺省,
        //     不重发后端就一直不知道这一条的 related_entity_id,做不了对齐/补齐。
        //     此处 related_entity_id 取自 fact.related_entity_id(可能为 0 或已有值),
        //     将来若支持「编辑已有 fact 的关联实体」,则替换成新选的实体 id。
        //   - stagedPickedEntities → 新增关联 facts: [{ related_entity_id }](无 id,由后端创建)
        //   - stagedDeletedFactIds → deleted_fact_ids (关联记录 id,即 fact.id)
        // 都为空时对应字段不传,后端按"无变更"处理。
        const hasDeleted = stagedDeletedFactIds.length > 0
        const existingFacts = currentEntity.facts
          .filter((fact) => !stagedDeletedFactIds.includes(fact.id))
          .map((fact) => ({
            id: fact.id,
            related_entity_id: String(fact.related_entity_id),
          }))
        const newFacts = stagedPickedEntities.map((p) => ({ related_entity_id: String(p.id) }))
        const allFacts = [...existingFacts, ...newFacts]
        const detail = await recordingApi.updateMemoryEntity(currentEntity.id, {
          canonical_name: values.canonical_name,
          summary: values.summary,
          attributes: Object.keys(changedAttributes).length ? changedAttributes : undefined,
          facts: allFacts.length ? allFacts : undefined,
          deleted_fact_ids: hasDeleted ? stagedDeletedFactIds : undefined,
        })
        setCurrentEntity(detail)
        message.success('记忆已保存')
        onSaved?.()
        onClose()
      } else {
        // 新增实体一次性带 facts 落库:实体不存在期间没有事实可删,所以无 deleted_fact_ids。
        // `related_entity_id` 是被关联实体 id,与 update 路径同形 (见 Request 类型契约)。
        const created = await recordingApi.createMemoryEntity({
          entity_type: entityType,
          canonical_name: values.canonical_name,
          summary: values.summary || undefined,
          attributes: values.attributes,
          facts: stagedPickedEntities.length
            ? stagedPickedEntities.map((p) => ({ related_entity_id: String(p.id) }))
            : undefined,
        })
        setCurrentEntity(created)
        message.success(stagedPickedEntities.length > 0 ? t('memory.add_with_relations_success') : t('memory.add_success'))
        onSaved?.()
        onClose()
      }
    } catch {
      // createMemoryEntity / updateMemoryEntity 已通过 service.X().catch(handleError)
      // 在 API 层弹过 message；这里只做 saving 重置,不再二次提示。
    } finally {
      setSaving(false)
    }
  }

  // 「相关」section 中点击删除 → 仅入栈 stagedDeletedFactIds,渲染层从可见事实里过滤掉(用户视觉上消失)。
  // 不调 API、不刷新实体;最终由 onSubmit 拼到 deleted_fact_ids 一次性落库。
  // 保存失败时再次打开 drawer,该事实会随 GET 响应回来(后端是单一真相源)。
  const handleStageDeleteFact = (factId: string | number) => {
    setStagedDeletedFactIds((prev) => (prev.includes(factId) ? prev : [...prev, factId]))
  }

  // 「+ 添加关联」弹窗确定后的回调:不再调 addMemoryEntityRelation / 任何 relation / fact 接口。
  // 选中的实体先按 id 去重后并入 stagedPickedEntities,UI 立即以 chip 形式展示,
  // 由 onSubmit 拼到 create/update 请求体的 facts 字段落库。
  // add / edit 共用这一段,语义对齐:"都是为这条实体挂一批事实,只是 add 模式连实体本身也是新建"。
  const handlePickRelations = (picked: RecordingMemoryEntityItem[]) => {
    if (picked.length === 0) return
    setStagedPickedEntities((prev) => {
      const existing = new Set(prev.map((p) => p.id))
      const additions = picked.filter((p) => !existing.has(p.id))
      if (additions.length === 0) return prev
      return [...prev, ...additions]
    })
    message.success(t('memory.picked_relation_saved', { n: picked.length }))
  }

  // 类型 chip 选项从 schema 派生,后端 schema 增减类型时前端无需发版。
  // 编辑模式 entity_type 不允许修改,所以这里只用作「添加模式」的可选列表。
  const typeChipOptions: Array<{ key: RecordingMemoryEntityType; label: string }> = schema.map((s) => ({
    key: s.type,
    label: s.label,
  }))

  return (
    <Drawer
      width={620}
      placement="right"
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? '编辑记忆' : '添加记忆'}
      destroyOnClose
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={onSubmit}>保存</Button>
        </div>
      }
    >
      <Form
        form={form}
        layout="vertical"
        className="pb-5"
        requiredMark={(label, info) => (
          <>
            {label}
            {info.required && <span style={{ color: '#ff4d4f', marginLeft: 4 }}>*</span>}
          </>
        )}
      >
        <h3 className="mb-4 text-base font-medium text-primary">记忆</h3>
        <Form.Item label="记忆类型">
          <div className="flex flex-wrap gap-2">
            {typeChipOptions.map((opt) => {
              const isSelected = entityType === opt.key
              const isLocked = mode === 'edit'
              return (
              <button
                type="button"
                key={opt.key}
                disabled={isLocked}
                onClick={() => {
                  setEntityType(opt.key)
                  // 切换类型时清空 attributes, 避免上一个类型的属性残留到新类型的字段里。
                  form.resetFields(['attributes'])
                }}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  isSelected
                    ? isLocked
                      // 编辑模式 + 选中态:用更深一点的蓝色边框 + 灰色背景,与未选中态有视觉差距。
                      ? 'border-blue-300 bg-blue-50 text-theme cursor-not-allowed'
                      : 'border-blue-300 bg-blue-50 text-theme'
                    : isLocked
                      // 编辑模式 + 未选中:整体灰化,鼠标移上去也不变色,提示"不可改"。
                      ? 'border-slate-200 bg-white text-slate-200 cursor-not-allowed hover:border-slate-200'
                      : 'border-slate-200 bg-white text-primary hover:border-slate-300'
                }`}
              >
                {opt.label}
                <span className={isSelected ? 'text-theme' : 'text-slate-200'}>
                  <SvgIcon name={isSelected ? 'check-one-filled' : 'check-round'}></SvgIcon>
                </span>
              </button>
              )
            })}
          </div>
        </Form.Item>
        <Form.Item label="名称" name="canonical_name" rules={[{ required: true, message: '请输入实体名称' }]}>
          <Input maxLength={50} showCount placeholder="如:张智伟" />
        </Form.Item>
        {attributeDefs.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 text-sm text-[#1D1E1F]">属性</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-5 bg-[#F9F9F9] rounded-xl">
              {attributeDefs.map((field) => (
                <Form.Item key={field.key} label={field.label} name={['attributes', field.key]} className="!mb-2">
                  {field.options ? (
                    <Select allowClear options={field.options} placeholder={`请选择${field.label}`} />
                  ) : (
                    <Input maxLength={50} showCount placeholder={`请输入${field.label}`} />
                  )}
                </Form.Item>
              ))}
            </div>
          </div>
        )}
        <Form.Item label="内容" name="summary" >
          <Input.TextArea rows={5} maxLength={500} showCount style={{ resize: 'none' }} placeholder="记录对该实体的整体认知与总结" />
        </Form.Item>
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium text-[#1D1E1F]">相关</h3>
          </div>
          {/* 「相关」section 合并渲染:已存 fact(未标删) + 暂存新增关联,按时间倒序排成一条时间线。
              之前分两块渲染会让新加的关联全堆在已存事实之后;合并排序后,新加的立即按 last_fact_at
              插到对应位置,不再"暂存都堆在末尾"。
              时间字段统一用 sortTime:已存取 occurred_at,暂存取 item.last_fact_at;
              视觉上仍用 variant 区分(深蓝/浅蓝圆点 + 是否带删除按钮)。 */}
          {(() => {
            const persistedCards = currentEntity
              ? currentEntity.facts
                  // 过滤掉暂存为"待删除"的事实:用户在编辑模式下点删除后,事实立刻从列表消失(用户视觉上"消失")。
                  // 这是纯本地操作,真正的删除发生在 onSubmit 拼到 deleted_fact_ids 后由后端处理。
                  .filter((fact) => !stagedDeletedFactIds.includes(fact.id))
                  .map((fact) => ({
                    key: `persisted-${fact.id}`,
                    variant: 'persisted' as const,
                    sortTime: fact.occurred_at || 0,
                    time: fact.occurred_at ? getSimpleDateFormatString({ date: fact.occurred_at, format: 'YYYY-MM-DD hh:mm' }) : '--',
                    sourceLabel: formatSourceFile(fact.source_file),
                    body: fact.content,
                    typeLabel: factEntityTypeLabel(fact.related_type || fact.entity_type, schema),
                    deleteAriaLabel: '删除',
                    onDelete: () => handleStageDeleteFact(fact.id),
                  }))
              : []
            const stagedCards = stagedPickedEntities.map((item) => ({
              key: `staged-${item.id}`,
              variant: 'staged' as const,
              sortTime: item.last_fact_at || 0,
              time: item.last_fact_at ? getSimpleDateFormatString({ date: item.last_fact_at, format: 'YYYY-MM-DD hh:mm' }) : '--',
              sourceLabel: formatSourceFile(item.source_file) || '--',
              body: item.canonical_name,
              typeLabel: factEntityTypeLabel(item.entity_type, schema),
              deleteAriaLabel: '移除',
              onDelete: () => setStagedPickedEntities((prev) => prev.filter((p) => p.id !== item.id)),
            }))
            const timelineCards = [...persistedCards, ...stagedCards].sort((a, b) => b.sortTime - a.sortTime)
            if (timelineCards.length === 0) return null
            return (
              <div className="relative space-y-3 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-[#E8EAED]">
                {timelineCards.map((card) => (
                  <FactCard
                    key={card.key}
                    variant={card.variant}
                    time={card.time}
                    sourceLabel={card.sourceLabel}
                    body={card.body}
                    typeLabel={card.typeLabel}
                    deleteAriaLabel={card.deleteAriaLabel}
                    onDelete={card.onDelete}
                  />
                ))}
              </div>
            )
          })()}
          <div
            className="mt-3 cursor-pointer h-20 bg-[#fafbfc] text-primary rounded-xl flex-center gap-1 border border-dashed hover:bg-slate-100"
            onClick={() => setRelationModalOpen(true)}
          >
            <PlusOutlined />
            添加关联
          </div>
        </section>
      </Form>
      <RelationPickerModal
        open={relationModalOpen}
        onClose={() => setRelationModalOpen(false)}
        onConfirm={handlePickRelations}
        schema={schema}
        excludeEntityId={currentEntity?.id}
        excludeFactsIds={Array.from(
          new Set([
            // picker 的排除项语义是"已被这条实体关联到的实体 id"(与 row.dataIndex=id 对齐)。
            // 当前实体已存的每条 fact 的 related_entity_id 才指"被关联实体",而 fact.id 是关联记录自己的 id;
            // 自动提取时这两者可能不一致,手动添加时二者相同。
            // 因此必须用 r.related_entity_id 而不是 r.id,否则自动提取路径下 excluded 集合根本匹配不到实体,过滤失效。
            ...(currentEntity?.facts.map((r) => r.related_entity_id) ?? []),
            // 已暂存的新增关联目标(用 entity.id → 将作为 related_entity_id 落库)。
            ...stagedPickedEntities.map((p) => p.id),
          ]),
        )}
      />
    </Drawer>
  )
}
