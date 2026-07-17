import React, { useState } from "react";
import { createPortal } from "react-dom";
import { formatFileSize } from "../../utils";
import FileIcon from "../FileIcon/index";
import "./user.css";

interface FileItem {
  id: string | number;
  filename?: string;
  name?: string;
  file_name?: string;
  url?: string;
  file_url?: string;
  size?: number;
  file_size?: number;
  mime_type?: string;
  file_mime?: string;
}

export interface BubbleUserProps {
  content?: string;
  files?: FileItem[];
  avatar?: string;
  header?: React.ReactNode;
  fileSlot?: React.ReactNode;
  contentSlot?: React.ReactNode;
  contentBefore?: React.ReactNode;
  contentAfter?: React.ReactNode;
  footer?: React.ReactNode;
  menu?: React.ReactNode;
  onFileClick?: (file: FileItem) => void;
  className?: string;
  style?: React.CSSProperties;
}

const BubbleUser: React.FC<BubbleUserProps> = ({
  content = "",
  files = [],
  avatar = "",
  header,
  fileSlot,
  contentSlot,
  contentBefore,
  contentAfter,
  footer,
  menu,
  onFileClick,
  className,
  style,
}) => {
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [currentImage, setCurrentImage] = useState("");

  const openImageViewer = (imageUrl: string) => {
    setCurrentImage(imageUrl);
    setShowImageViewer(true);
  };

  const closeImageViewer = () => {
    setShowImageViewer(false);
  };

  const handleFileClick = (file: FileItem) => {
    if (onFileClick) {
      onFileClick(file);
      return;
    }
    const url = file.url || file.file_url;
    if (url) {
      window.open(url, "_blank");
    }
  };

  const getFileName = (file: FileItem) => file.filename || file.file_name || file.name || "";
  const getFileUrl = (file: FileItem) => file.url || file.file_url || "";
  const getFileMimeType = (file: FileItem) => file.mime_type || file.file_mime || "";
  const getFileSize = (file: FileItem) => file.size ?? file.file_size ?? 0;

  return (
    <div className={`x-bubble ${className || ""}`} style={style}>
      <div className="x-bubble__container">
        {header}

        {fileSlot ||
          (files.length > 0 && (
            <div className="x-bubble__file">
              {files.map((file) =>
                getFileMimeType(file).startsWith("image") ? (
                  <div key={file.id} className="x-bubble__image">
                    <img
                      className="x-bubble__image-preview"
                      onClick={() => openImageViewer(getFileUrl(file))}
                      src={getFileUrl(file)}
                      loading="lazy"
                      alt=""
                    />
                  </div>
                ) : (
                  <div
                    key={file.id}
                    className="x-bubble__file-item"
                    onClick={() => handleFileClick(file)}
                  >
                    <div className="x-bubble__file-icon">
                      <FileIcon
                        name={getFileName(file)}
                        mimeType={getFileMimeType(file)}
                      />
                    </div>
                    <div className="x-bubble__file-info">
                      <div className="x-bubble__file-name">{getFileName(file)}</div>
                      <div className="x-bubble__file-size">
                        {formatFileSize(getFileSize(file))}
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}

        <div className="x-bubble__message-container">
          {contentSlot ||
            (content && (
              <div className="x-bubble__message">
                <p className="x-bubble__message-content">
                  {contentBefore}
                  {content}
                  {contentAfter}
                </p>
              </div>
            ))}
          {avatar && (
            <div className="x-bubble__avatar">
              <img src={avatar} alt="User" />
            </div>
          )}
        </div>

        {footer}

        <div className="x-bubble__menu x-bubble__menu--hidden">{menu}</div>
      </div>

      {showImageViewer &&
        createPortal(
          <div className="x-image-viewer" onClick={closeImageViewer}>
            <div
              className="x-image-viewer__content"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={currentImage}
                loading="lazy"
                alt=""
                className="x-image-viewer__img"
              />
            </div>
            <button
              className="x-image-viewer__close"
              onClick={closeImageViewer}
            >
              ×
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
};

BubbleUser.displayName = "xBubbleUser";

export default BubbleUser;
