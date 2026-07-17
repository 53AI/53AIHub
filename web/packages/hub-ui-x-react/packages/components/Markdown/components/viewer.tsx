import React, { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../../Icon/index.tsx";
import Tooltip from "../../Tooltip";
import { copyToClip } from "../../../utils/copy";
import { onClickOutside } from "../../../utils/helper";
import { t } from "../../../locale";
import "./viewer.css";

interface ViewerProps {
  value: string;
  hideImageTab?: boolean;
  viewerClass?: string;
  viewerStyle?: React.CSSProperties;
  imageContent: React.ReactNode;
  onRefresh?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFullscreen?: (isFullscreen: boolean) => void;
  onDownloadImage?: () => void;
  onCopyImage?: () => void;
}

const Viewer: React.FC<ViewerProps> = ({
  value,
  hideImageTab = false,
  viewerClass = "",
  viewerStyle,
  imageContent,
  onRefresh,
  onZoomIn,
  onZoomOut,
  onFullscreen,
  onDownloadImage,
  onCopyImage,
}) => {
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const imageContentRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"image" | "code">("image");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSelected, setIsSelected] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSelect = () => {
    setIsSelected(true);
  };

  const handleMouseEnter = () => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current);
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current);
    }
    hoverTimeout.current = setTimeout(() => setIsHovered(false), 600);
  };

  const handleRefresh = () => {
    onRefresh?.();
    setZoomLevel(1);
  };

  const handleZoomIn = () => {
    onZoomIn?.();
    setZoomLevel((prev) => +(prev * 1.2).toFixed(2));
  };

  const handleZoomOut = () => {
    onZoomOut?.();
    setZoomLevel((prev) => +(prev / 1.2).toFixed(2));
  };

  const handleFullscreen = () => {
    setIsFullscreen((prev) => {
      const next = !prev;
      onFullscreen?.(next);
      return next;
    });
  };

  const downloadImage = () => {
    setIsDropdownOpen(false);
    onDownloadImage?.();
  };

  const copyImage = () => {
    setIsDropdownOpen(false);
    onCopyImage?.();
  };

  const copyMarkdown = () => {
    copyToClip(value);
    setIsDropdownOpen(false);
  };

  const onZoomChange = useCallback((event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    if (typeof detail === "number") {
      setZoomLevel(detail);
    }
  }, []);

  useEffect(() => {
    if (hideImageTab && mode === "image") {
      setMode("code");
    }
  }, [hideImageTab, mode]);

  useEffect(() => {
    const cleanup = onClickOutside(dropdownRef.current as Node, () => {
      setIsDropdownOpen(false);
      setIsSelected(false);
    });
    return () => cleanup.destroy();
  }, []);

  useEffect(() => {
    const node = imageContentRef.current;
    if (!node) return;
    node.addEventListener("zoomChange", onZoomChange);
    return () => node.removeEventListener("zoomChange", onZoomChange);
  }, [onZoomChange]);

  // ESC 键退出全屏
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleFullscreen();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  return (
    <div
      className={`x-diagram-viewer ${viewerClass} ${isFullscreen ? "x-diagram-viewer--fixed" : ""} ${isHovered ? "is-hovered" : ""}`}
      style={viewerStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="x-diagram-viewer__header"
        style={{ display: isFullscreen ? "flex" : "none" }}
      >
        <div className="x-diagram-viewer__tabs-container">
          {isFullscreen && (
            <div className="x-diagram-viewer__tabs">
              {!hideImageTab && (
                <div
                  className={`x-diagram-viewer__tab ${mode === "image" ? "x-diagram-viewer__tab--active" : ""}`}
                  onClick={() => setMode("image")}
                >
                  {t("hubx.bubble.image")}
                </div>
              )}
              <div
                className={`x-diagram-viewer__tab ${mode === "code" ? "x-diagram-viewer__tab--active" : ""}`}
                onClick={() => setMode("code")}
              >
                {t("hubx.bubble.code")}
              </div>
            </div>
          )}
        </div>
        {isFullscreen && mode === "image" && (
          <div className="x-diagram-viewer__center">
            <span className="x-diagram-viewer__icon" onClick={downloadImage}>
              <Icon size="18px" name="download" />
              <span>{t("hubx.bubble.download_image")}</span>
            </span>
            <span className="x-diagram-viewer__icon" onClick={copyImage}>
              <Icon size="18px" name="copy" />
              <span>{t("hubx.bubble.copy_image")}</span>
            </span>
          </div>
        )}
        <div
          className="x-diagram-viewer__actions"
          style={{ display: mode === "image" ? "flex" : "none" }}
        >
          {!isFullscreen && (
            <>
              <div className="x-diagram-viewer__dropdown" ref={dropdownRef}>
                <span
                  className="x-diagram-viewer__dropdown-trigger"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                  <span className="x-diagram-viewer__icon">
                    <Icon size="18px" name="download" />
                  </span>
                  <span className="x-diagram-viewer__icon">
                    <Icon size="10px" name="down" />
                  </span>
                </span>
                {isDropdownOpen && (
                  <div className="x-diagram-viewer__dropdown-menu">
                    <div
                      className="x-diagram-viewer__dropdown-item"
                      onClick={downloadImage}
                    >
                      {t("hubx.bubble.download_image")}
                    </div>
                    <div
                      className="x-diagram-viewer__dropdown-item"
                      onClick={copyImage}
                    >
                      {t("hubx.bubble.copy_image")}
                    </div>
                  </div>
                )}
              </div>
              <div className="x-diagram-viewer__line"></div>
            </>
          )}
          <Tooltip
            content={t("hubx.bubble.zoom_out")}
            placement="top"
            trigger="hover"
          >
            <span className="x-diagram-viewer__icon" onClick={handleZoomOut}>
              <Icon size="18px" name="zoom-out" />
            </span>
          </Tooltip>
          <Tooltip
            content={t("hubx.bubble.zoom_in")}
            placement="top"
            trigger="hover"
          >
            <span className="x-diagram-viewer__icon" onClick={handleZoomIn}>
              <Icon size="18px" name="zoom-in" />
            </span>
          </Tooltip>
          <Tooltip
            content={t("hubx.bubble.adaption")}
            placement="top"
            trigger="hover"
          >
            <span className="x-diagram-viewer__icon" onClick={handleRefresh}>
              <Icon size="18px" name="fullscreen" />
            </span>
          </Tooltip>
          {isFullscreen && <div className="x-diagram-viewer__line"></div>}
          {isFullscreen ? (
            <span className="x-diagram-viewer__icon" onClick={handleFullscreen}>
              <Icon size="18px" name="close" />
            </span>
          ) : (
            <Tooltip
              content={t("hubx.bubble.fullscreen")}
              placement="top"
              trigger="hover"
            >
              <span
                className="x-diagram-viewer__icon"
                onClick={handleFullscreen}
              >
                <Icon size="18px" name="expand" />
              </span>
            </Tooltip>
          )}
        </div>
        <div
          className="x-diagram-viewer__actions"
          style={{ display: mode === "code" ? "flex" : "none" }}
        >
          <Tooltip
            content={t("hubx.bubble.copy")}
            placement="top"
            trigger="hover"
          >
            <span className="x-diagram-viewer__icon" onClick={copyMarkdown}>
              <Icon size="18px" name="copy" />
            </span>
          </Tooltip>
          {isFullscreen && (
            <span className="x-diagram-viewer__icon" onClick={handleFullscreen}>
              <Icon size="18px" name="close" />
            </span>
          )}
        </div>
      </div>
      <div
        className={`x-diagram-viewer__content ${!isFullscreen && (isSelected || isHovered) ? "x-diagram-viewer__content--selected" : ""}`}
        onClick={handleSelect}
      >
        <div
          className="x-diagram-viewer__image-content"
          style={{ display: mode === "image" ? "block" : "none" }}
          ref={imageContentRef}
        >
          {imageContent}
        </div>
        <div
          className="x-diagram-viewer__code"
          style={{ display: mode === "code" ? "block" : "none" }}
        >
          <pre className="x-diagram-viewer__code-pre">{value}</pre>
        </div>
        <div
          className="x-diagram-viewer__content-tooltip"
          style={{
            display:
              (isSelected && !isFullscreen) || (!isFullscreen && isHovered)
                ? "block"
                : "none",
          }}
        >
          <div
            className="x-diagram-viewer__actions"
            style={{ display: mode === "image" ? "flex" : "none" }}
          >
            {!isFullscreen && (
              <>
                <Tooltip
                  content={t("hubx.bubble.adaption")}
                  placement="top"
                  trigger="hover"
                >
                  <span
                    className="x-diagram-viewer__icon"
                    onClick={handleRefresh}
                  >
                    <Icon size="18px" name="fullscreen" />
                  </span>
                </Tooltip>
                <div className="x-diagram-viewer__line"></div>
              </>
            )}
            <Tooltip
              content={t("hubx.bubble.zoom_out")}
              placement="top"
              trigger="hover"
            >
              <span className="x-diagram-viewer__icon" onClick={handleZoomOut}>
                <Icon size="18px" name="zoom-out" />
              </span>
            </Tooltip>
            <span className="x-diagram-viewer__zoom-level">
              {(zoomLevel * 100).toFixed(0)}%
            </span>
            <Tooltip
              content={t("hubx.bubble.zoom_in")}
              placement="top"
              trigger="hover"
            >
              <span className="x-diagram-viewer__icon" onClick={handleZoomIn}>
                <Icon size="18px" name="zoom-in" />
              </span>
            </Tooltip>
            <Tooltip
              content={t("hubx.bubble.fullscreen")}
              placement="top"
              trigger="hover"
            >
              <span
                className="x-diagram-viewer__icon x-diagram-viewer__icon--float"
                onClick={(event) => {
                  event.stopPropagation();
                  handleFullscreen();
                }}
              >
                <Icon size="16px" name="expand" />
              </span>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
};

Viewer.displayName = "XMarkdownViewer";

export default Viewer;
