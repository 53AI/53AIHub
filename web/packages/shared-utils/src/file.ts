/**
 * 文件工具函数
 */

/** 文件类型扩展名分组 */
const FILE_TYPE_EXTENSIONS = {
  doc: ['doc', 'docx'],
  excel: ['xls', 'xlsx'],
  ppt: ['ppt', 'pptx'],
  html: ['html', 'htm'],
  audio: ['wav', 'm4a', 'wma', 'aac', 'ogg', 'amr', 'flac', 'aiff', 'mp3'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'],
  video: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm'],
  zip: ['zip', 'rar', '7z', 'tar', 'gz'],
} as const

/**
 * 判断是否为 Office 文件
 */
export const isOfficeFile = (extension: string) => {
  return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'].includes(extension)
}

/**
 * KKFileView 支持的文件格式
 */
const KK_FILEVIEW_EXTENSIONS = new Set([
  // Office 文档
  'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'csv', 'tsv',
  'dotm', 'xlt', 'xltm', 'dot', 'dotx', 'xlam', 'xla',
  // WPS Office
  'wps', 'dps', 'et', 'ett', 'wpt',
  // OpenOffice/LibreOffice
  'odt', 'ods', 'ots', 'odp', 'otp', 'six', 'ott', 'fodt', 'fods',
  // Visio
  'vsd', 'vsdx',
  // 图像文件
  'wmf', 'emf', 'psd', 'eps',
  // 文档
  'pdf', 'ofd', 'rtf',
  // 其他
  'xmind', 'bpmn', 'eml', 'msg', 'epub',
  // 3D 模型
  'obj', '3ds', 'stl', 'ply', 'gltf', 'glb', 'off', '3dm', 'fbx', 'dae', 'wrl', '3mf', 'ifc', 'brep', 'step', 'iges', 'fcstd', 'bim',
  // CAD
  'dwg', 'dxf', 'dwf', 'igs', 'dwt', 'dng', 'dwfx', 'cf2', 'plt',
  // 压缩包
  'zip', 'rar', 'jar', 'tar', 'gzip', '7z',
  // 图片
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'ico', 'jfif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'tga', 'svg',
  // 音视频
  'mp3', 'wav', 'mp4', 'flv', 'avi', 'mov', 'rm', 'webm', 'ts', 'mkv', 'mpeg', 'ogg', 'mpg', 'rmvb', 'wmv', '3gp',
  // 医疗影像
  'dcm',
  // 绘图
  'drawio',
])

/**
 * 判断文件是否支持 KKFileView 预览
 */
export const isKKFileViewSupported = (extension: string) => {
  if (!extension) return false
  return KK_FILEVIEW_EXTENSIONS.has(extension.toLowerCase())
}

/**
 * 获取 Office 文件类型
 */
export const getOfficeFileType = (extension: string) => {
  if (['doc', 'docx'].includes(extension)) {
    return 'doc'
  }
  if (['xls', 'xlsx'].includes(extension)) {
    return 'xls'
  }
  if (['ppt', 'pptx'].includes(extension)) {
    return 'ppt'
  }
  return 'pdf'
}

/**
 * 下载文件
 */
export const downloadFile = (data: any, fileName: string) => {
  let content = data
  if (typeof data === 'object') {
    content = JSON.stringify(data)
  }
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 下载图片
 * @param url 图片 URL 或 base64 字符串
 * @param fileName 下载的文件名
 */
export const downloadImage = async (url: string, fileName: string) => {
  try {
    let blob: Blob

    // 如果是 base64 字符串
    if (url.startsWith('data:')) {
      const response = await fetch(url)
      blob = await response.blob()
    } else {
      // 如果是 URL，需要通过 fetch 获取
      const response = await fetch(url)
      blob = await response.blob()
    }

    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  } catch (error) {
    console.error('Download image failed:', error)
    throw error
  }
}

/**
 * 将 SVG 元素转换为图片并下载
 * @param svgElement SVG 元素
 * @param fileName 下载的文件名
 * @param width 图片宽度（可选，默认 SVG 原始宽度）
 * @param height 图片高度（可选，默认 SVG 原始高度）
 */
export const downloadSvgAsImage = async (
  svgElement: SVGElement,
  fileName: string,
  width?: number,
  height?: number
) => {
  const svgData = new XMLSerializer().serializeToString(svgElement)
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)

  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = width || img.width || 200
    canvas.height = height || img.height || 200
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const pngUrl = canvas.toDataURL('image/png')
      downloadImage(pngUrl, fileName)
      URL.revokeObjectURL(svgUrl)
    }
  }
  img.src = svgUrl
}

