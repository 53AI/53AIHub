import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Markmap } from 'markmap-view';
import { Transformer } from 'markmap-lib';
import Viewer from './viewer';
import { copyToClip } from '../../../utils/copy';
import { downloadSvgAsPng } from '../../../utils/download';
import { showMessage } from '../../../utils/message';
import { t } from '../../../locale';
import './mindmap.css';

interface MindmapProps {
  value: string;
  clickable?: boolean;
  viewerClass?: string;
  viewerStyle?: React.CSSProperties;
  onNodeClick?: (data: { text: string }) => void;
}

const transformer = new Transformer();

const Mindmap: React.FC<MindmapProps> = ({ value, clickable = false, viewerClass = '', viewerStyle, onNodeClick }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const markmapRef = useRef<Markmap | null>(null);
  const [hasError, setHasError] = useState(false);
  const [svgRendered, setSvgRendered] = useState(false);

  const handleNodeClick = useCallback((event: MouseEvent) => {
    if (!clickable || !onNodeClick) return;

    const target = event.target as Element;
    // 查找最近的节点元素
    let current: Element | null = target;
    while (current && current !== svgRef.current) {
      const classList = Array.from(current.classList || []);
      if (classList.some(c => c.includes('node') || c.includes('markmap-node'))) {
        // 找到节点内的文本
        const textEl = current.querySelector('text, .markmap-node-text');
        const text = textEl?.textContent?.trim() || current.textContent?.trim() || '';
        if (text) {
          onNodeClick({ text });
          return;
        }
      }
      current = current.parentElement;
    }
  }, [clickable, onNodeClick]);

  const update = useCallback(async (markdown: string) => {
    if (!markmapRef.current) return;
    try {
      const previousError = hasError;
      setHasError(false);
      const { root } = transformer.transform(markdown);
      await markmapRef.current.setData(root);
      markmapRef.current.fit();
      setSvgRendered(true);
      if (previousError) {
        // viewer will switch by hideImageTab
      }
    } catch (error) {
      console.error('Markmap render error:', error);
      setHasError(true);
    }
  }, [hasError]);

  const handleRefresh = useCallback(() => {
    markmapRef.current?.fit();
  }, []);

  const handleZoomIn = useCallback(() => {
    markmapRef.current?.rescale(1.25);
  }, []);

  const handleZoomOut = useCallback(() => {
    markmapRef.current?.rescale(0.8);
  }, []);

  const handleFullscreen = useCallback(() => {
    handleRefresh();
  }, [handleRefresh]);

  const downloadImage = useCallback(() => {
    if (!svgRef.current) return;
    downloadSvgAsPng(svgRef.current);
    showMessage.success(t('hubx.bubble.download_success'));
  }, []);

  const copyMarkdown = useCallback(() => {
    copyToClip(value);
  }, [value]);

  // 初始化
  useEffect(() => {
    if (!svgRef.current) return;
    try {
      setHasError(false);
      markmapRef.current = Markmap.create(svgRef.current);
      update(value);
    } catch (error) {
      console.error('Markmap initialization error:', error);
      setHasError(true);
    }
  }, []);

  // 更新内容
  useEffect(() => {
    update(value);
  }, [value, update]);

  // 添加点击事件
  useEffect(() => {
    if (svgRendered && svgRef.current && clickable) {
      svgRef.current.addEventListener('click', handleNodeClick);
      return () => {
        svgRef.current?.removeEventListener('click', handleNodeClick);
      };
    }
  }, [svgRendered, clickable, handleNodeClick]);

  return (
    <Viewer
      value={value}
      hideImageTab={hasError}
      viewerClass={viewerClass}
      viewerStyle={viewerStyle}
      imageContent={<svg ref={svgRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />}
      onRefresh={handleRefresh}
      onZoomIn={handleZoomIn}
      onZoomOut={handleZoomOut}
      onFullscreen={handleFullscreen}
      onDownloadImage={downloadImage}
      onCopyImage={copyMarkdown}
    />
  );
};

Mindmap.displayName = 'XMarkdownMindmap';

export default Mindmap;
