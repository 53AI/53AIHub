import { Button, Modal, message } from 'antd';
import { useEffect, useState } from 'react';
import recordingApi from '@/api/modules/recording';
import type { RecordingMemoryEntityItem } from '@/api/modules/recording/types';
import { t } from '@/locales';

// 「记忆融合」弹窗：用户在已选的 2 个实体里挑 1 个保留（target），
// 另一个（source）被合并进去，后端接口 mergeMemoryEntities([source], target) 承担。
//
// 容器走 antd Modal，标题 / 取消 / 确认由 Modal 控制；内部保留设计稿的
// 「两张源卡 + SVG 合并箭头 + 目标卡」结构。
export function MergeEntityModal({
  open,
  entities,
  onClose,
  onSuccess,
}: {
  open: boolean
  // 严格要求长度为 2；调用方在打开前已校验选择数，这里再 defensive check 一次。
  entities: [RecordingMemoryEntityItem, RecordingMemoryEntityItem]
  onClose: () => void
  onSuccess?: () => void
}) {
  // 默认保留第一张；每次重新打开弹窗都归位到默认，避免上次的脏选择泄漏过来。
  const [keepId, setKeepId] = useState<string | number>(entities[0]?.id ?? '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setKeepId(entities[0]?.id ?? '')
      setSubmitting(false)
    }
  }, [open, entities])

  if (entities.length !== 2) return null

  const keepEntity = entities.find((e) => e.id === keepId) ?? entities[0]
  const dropEntity = entities.find((e) => e.id !== keepId) ?? entities[1]

  const handleConfirm = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      // 接口语义：source 被合并到 target（target 保留）；这里 drop → keep。
      // sourceIds 取数组形式，后端优先用 source_ids，保留对单源 source_id 的兼容。
      await recordingApi.mergeMemoryEntities([dropEntity.id], keepEntity.id)
      message.success(t('memory.merge_success'))
      onSuccess?.()
      onClose()
    } catch {
      // mergeMemoryEntities 已通过 .catch(handleError) 在 API 层弹过 message，这里只重置 submitting。
    } finally {
      setSubmitting(false)
    }
  }

  const cardSubtitle = (entity: RecordingMemoryEntityItem) =>
    t('memory.merge_card_stats', { n: entity.fact_count })

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={800}
      title={t('memory.merge_modal_title')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} disabled={submitting}>
            {t('memory.merge_cancel')}
          </Button>
          <Button type="primary" loading={submitting} onClick={handleConfirm}>
            {t('memory.merge_confirm')}
          </Button>
        </div>
      }
      destroyOnClose
      styles={{ body: { paddingTop: 8, paddingBottom: 24 } }}
    >
      {/* 源卡行：两张并排，选中态走蓝色边框 + 蓝色实心圆点 */}
      <div className="grid grid-cols-2 gap-6">
        {entities.map((entity) => {
          const selected = entity.id === keepId
          return (
            <button
              type="button"
              key={entity.id}
              onClick={() => setKeepId(entity.id)}
              className={`relative text-left rounded-xl p-4 transition-colors border  ${
                selected ? 'border-[#2563EB] !bg-[#F5F8FF]' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-base text-[#1D1E1F] truncate">
                  {entity.canonical_name}
                </span>
                {
                  selected && (<span className="flex-none size-4 rounded-full flex items-center justify-center transition-colors bg-[#2563EB]">
                    <span className="size-2 rounded-full bg-white" />
                  </span>)
                }
                
              </div>
              <div className="border-t my-3" />
              <p className="text-xs text-[#999999]">{cardSubtitle(entity)}</p>
            </button>
          )
        })}
      </div>

      <div className="relative h-16">
        <svg
          viewBox="0 0 400 64"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          aria-hidden
        >
          {/* 左源卡 → 中心 → 目标卡。
              拐角 1 在 (100,50)：竖线停在 y=42，Q 控制点放在拐角，终点 (108,50) 形成 1/4 圆弧。
              拐角 2 在 (200,50)：水平线停在 x=192（从左侧向右接近拐角），
              Q 控制点放在拐角，终点 (200,58) 再 1/4 圆弧。r=8 整条线三个拐弯都是圆角。 */}
          <path
            d="M 100 0 L 100 42 Q 100 50 108 50 L 192 50 Q 200 50 200 58 L 200 64"
            stroke="#2563EB"
            strokeWidth="1"
            strokeDasharray="4 4"
            strokeLinecap="round"
            fill="none"
          />

          {/* 右源卡 → 中心 → 目标卡。镜像版本：水平线从右侧向左停在 x=208，
              让 L 段方向（向左）与 Q 进入切线（向左，指向控制点 200,50）对齐，
              否则在 (200,50) 会形成 180° 折返，圆角出不来。 */}
          <path
            d="M 300 0 L 300 42 Q 300 50 292 50 L 208 50 Q 200 50 200 58 L 200 64"
            stroke="#2563EB"
            strokeWidth="1"
            strokeDasharray="4 4"
            strokeLinecap="round"
            fill="none"
          />

          {/* 水平段中点的实心三角箭头，8×8 viewBox 单位，
              经 preserveAspectRatio=none 横向拉伸后约 15×8 像素，比线粗有足够存在感。
              左线中点 (150,50) 朝右；右线中点 (250,50) 朝左。 */}
          <polygon points="146,46 154,50 146,54" fill="#2563EB" />
          <polygon points="254,46 246,50 254,54" fill="#2563EB" />
        </svg>
        {/* 居中提示文字：bg-white 把穿过的虚线段遮掉，保证文字可读。
            用 pointer-events-none 避免文字拦截下层 SVG 的鼠标事件（虽然 SVG 是装饰性的）。 */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="px-3 bg-white text-sm text-[#1D1E1F]">
            {t('memory.merge_hint')}
          </span>
        </div>
      </div>

      {/* 目标卡：独立居中，与上方箭头无视觉连接 */}
      <div className="mx-auto w-[calc(50%-12px)]">
        <div className="rounded-xl border border-[#2563EB] p-4 bg-[#F5F8FF]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-base text-[#1D1E1F] truncate">
              {keepEntity.canonical_name}
            </span>
            <span className="flex-none size-4 rounded-full flex items-center justify-center transition-colors bg-[#2563EB]">
              <span className="size-2 rounded-full bg-white" />
            </span>
          </div>
          <div className="border-t my-3" />
          <p className="text-xs text-[#999999]">{cardSubtitle(keepEntity)}</p>
        </div>
      </div>
    </Modal>
  )
}