import { RawFileItem, FileItem, RecycleListItem, RawRecycleListItem, TreeBuildNode, TreeNode, FileSearchResponse } from './types'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { api_host } from '@/utils/config'
import { PERMISSION_TYPE } from '@/components/KMPermission/constant'
import { AI_GENERATE_CHUNK_STATUS } from '@/constants/chunk'
import { formatFileSize } from '@km/shared-utils'
import { getPublicPath } from '@/utils/config'

const MAX_ENCODED_FILENAME_LENGTH = 100

const truncateEncodedFileName = (name: string, maxLength: number = MAX_ENCODED_FILENAME_LENGTH): string => {
  if (!name) return name

  const encoded = encodeURIComponent(name)
  if (encoded.length <= maxLength) return encoded

  const dotIndex = name.lastIndexOf('.')
  const hasExtension = dotIndex > 0 && dotIndex < name.length - 1
  const ext = hasExtension ? name.slice(dotIndex) : ''
  const baseName = hasExtension ? name.slice(0, dotIndex) : name
  const encodedExtLen = encodeURIComponent(ext).length
  const budgetForBase = maxLength - encodedExtLen

  let truncatedBase = ''
  let currentLength = 0
  for (const char of baseName) {
    const charEncoded = encodeURIComponent(char)
    if (currentLength + charEncoded.length > budgetForBase) break
    truncatedBase += char
    currentLength += charEncoded.length
  }

  return truncatedBase + ext
}

export const formatFileInfo = (fileName: string, isfolder: boolean = false) : { ext: string, mime: string, fname: string, icon: string } => {
  let file_ext = ''
  let file_mime = ''
  let file_name = fileName?.split('/')?.pop() || ''
  let displayName = file_name
  if (!isfolder) {
    const parts = file_name.split('.')
    const docExts = ['doc', 'docx']
    const excelExts = ['xls', 'xlsx']
    const pptExts = ['ppt', 'pptx']
    const htmlExts = ['html', 'htm']
    const audioExts = ['wav', 'm4a', 'wma', 'aac', 'ogg', 'amr', 'flac', 'aiff', 'mp3']
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico']
    const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm']
    const zipExts = ['zip', 'rar', '7z', 'tar', 'gz']

    // 检查是否是双重扩展名的情况（如 .xls.md, .pdf.md）
    // 如果最后一部分是 'md' 且倒数第二部分是常见的文件扩展名
    const commonExtensions = ['pdf', 'txt', 'csv', 'epub', 'xml', ...docExts, ...excelExts, ...pptExts,  ...htmlExts, ...audioExts, ...imageExts, ...videoExts, ...zipExts]

    if (parts.length >= 3) {
      const lastPart = parts[parts.length - 1]
      const secondLastPart = parts[parts.length - 2]

      if (lastPart === 'md' && commonExtensions.includes(secondLastPart)) {
        // 双重扩展名：取倒数第二个作为真正的扩展名
        file_ext = secondLastPart
        displayName = parts.slice(0, -1).join('.')
      } else {
        // 普通扩展名：取最后一个
        file_ext = lastPart
        displayName = parts.slice(0, -1).join('.')
      }

    } else {
      file_ext = parts.slice(-1)[0] || ''
      displayName = file_name
    }


    if (docExts.includes(file_ext)) {
      file_mime = 'doc'
    } else if (excelExts.includes(file_ext)) {
      file_mime = 'xls'
    } else if (pptExts.includes(file_ext)) {
      file_mime = 'ppt'
    } else if (htmlExts.includes(file_ext)) {
      file_mime = 'html'
    } else if (audioExts.includes(file_ext)) {
      file_mime = 'mp3'
    } else if (videoExts.includes(file_ext)) {
      file_mime = 'mp4'
    } else if (imageExts.includes(file_ext)) {
      file_mime = 'unknown'
    } else if (zipExts.includes(file_ext)) {
      file_mime = 'unknown'
    } else {
      file_mime = file_ext
    }
  } else {
    file_ext = 'folder'
    file_mime = 'folder'
    displayName = fileName
  }



  return {
    ext: file_ext,
    mime: file_mime,
    fname: displayName,
    icon: getPublicPath(`/images/file/${file_mime || 'unknown'}.png`)
  }
}

