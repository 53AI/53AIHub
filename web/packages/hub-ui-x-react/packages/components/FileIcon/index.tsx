import React, { useMemo } from 'react';
import './index.css';

interface FileIconProps {
  name: string;
  mimeType?: string;
}

const FileIcon: React.FC<FileIconProps> = ({ name, mimeType = '' }) => {
  const fileExtension = useMemo(() => {
    const ext = name?.split('.').pop()?.toLowerCase();
    return ext || '';
  }, [name]);

  const iconClass = useMemo(() => {
    const ext = fileExtension;
    const mime = mimeType.toLowerCase();

    // 图片文件
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
      return 'x-file-icon--image';
    }

    // 文档文件
    if (['doc', 'docx', 'pdf', 'txt', 'rtf', 'odt'].includes(ext)) {
      return 'x-file-icon--document';
    }

    // 表格文件
    if (['xls', 'xlsx', 'csv'].includes(ext)) {
      return 'x-file-icon--spreadsheet';
    }

    // 演示文件
    if (['ppt', 'pptx'].includes(ext)) {
      return 'x-file-icon--presentation';
    }

    // 音频文件
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
      return 'x-file-icon--audio';
    }

    // 视频文件
    if (mime.startsWith('video/') || ['mp4', 'avi', 'mov', 'wmv'].includes(ext)) {
      return 'x-file-icon--video';
    }

    // 压缩文件
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return 'x-file-icon--archive';
    }

    // 代码文件
    if (['js', 'ts', 'py', 'java', 'cpp', 'cs', 'php', 'html', 'css', 'vue', 'jsx', 'tsx'].includes(ext)) {
      return 'x-file-icon--code';
    }

    // 默认文件图标
    return 'x-file-icon--default';
  }, [fileExtension, mimeType]);

  return (
    <div className={`x-file-icon ${iconClass}`}>
      <div className="x-file-icon__extension">{fileExtension}</div>
    </div>
  );
};

FileIcon.displayName = 'xFileIcon';

export default FileIcon;
