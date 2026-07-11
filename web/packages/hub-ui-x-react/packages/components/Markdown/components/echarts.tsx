import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import Icon from '../../Icon/index.tsx';
import { copyToClip } from '../../../utils/copy';
import { downloadPng } from '../../../utils/download';
import { showMessage } from '../../../utils/message';
import { onClickOutside } from '../../../utils/helper';
import { t } from '../../../locale';
import './echarts.css';

interface EchartsProps {
  value: string;
}

const Echarts: React.FC<EchartsProps> = ({ value }) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const [mode, setMode] = useState<'image' | 'code'>('image');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);

  const toggleDropdown = () => setIsDropdownOpen((prev) => !prev);

  const handleFullscreen = () => setIsFullscreen((prev) => !prev);

  const downloadImage = () => {
    if (!chartInstanceRef.current) return;
    downloadPng(chartInstanceRef.current);
    showMessage.success(t('hubx.bubble.download_success'));
    setIsDropdownOpen(false);
  };

  const copyMarkdown = () => {
    copyToClip(value);
    setIsDropdownOpen(false);
  };

  const updateChart = () => {
    if (!contentRef.current) return;
    try {
      setHasError(false);
      if (!chartInstanceRef.current) {
        chartInstanceRef.current = echarts.init(contentRef.current);
      }
      let parsed: any;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid chart options');
      }

      const defaultOptions = {
        backgroundColor: '#fff',
        tooltip: {
          show: true
        }
      };

      const mergedOptions = {
        ...defaultOptions,
        ...parsed
      };

      chartInstanceRef.current.setOption(mergedOptions, true);
    } catch (error) {
      console.error('Failed to update chart:', error);
      setHasError(true);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.clear();
      }
    }
  };

  useEffect(() => {
    updateChart();
  }, [value]);

  useEffect(() => {
    if (hasError && mode === 'image') {
      setMode('code');
    }
  }, [hasError, mode]);

  useEffect(() => {
    if (dropdownRef.current) {
      const cleanup = onClickOutside(dropdownRef.current, () => setIsDropdownOpen(false));
      return () => cleanup.destroy();
    }
    return undefined;
  }, []);

  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className={`echarts-viewer ${isFullscreen ? 'echarts-viewer--fixed' : ''}`}>
      <div className="echarts-viewer__header">
        <div className="echarts-viewer__tabs-container">
          <div className="echarts-viewer__tabs">
            {!hasError && (
              <div
                className={`echarts-viewer__tab ${mode === 'image' ? 'echarts-viewer__tab--active' : ''}`}
                onClick={() => setMode('image')}
              >
                {t('hubx.bubble.image')}
              </div>
            )}
            <div
              className={`echarts-viewer__tab ${mode === 'code' ? 'echarts-viewer__tab--active' : ''}`}
              onClick={() => setMode('code')}
            >
              {t('hubx.bubble.code')}
            </div>
          </div>
        </div>
        <div className="echarts-viewer__actions" style={{ display: mode === 'image' ? 'flex' : 'none' }}>
          <div className="echarts-viewer__dropdown" ref={dropdownRef}>
            <span className="echarts-viewer__dropdown-trigger" onClick={toggleDropdown}>
              <i className="echarts-viewer__icon">
                <Icon name="download" />
              </i>
              <i className="echarts-viewer__icon">
                <Icon name="down" />
              </i>
            </span>
            {isDropdownOpen && (
              <div className="echarts-viewer__dropdown-menu">
                <div className="echarts-viewer__dropdown-item" onClick={downloadImage}>
                  {t('hubx.bubble.download_image')}
                </div>
                <div className="echarts-viewer__dropdown-item" onClick={copyMarkdown}>
                  {t('hubx.bubble.copy_markdown')}
                </div>
              </div>
            )}
          </div>
          <i className="mermaid-viewer__icon" onClick={handleFullscreen}>
            <Icon name={isFullscreen ? 'collapse' : 'expand'} />
          </i>
        </div>
        <div className="echarts-viewer__actions" style={{ display: mode === 'code' ? 'flex' : 'none' }}>
          <i className="echarts-viewer__icon" onClick={copyMarkdown}>
            <Icon name="copy" />
          </i>
        </div>
      </div>
      <div className="echarts-viewer__content">
        <div
          ref={contentRef}
          className="echarts-viewer__diagram"
          style={{ display: mode === 'image' ? 'block' : 'none' }}
        />
        <div className="echarts-viewer__code" style={{ display: mode === 'code' ? 'block' : 'none' }}>
          <pre className="echarts-viewer__code-pre">{value}</pre>
        </div>
      </div>
    </div>
  );
};

Echarts.displayName = 'XMarkdownEcharts';

export default Echarts;
