import type { RawFileItem, FileItem, RecycleListItem, RawRecycleListItem } from './types'
import { PERMISSION_TYPE } from './types'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { PARSING_STATUS } from '@/constants/chunk'
import { api_host, getPublicPath } from '@/utils/config'

export const formatFileInfo = (fileName: string): { ext: string; fname: string; icon: string } => {
  let file_ext = ''
  const file_name = fileName.split('/').pop() || ''

  let displayName = file_name
  const parts = file_name.split('.')

  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1]
    const secondLastPart = parts[parts.length - 2]
    const commonExtensions = [
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'txt',
      'jpg',
      'png',
      'gif',
      'htm',
      'html',
      'csv',
    ]

    if (lastPart === 'md' && commonExtensions.includes(secondLastPart)) {
      file_ext = secondLastPart
      displayName = parts.slice(0, -1).join('.')
    } else {
      file_ext = lastPart
      displayName = parts.slice(0, -1).join('.')
    }
  } else {
    file_ext = parts.slice(-1)[0] || ''
    displayName = file_name
  }

  const iconPath = `/images/file/${file_ext}.png`
  return {
    ext: file_ext,
    fname: displayName,
    icon: getPublicPath(iconPath),
  }
}

export const formatFile = (file: RawFileItem): FileItem => {
  const base_path = file.path.split('/').slice(0, -1).join('/')
  const isfolder = file.type === 0
  let file_ext = ''
  const fileName = file.path.split('/').pop() || ''
  let displayName = fileName

  if (!isfolder) {
    const { ext, fname } = formatFileInfo(fileName)
    file_ext = ext
    displayName = fname
  }

  const iconPath = `/images/file/${file_ext || 'folder'}.png`

  return {
    ...(file as any),
    name: displayName,
    isfolder,
    isfile: !isfolder,
    base_path,
    parsing_status: isfolder ? PARSING_STATUS.NORMAL : (file as any).parsing_status,
    file_ext,
    permission: PERMISSION_TYPE.loading,
    file_type: isfolder ? 'folder' : 'file',
    icon: getPublicPath(iconPath),
    file_url: file.upload_file ? `${api_host}/api/preview/${file.upload_file.preview_key || ''}` : '',
    created_at: getSimpleDateFormatString({ date: file.created_time, format: 'YYYY-MM-DD hh:mm' }),
    updated_at: getSimpleDateFormatString({ date: file.updated_time, format: 'YYYY-MM-DD hh:mm' }),
    updated_date: getSimpleDateFormatString({ date: file.updated_time, format: 'MM-DD' }),
  } as any
}

export const buildFileTree = (files: FileItem[]): FileItem[] => {
  console.log('files', files)

  const pathMap = new Map<string, FileItem>()
  const tree: FileItem[] = []

  const validFiles = files.filter(file => file.path && file.path.trim() !== '')
  validFiles.forEach(file => {
    file.children = []
    const normalizedPath = file.path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
    pathMap.set(normalizedPath, file)
  })

  const sortedFiles = [...validFiles].sort((a, b) => {
    const depthA = a.path.split('/').filter(segment => segment !== '').length
    const depthB = b.path.split('/').filter(segment => segment !== '').length
    return depthA - depthB
  })

  sortedFiles.forEach(file => {
    const normalizedBasePath = file.base_path.replace(/\/+/g, '/').replace(/\/$/, '') || ''

    if (normalizedBasePath === '' || normalizedBasePath === '/') {
      tree.push(file)
    } else {
      const parent = pathMap.get(normalizedBasePath)
      if (parent && parent.isfolder) {
        parent.children!.push(file)
      } else {
        console.warn(`找不到父文件夹: ${normalizedBasePath}，将文件 ${file.path} 放到根目录`)
        tree.push(file)
      }
    }
  })

  const sortChildren = (nodes: FileItem[]) => {
    nodes.forEach(node => {
      if (node.children && node.children.length > 0) {
        node.children.sort((a, b) => a.sort - b.sort)
        sortChildren(node.children)
      }
    })
  }

  tree.sort((a, b) => a.sort - b.sort)
  sortChildren(tree)
  console.log('tree', tree)

  return tree
}

export const formatFileList = (files: RawFileItem[]): FileItem[] => {
  const formattedFiles = files.map(formatFile)
  return buildFileTree(formattedFiles)
}

const MAX_REMAINING_DAYS = 30
export const formatRecycleList = (files: RawRecycleListItem[]): RecycleListItem[] => {
  return files.map(rawItem => {
    const formattedFile = formatFile(rawItem)
    const deletedTime = new Date(rawItem.deleted_at).getTime()
    const currentTime = new Date().getTime()
    const daysPassed = Math.floor((currentTime - deletedTime) / (1000 * 60 * 60 * 24))
    const remainingDays = MAX_REMAINING_DAYS - daysPassed
    return {
      ...(formattedFile as any),
      deleted_time: getSimpleDateFormatString({ date: rawItem.deleted_at, format: 'YYYY-MM-DD hh:mm' }),
      remaining_days: remainingDays,
    } as any
  })
}

