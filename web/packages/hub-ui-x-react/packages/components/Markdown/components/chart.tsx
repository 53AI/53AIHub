import React, { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import Icon from '../../Icon/index.tsx';
import { copyToClip } from '../../../utils/copy';
import { showMessage } from '../../../utils/message';
import { onClickOutside } from '../../../utils/helper';
import { t } from '../../../locale';
import './chart.css';

interface ChartProps {
  value: string;
}

const ChartViewer: React.FC<ChartProps> = ({ value }) => {
  const contentRef = useRef<HTMLCanvasElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);
  const [mode, setMode] = useState<'image' | 'code'>('image');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [hasError, setHasError] = useState(false);

  const toggleDropdown = () => setIsDropdownOpen((prev) => !prev);

  const downloadImage = () => {
    if (!contentRef.current || !chartInstanceRef.current) return;
    const dataUrl = contentRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'chart.png';
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsDropdownOpen(false);
    showMessage.success(t('hubx.bubble.download_success'));
  };

  const copyMarkdown = () => {
    copyToClip(value);
    setIsDropdownOpen(false);
  };

  useEffect(() => {
    if (!contentRef.current) return;
    try {
      setHasError(false);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
      const parsed = (() => {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      })();
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid chart options');
      }
      chartInstanceRef.current = new Chart(contentRef.current, parsed);
    } catch (error) {
      console.error('Chart.js render error:', error);
      setHasError(true);
      setMode('code');
    }
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

  return (
    <div className="chartjs-viewer">
      <div className="chartjs-viewer__header">
        <div className="chartjs-viewer__tabs-container">
          <div className="chartjs-viewer__tabs">
            {!hasError && (
              <div
                className={`chartjs-viewer__tab ${mode === 'image' ? 'chartjs-viewer__tab--active' : ''}`}
                onClick={() => setMode('image')}
              >
                {t('hubx.bubble.image')}
              </div>
            )}
            <div
              className={`chartjs-viewer__tab ${mode === 'code' ? 'chartjs-viewer__tab--active' : ''}`}
              onClick={() => setMode('code')}
            >
              {t('hubx.bubble.code')}
            </div>
          </div>
        </div>
        <div className="chartjs-viewer__actions" style={{ display: mode === 'image' ? 'flex' : 'none' }}>
          <div className="chartjs-viewer__dropdown" ref={dropdownRef}>
            <span className="chartjs-viewer__dropdown-trigger" onClick={toggleDropdown}>
              <i className="chartjs-viewer__icon">
                <Icon name="download" />
              </i>
              <i className="chartjs-viewer__icon">
                <Icon name="down" />
              </i>
            </span>
            {isDropdownOpen && (
              <div className="chartjs-viewer__dropdown-menu">
                <div className="chartjs-viewer__dropdown-item" onClick={downloadImage}>
                  {t('hubx.bubble.download_image')}
                </div>
                <div className="chartjs-viewer__dropdown-item" onClick={copyMarkdown}>
                  {t('hubx.bubble.copy_markdown')}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="chartjs-viewer__actions" style={{ display: mode === 'code' ? 'flex' : 'none' }}>
          <i className="chartjs-viewer__icon chartjs-viewer__icon--copy" onClick={copyMarkdown}>
            <Icon name="copy" />
          </i>
        </div>
      </div>
      <div className="chartjs-viewer__content">
        <canvas
          ref={contentRef}
          width={500}
          height={318}
          style={{ display: mode === 'image' ? 'block' : 'none' }}
        />
        <div className="chartjs-viewer__code" style={{ display: mode === 'code' ? 'block' : 'none' }}>
          <pre className="chartjs-viewer__code-pre">{value}</pre>
        </div>
      </div>
    </div>
  );
};

ChartViewer.displayName = 'XMarkdownChart';

export default ChartViewer;
