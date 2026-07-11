import { Button } from 'antd';
import { ExclamationCircleFilled } from '@ant-design/icons';
import { SvgIcon } from '@km/shared-components-react';
import { useSkillEditStore } from '@/stores/modules/skillEdit';
import { t } from "@/locales";

export function UnsavedConfirmModal() {
  const { confirmModalState, hideConfirmModal } = useSkillEditStore()

  if (!confirmModalState.visible) return null

  const handleConfirm = () => {
    confirmModalState.onConfirm?.()
  }

  const handleCancel = () => {
    confirmModalState.onCancel?.()
  }

  const message = confirmModalState.message || t("skills.unsaved_confirm_message")
  const confirmText = confirmModalState.confirmText || t("action_confirm")

  return (
    <div className="absolute inset-0 bg-[#333]/50 flex items-center justify-center z-10">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 border border-[#E9EEF7] relative">
        {/* 关闭按钮 */}
        <div
          className="absolute top-3 right-3 cursor-pointer text-gray-400 hover:text-gray-600"
          onClick={handleCancel}
        >
          <SvgIcon name="close" size={16} />
        </div>
        <div className="flex items-center gap-3 mb-4">
          <ExclamationCircleFilled className="text-[#FAAD14] text-2xl" />
          <h3 className="text-base font-medium text-primary">{ t("tip") }</h3>
        </div>
        <p className="text-sm text-tertiary mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={handleCancel}>{ t("action.cancel") }</Button>
          <Button type="primary" onClick={handleConfirm}>{confirmText}</Button>
        </div>
      </div>
    </div>
  )
}

export default UnsavedConfirmModal