/**
 * 格式化单个文件项
 */
export const formatFile = (file: RawFileItem): FileItem => {
  const base_path = file.path.split('/').slice(0, -1).join('/')
  const isfolder = file.type === 0
  let fileName = file.path.split('/').pop() || ''


  const { ext: file_ext, mime: file_mime, fname: displayName, icon: file_icon } = formatFileInfo(fileName, isfolder)

  // 兼容文件名包含.的情况
  const urlFileName = file_ext && !displayName.includes(file_ext)
    ? `${displayName}.${file_ext}`
    : displayName;

  return {
    ...file,
    name: displayName,
    isfolder,
    isfile: !isfolder,
    base_path,
    file_ext,
    file_mime,
    permission: PERMISSION_TYPE.loading,
    file_type: isfolder ? 'folder' : 'file',
    icon: file_icon,
    file_url: isfolder ? '' : `${api_host}/api/files/${file.id}/preview/knowledge_file_${file.id}_${truncateEncodedFileName(urlFileName)}`,
    file_size: isfolder ? '' : formatFileSize(file.upload_file?.size || 0) ,
    parse_type: file.parse_type || '',
    last_body_time: file.last_body_time || 0,
    created_at: getSimpleDateFormatString({
      date: file.created_time,
      format: 'YYYY-MM-DD hh:mm'
    }),
    questions: file.questions ? JSON.parse(file.questions) : [],
    updated_at: getSimpleDateFormatString({
      date: file.updated_time,
      format: 'YYYY-MM-DD hh:mm'
    }),
    updated_date: getSimpleDateFormatString({
      date: file.updated_time,
      format: 'MM-DD'
    }),
    cleaning_info: file.cleaning_rule_info ? JSON.parse(file.cleaning_rule_info) : null,
  }
}

/**
 * 构建文件树形结构
 * @param files 格式化后的文件列表
 * @returns 树形结构的文件列表
 */
export const buildFileTree = <T extends TreeBuildNode>(files: T[]): TreeNode<T>[] => {
  // 创建路径到文件的映射
  const pathMap = new Map<string, TreeNode<T>>()
  const tree: TreeNode<T>[] = []

  // 过滤无效文件并初始化所有文件的 children 数组
  const validFiles = files.filter(file => file.path && file.path.trim() !== '')
  validFiles.forEach((file) => {
    file.children = []
    // 标准化路径，确保路径格式一致
    const normalizedPath = file.path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
    pathMap.set(normalizedPath, file)
  })

  // 按路径深度排序，确保父文件夹在子文件夹之前处理
  const sortedFiles = [...validFiles].sort((a, b) => {
    // 更精确的深度计算，过滤空字符串
    const depthA = a.path.split('/').filter(segment => segment !== '').length
    const depthB = b.path.split('/').filter(segment => segment !== '').length
    return depthA - depthB
  })

  // 构建树形结构
  sortedFiles.forEach((file) => {
    // 标准化 base_path
    const normalizedBasePath = file.base_path.replace(/\/+/g, '/').replace(/\/$/, '') || ''

    if (normalizedBasePath === '' || normalizedBasePath === '/') {
      // 根目录下的文件/文件夹
      tree.push(file)
    } else {
      // 查找父文件夹
      const parent = pathMap.get(normalizedBasePath)
      if (parent && parent.isfolder) {
        // 由于已经初始化了 children 数组，直接添加即可
        parent.children!.push(file)
      } else {
        // 如果找不到父文件夹，可能是数据不完整，放到根目录
        console.warn(`找不到父文件夹: ${normalizedBasePath}，将文件 ${file.path} 放到根目录`)
        tree.push(file)
      }
    }
  })

  // 递归排序所有层级的子项，按照 sort 字段排序（sort 越大排越后）
  const sortChildren = (nodes: FileItem[]) => {
    nodes.forEach(node => {
      if (node.children && node.children.length > 0) {
        // 对当前节点的子项按 sort 字段排序
        node.children.sort((a, b) => a.sort - b.sort)
        // 递归排序子项的子项
        sortChildren(node.children)
      }
    })
  }

  // 对根目录也进行排序
  tree.sort((a, b) => a.sort - b.sort)
  // 递归排序所有子项
  sortChildren(tree)

  return tree
}

