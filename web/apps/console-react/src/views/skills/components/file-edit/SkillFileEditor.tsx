import { Button, Spin } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import { SvgIcon } from '@km/shared-components-react'
import { useSkillEditStore } from '@/stores/modules/skillEdit'
import { api_host } from '@/utils/config'
import { getEditorConfig } from '../../utils/skillFileEditorConfig'
import SkillCodeEditor from './SkillCodeEditor'
import UnsavedConfirmModal from './UnsavedConfirmModal'
import KKFileView from '@/components/KKFileView'
import { t } from '@/locales'

/** 不支持的文件类型提示 */
function UnsupportedViewer() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <WarningOutlined className="text-tag-red text-5xl" />
      <p className="text-lg my-2">{t("skills.editor.unsupported_file")}</p>
    </div>
  )
}

export function SkillFileEditor() {
  const {
    skillId,
    currentFile,
    currentFileContent,
    contentLoading,
    isCurrentFileDirty,
    updateCurrentContent,
    saveCurrentToPending,
  } = useSkillEditStore()

  // 构建 KKFileView 预览 URL
  const kkfileviewUrl = skillId && currentFile
    ? (() => {
        const baseUrl = `${api_host}/api/admin/skill-library/${skillId}/files-preview/${encodeURIComponent(currentFile.path)}`
        const token = localStorage.getItem('access_token') || ''
        return token ? `${baseUrl}?access_token=${encodeURIComponent(token)}` : baseUrl
      })()
    : ''

  // 加载中
  if (contentLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin size="large" />
      </div>
    )
  }

  // 获取编辑器配置
  const editorConfig = getEditorConfig(currentFile)
  const isEditable = editorConfig.editable

  // 处理内容变更
  const handleContentChange = (value: string) => {
    if (isEditable) {
      updateCurrentContent(value)
    }
  }

  // 处理保存
  const handleSave = () => {
    saveCurrentToPending()
  }

  // 根据编辑器类型渲染
  const renderEditor = () => {
    // 可编辑
    if (editorConfig.type === 'codemirror') {
      return (
        <SkillCodeEditor
          content={currentFileContent}
          language={editorConfig.language}
          editable={isEditable}
          onChange={handleContentChange}
        />
      )
    }

    if (editorConfig.type === 'kkfileview') {
      return kkfileviewUrl ? (
        <KKFileView url={kkfileviewUrl} />
      ) : (
        <UnsupportedViewer />
      )
    }

    return <UnsupportedViewer />
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 文件名和保存按钮 */}
      {currentFile && (
        <div className="h-12 flex-none flex items-center justify-between px-4 py-3 border-b border-[#E9EEF7] bg-[#F7F9FC]">
          <div className="flex items-center gap-2 p-[5px] text-md rounded bg-[#F2F3F5]">
            <SvgIcon name="file_v2" size={16} />
            {currentFile.name}
          </div>
          {isEditable && isCurrentFileDirty && (
            <Button
              color="primary"
              variant="filled"
              onClick={handleSave}
            >
              {t("action_save")}
            </Button>
          )}
        </div>
      )}

      {/* 编辑器区域 */}
      <div className="flex-1 overflow-hidden relative">
        {renderEditor()}
        {/* 二次确认弹窗 */}
        <UnsavedConfirmModal />
      </div>
    </div>
  )
}

export default SkillFileEditor