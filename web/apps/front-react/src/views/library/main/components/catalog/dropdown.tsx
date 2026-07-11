import { useMemo } from 'react'
import { Dropdown } from '@km/shared-components-react'
import type { MenuProps } from 'antd'
import { getPublicPath } from '@/utils/config'
import { t } from '@/locales'

interface CatalogDropdownProps {
  filter?: 'all' | 'create' | 'upload'
  placement?: 'top' | 'topLeft' | 'topRight' | 'bottom' | 'bottomLeft' | 'bottomRight'
  trigger?: ('click' | 'hover' | 'contextMenu')[]
  disabled?: boolean
  children?: React.ReactNode
  // Callbacks - either use individual callbacks or onCommand
  onCreateMd?: () => void
  onCreateFolder?: () => void
  onUploadFile?: () => void
  onUploadFolder?: () => void
  onCommand?: (command: string) => void
}

export function CatalogDropdown({
  filter = 'all',
  placement = 'bottomLeft',
  trigger = ['click'],
  disabled = false,
  children,
  onCreateMd,
  onCreateFolder,
  onUploadFile,
  onUploadFolder,
  onCommand
}: CatalogDropdownProps) {
  const showCreate = useMemo(() => {
    return !filter || filter === 'all' || filter === 'create'
  }, [filter])

  const showUpload = useMemo(() => {
    return !filter || filter === 'all' || filter === 'upload'
  }, [filter])

  const handleMenuClick = (key: string) => {
    if (onCommand) {
      onCommand(key)
    } else {
      switch (key) {
        case 'create_md':
          onCreateMd?.()
          break
        case 'create_folder':
          onCreateFolder?.()
          break
        case 'upload_file':
          onUploadFile?.()
          break
        case 'upload_folder':
          onUploadFolder?.()
          break
      }
    }
  }

  const menuItems: MenuProps['items'] = useMemo(() => {
    const items: MenuProps['items'] = []

    if (showCreate) {
      items.push({
        key: 'create_md',
        label: (
          <div className="flex items-center">
            <img className="size-4 mr-1" src={getPublicPath('/images/export/new.png')} alt="" />
            {t('library.create_md')}
          </div>
        ),
        onClick: () => handleMenuClick('create_md')
      })
      items.push({
        key: 'create_folder',
        label: (
          <div className="flex items-center">
            <img className="size-4 mr-1" src={getPublicPath('/images/export/folder.png')} alt="" />
            {t('library.create_folder')}
          </div>
        ),
        onClick: () => handleMenuClick('create_folder')
      })
    }

    if (showUpload) {
      if (showCreate) {
        items.push({
          type: 'divider',
          key: 'divider-1'
        })
        items.push({
          key: 'upload_file',
          label: (
            <div className="flex items-center">
              <img className="size-4 mr-1" src={getPublicPath('/images/export/upload_file.png')} alt="" />
              {t('library.upload_file')}
            </div>
          ),
          onClick: () => handleMenuClick('upload_file')
        })
      } else {
        items.push({
          key: 'upload_file',
          label: (
            <div className="flex items-center">
              <img className="size-4 mr-1" src={getPublicPath('/images/export/upload_file.png')} alt="" />
              {t('library.upload_file')}
            </div>
          ),
          onClick: () => handleMenuClick('upload_file')
        })
      }
      items.push({
        key: 'upload_folder',
        label: (
          <div className="flex items-center">
            <img className="size-4 mr-1" src={getPublicPath('/images/export/upload_folder.png')} alt="" />
            {t('library.upload_folder')}
          </div>
        ),
        onClick: () => handleMenuClick('upload_folder')
      })
    }

    return items
  }, [showCreate, showUpload, onCreateMd, onCreateFolder, onUploadFile, onUploadFolder, onCommand, t])

  return (
    <Dropdown
      menu={{ items: menuItems }}
      placement={placement}
      trigger={trigger}
      disabled={disabled}
      classNames={{ root: 'catalog-dropdown-menu' }}
    >
      {children}
    </Dropdown>
  )
}

export default CatalogDropdown