/**
 * 格式化文件列表并构建树形结构
 * @param files 原始文件列表
 * @returns 树形结构的格式化文件列表
 */
export const formatFileList = (files: RawFileItem[]): FileItem[] => {
  // 先格式化所有文件
  const formattedFiles = files.map(formatFile)

  // 然后构建树形结构
  return buildFileTree(formattedFiles)
}

const MAX_REMAINING_DAYS = 30
export const formatRecycleList = (files: RawRecycleListItem[]): RecycleListItem[] => {
  return files.map((rawItem) => {
    // 先格式化文件信息
    const formattedFile = formatFile(rawItem)

    // 计算删除时间到现在的天数差
    const deletedTime = new Date(rawItem.deleted_at).getTime()
    const currentTime = new Date().getTime()
    const daysPassed = Math.floor((currentTime - deletedTime) / (1000 * 60 * 60 * 24))

    // 计算剩余天数：最多30天，最小可以是负数
    const remainingDays = MAX_REMAINING_DAYS - daysPassed

    return {
      ...formattedFile,
      deleted_time: getSimpleDateFormatString({
        date: rawItem.deleted_at,
        format: 'YYYY-MM-DD hh:mm'
      }),
      remaining_days: remainingDays
    }
  })
}

export const defaultCheckedFile = {
  id: '',
  sort: 0,
  path: '',
  type: 0,
  library_id: '',
  eid: 0,
  created_time: 0,
  updated_time: 0,
  upload_file_id: 0,
  parse_type: '',
  last_body_time: 0,
  ai_generate_chunk_status: AI_GENERATE_CHUNK_STATUS.INACTIVE,
  questions: '',
  summary: '',
  upload_file: null,
  is_favorite: false,
  name: '',
  isfolder: false,
  isfile: false,
  base_path: '',
  file_type: '',
  file_ext: '',
  file_url: '',
  created_at: '',
  icon: '',
  updated_at: '',
  updated_date: '',
  permission: PERMISSION_TYPE.viewer,
  children: [],
  checked: false,
  isEditing: false,
}

/**
 * FileSearchResponse 单条结果的展示态派生。
 *
 * 与 `formatFile` 的区别:
 * - `formatFile` 处理 `RawFileItem`(树形文件列表来源),返回完整的 `FileItem`(含 file_url / file_size / created_at 等)
 * - `formatFileSearchResult` 处理 `FileSearchResponse['results'][number]`(搜索结果来源),只派生展示需要的 name / icon / location / lastUpdated
 *
 * 搜索响应字段名与 `RawFileItem` 不一致(如 `file_id` vs `id`、缺 `upload_file` / `created_time` 等),不可混用。
 */
export type FileSearchResultItem = FileSearchResponse['results'][number] & {
  name: string
  isfolder: boolean
  icon: string
  location: string
  lastUpdated: string
}

export const formatFileSearchResult = (
  item: FileSearchResponse['results'][number]
): FileSearchResultItem => {
  const isfolder = item.type === 0
  const { fname, icon } = formatFileInfo(item.path, isfolder)
  return {
    ...item,
    name: fname,
    isfolder,
    icon,
    location: `${item.space_name}/${item.library_name}`,
    lastUpdated: getSimpleDateFormatString({ date: item.latest_file_body_update_time }),
  }
}

export const formatFileSearchResults = (
  items: FileSearchResponse['results']
): FileSearchResultItem[] => items.map(formatFileSearchResult)