/**
 * 格式化文件大小
 */
export const formatFileSize = (size: number): string => {
  if (size < 1024) {
    return size + 'B'
  }
  if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2) + 'KB'
  }
  if (size < 1024 * 1024 * 1024) {
    return (size / 1024 / 1024).toFixed(2) + 'MB'
  }
  return (size / 1024 / 1024 / 1024).toFixed(2) + 'GB'
}

/** 格式化文件信息结果 */
export interface FormatFileInfoResult {
  ext: string
  mime: string
  fname: string
  icon: string
}

/**
 * 获取文件图标路径
 * @param mime 文件 MIME 类型标识
 * @returns 图标相对路径
 */
export const getFileIconPath = (mime: string): string => {
  return `/images/file/${mime || 'unknown'}.png`
}

/**
 * 格式化文件信息
 * @param fileName 文件名（可包含路径）
 * @param isfolder 是否是文件夹
 * @returns 文件信息（扩展名、MIME、显示名、图标）
 */
export const formatFileInfo = (fileName: string, isfolder: boolean = false): FormatFileInfoResult => {
  let file_ext = ''
  let file_mime = ''
  let file_name = fileName?.split('/')?.pop() || ''
  let displayName = file_name

  if (!isfolder) {
    const parts = file_name.split('.')
    const allExtensions = [
      'pdf', 'txt', 'csv', 'epub', 'xml',
      ...FILE_TYPE_EXTENSIONS.doc,
      ...FILE_TYPE_EXTENSIONS.excel,
      ...FILE_TYPE_EXTENSIONS.ppt,
      ...FILE_TYPE_EXTENSIONS.html,
      ...FILE_TYPE_EXTENSIONS.audio,
      ...FILE_TYPE_EXTENSIONS.image,
      ...FILE_TYPE_EXTENSIONS.video,
      ...FILE_TYPE_EXTENSIONS.zip,
    ]

    // 处理双重扩展名（如 .xls.md, .pdf.md）
    if (parts.length >= 3) {
      const lastPart = parts[parts.length - 1]
      const secondLastPart = parts[parts.length - 2]

      if (lastPart === 'md' && allExtensions.includes(secondLastPart)) {
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

    // 确定 MIME 类型
    if (FILE_TYPE_EXTENSIONS.doc.includes(file_ext as any)) {
      file_mime = 'doc'
    } else if (FILE_TYPE_EXTENSIONS.excel.includes(file_ext as any)) {
      file_mime = 'xls'
    } else if (FILE_TYPE_EXTENSIONS.ppt.includes(file_ext as any)) {
      file_mime = 'ppt'
    } else if (FILE_TYPE_EXTENSIONS.html.includes(file_ext as any)) {
      file_mime = 'html'
    } else if (FILE_TYPE_EXTENSIONS.audio.includes(file_ext as any)) {
      file_mime = 'mp3'
    } else if (FILE_TYPE_EXTENSIONS.video.includes(file_ext as any)) {
      file_mime = 'mp4'
    } else if (FILE_TYPE_EXTENSIONS.image.includes(file_ext as any)) {
      file_mime = 'unknown'
    } else if (FILE_TYPE_EXTENSIONS.zip.includes(file_ext as any)) {
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
    icon: getFileIconPath(file_mime),
  }
}
