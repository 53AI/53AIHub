import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import svgPanZoom from 'svg-pan-zoom';
import Viewer from './viewer';
import { downloadSvgAsPng, copySvgAsPng } from '../../../utils/download';
import { showMessage } from '../../../utils/message';
import { t } from '../../../locale';
import './mermaid.css';

interface MermaidProps {
  value: string;
  clickable?: boolean;
  viewerClass?: string;
  viewerStyle?: React.CSSProperties;
  onNodeClick?: (data: { text: string; id: string; className?: string; element: Element }) => void;
}

let mermaidIdCounter = 0;

const Mermaid: React.FC<MermaidProps> = ({
  value,
  clickable = false,
  viewerClass = '',
  viewerStyle,
  onNodeClick
}) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panInstanceRef = useRef<any>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentMermaidIdRef = useRef<string>('');
  const [hasError, setHasError] = useState(false);
  const [svgRendered, setSvgRendered] = useState(false);

  const mermaidId = useMemo(() => {
    const id = `mermaid-${Date.now()}-${mermaidIdCounter++}`;
    currentMermaidIdRef.current = id;
    return id;
  }, []);

  const emitZoomChange = useCallback((zoom: number) => {
    if (contentRef.current) {
      const event = new CustomEvent('zoomChange', { detail: zoom, bubbles: true });
      contentRef.current.dispatchEvent(event);
    }
  }, []);

  const dragState = useRef({
    isDragging: false,
    dragStartTime: 0,
    dragStartPos: { x: 0, y: 0 }
  });

  const handleNodeClick = useCallback((event: MouseEvent) => {
    const { isDragging, dragStartTime, dragStartPos } = dragState.current;
    const timeDiff = Date.now() - dragStartTime;
    const posDiff = Math.abs(event.clientX - dragStartPos.x) + Math.abs(event.clientY - dragStartPos.y);

    if (isDragging || (timeDiff < 200 && posDiff > 5)) {
      return;
    }

    if (!clickable || !onNodeClick) return;

    const target = event.target as Element;
    // 查找最近的节点元素（Mermaid 节点通常有 node, flowchart-node, cluster 等类名）
    let current: Element | null = target;
    while (current && current !== contentRef.current) {
      const classList = Array.from(current.classList || []);
      const isNode = classList.some(c =>
        c.includes('node') ||
        c.includes('cluster') ||
        c.includes('mindmap-node')
      );
      if (isNode) {
        // 找到节点内的文本
        const textEl = current.querySelector('text, .nodeLabel, .label');
        const text = textEl?.textContent?.trim() || (current as any).textContent?.trim() || '';
        if (text) {
          onNodeClick({
            text,
            id: current.id || '',
            element: current
          });
          return;
        }
      }
      current = current.parentElement;
    }
  }, [clickable, onNodeClick]);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    dragState.current.isDragging = false;
    dragState.current.dragStartTime = Date.now();
    dragState.current.dragStartPos = { x: event.clientX, y: event.clientY };
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const posDiff = Math.abs(event.clientX - dragState.current.dragStartPos.x) + Math.abs(event.clientY - dragState.current.dragStartPos.y);
    if (posDiff > 3) {
      dragState.current.isDragging = true;
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    dragState.current.isDragging = false;
  }, []);

  const initPanZoom = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || panInstanceRef.current) return;

    // 确保 SVG 有有效尺寸
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || isNaN(rect.width) || isNaN(rect.height)) {
      // 尺寸无效，延迟重试
      requestAnimationFrame(() => initPanZoom());
      return;
    }

    try {
      panInstanceRef.current = svgPanZoom(svg, {
        center: true,
        fit: true,
        maxZoom: 12,
        minZoom: 0.2
      });

      panInstanceRef.current.disableDblClickZoom();
      panInstanceRef.current.setOnZoom(() => emitZoomChange(panInstanceRef.current.getZoom()));
    } catch (error) {
      console.error('svgPanZoom init error:', error);
    }
  }, [emitZoomChange]);

  const renderMermaid = useCallback(async (content: string, id: string) => {
    if (!content?.trim() || !contentRef.current) return;

    // Mermaid 创建的临时元素 ID 为 'd' + id
    const tempId = `d${id}`;

    // 清理旧的临时元素
    const oldTemp = document.getElementById(tempId);
    if (oldTemp) {
      oldTemp.remove();
    }

    try {
      const res = await mermaid.render(id, content);
      contentRef.current.innerHTML = res.svg;
      svgRef.current = contentRef.current.querySelector('svg');
      setHasError(false);
      setSvgRendered(true);

    } catch (error) {
      console.error('Mermaid render error:', error);
      setHasError(true);

      // 渲染失败时也要清理临时元素
      const failedTemp = document.getElementById(tempId);
      if (failedTemp) {
        failedTemp.remove();
      }
    }
  }, []);

  const handleRefresh = useCallback(() => {
    // 只重置 panZoom，不重新渲染 mermaid
    if (panInstanceRef.current) {
      panInstanceRef.current.fit();
      panInstanceRef.current.center();
      emitZoomChange(panInstanceRef.current.getZoom());
    }
  }, [emitZoomChange]);

  const handleZoom = useCallback((method: 'zoomIn' | 'zoomOut') => {
    panInstanceRef.current?.[method]();
    if (panInstanceRef.current) {
      emitZoomChange(panInstanceRef.current.getZoom());
    }
  }, [emitZoomChange]);

  const handleFullscreen = useCallback((isFullscreen: boolean) => {
    if (hasError) return;

    // 销毁现有实例
    panInstanceRef.current?.destroy();
    panInstanceRef.current = null;

    // 全屏切换时重新初始化 svgPanZoom
    setTimeout(() => {
      initPanZoom();
    }, 100);
  }, [hasError, initPanZoom]);

  const getSvgElement = useCallback(() => document.querySelector('.x-diagram-viewer__content svg') as SVGElement | null, []);

  const copyImage = useCallback(() => {
    const svgElement = getSvgElement();
    if (!svgElement) return;
    copySvgAsPng(svgElement, svgRef.current || undefined);
    showMessage.success(t('hubx.bubble.copied'));
  }, [getSvgElement]);

  const downloadImage = useCallback(() => {
    const svgElement = getSvgElement();
    if (!svgElement) return;
    downloadSvgAsPng(svgElement, svgRef.current || undefined);
    showMessage.success(t('hubx.bubble.download_success'));
  }, [getSvgElement]);

  // 渲染 mermaid
  useEffect(() => {
    if (renderTimer.current) {
      clearTimeout(renderTimer.current);
    }
    setHasError(false);
    renderTimer.current = setTimeout(() => {
      renderMermaid(value, currentMermaidIdRef.current);
    }, 600);

    return () => {
      if (renderTimer.current) {
        clearTimeout(renderTimer.current);
      }
    };
  }, [value, renderMermaid]);

  // 初始化 svgPanZoom
  useEffect(() => {
    if (svgRendered && svgRef.current) {
      requestAnimationFrame(() => initPanZoom());
    }
  }, [svgRendered, initPanZoom]);

  // 管理事件监听器 - 当SVG渲染完成或回调函数变化时重新附加
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    svg.addEventListener('click', handleNodeClick);
    svg.addEventListener('mousedown', handleMouseDown);
    svg.addEventListener('mousemove', handleMouseMove);
    svg.addEventListener('mouseup', handleMouseUp);

    return () => {
      svg.removeEventListener('click', handleNodeClick);
      svg.removeEventListener('mousedown', handleMouseDown);
      svg.removeEventListener('mousemove', handleMouseMove);
      svg.removeEventListener('mouseup', handleMouseUp);
    };
  }, [svgRendered, handleNodeClick, handleMouseDown, handleMouseMove, handleMouseUp]);

  // 组件卸载清理
  useEffect(() => {
    return () => {
      if (renderTimer.current) {
        clearTimeout(renderTimer.current);
      }
      panInstanceRef.current?.destroy();

      // 清理 Mermaid 创建的临时元素
      const tempId = `d${currentMermaidIdRef.current}`;
      const tempElement = document.getElementById(tempId);
      if (tempElement) {
        tempElement.remove();
      }
    };
  }, []);

  return (
    <Viewer
      value={value}
      hideImageTab={hasError}
      viewerClass={viewerClass}
      viewerStyle={viewerStyle}
      imageContent={<div ref={contentRef} className={`mermaid-viewer__diagram ${clickable ? 'mermaid-viewer__diagram--clickable' : ''}`} />}
      onRefresh={handleRefresh}
      onZoomIn={() => handleZoom('zoomIn')}
      onZoomOut={() => handleZoom('zoomOut')}
      onFullscreen={handleFullscreen}
      onDownloadImage={downloadImage}
      onCopyImage={copyImage}
    />
  );
};

Mermaid.displayName = 'XMarkdownMermaid';

export default Mermaid;
