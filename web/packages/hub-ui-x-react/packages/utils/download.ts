export const downloadSvg = (element: SVGElement, fileName?: string) => {
  try {
    // 克隆SVG元素以避免修改原始元素
    const svgElement = element.cloneNode(true) as SVGElement;

    // 设置SVG的样式和属性
    svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // 将SVG转换为字符串
    const svgData = new XMLSerializer().serializeToString(svgElement);

    // 创建Blob对象
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });

    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'mindmap.svg';

    // 触发下载
    document.body.appendChild(link);
    link.click();

    // 清理
    document.body.removeChild(link);

    // 延迟释放URL对象，确保下载已开始
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);

  } catch (error) {
    console.error('下载SVG图片失败:', error);
  }
}

/**
 * 将图表下载为PNG图片
 * @param element 图表元素或ECharts实例
 * @param fileName 文件名，默认为chart.png
 */
export const downloadPng = (element: any, fileName: string = 'chart.png'): void => {
  try {
    // 处理ECharts实例
    if (element.getDataURL) {
      const dataURL = element.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: '#fff'
      });

      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataURL;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    // 处理SVG元素
    else if (element instanceof SVGElement) {
      const svgData = new XMLSerializer().serializeToString(element);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      // 设置合适的尺寸
      const svgSize = element.getBoundingClientRect();
      canvas.width = svgSize.width * 2; // 2倍大小以提高清晰度
      canvas.height = svgSize.height * 2;

      img.onload = function() {
        if (ctx) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const dataURL = canvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.download = fileName;
          link.href = dataURL;
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      };

      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    } else {
      console.error('不支持的元素类型');
    }
  } catch (error) {
    console.error('下载PNG图片失败:', error);
  }
}

/**
 * 将SVG转换为PNG格式的数据URL
 * @param svgElement SVG元素
 * @returns Promise<string> 返回PNG格式的数据URL
 */
export const convertSvgToPngData = async (svgElement: SVGElement, newSvgElement?: SVGElement): Promise<string> => {
  // 获取SVG的尺寸
  const bbox = svgElement.getBoundingClientRect();
  const width = Math.round(bbox.width);
  const height = Math.round(bbox.height);
  // 确保尺寸有效
  if (width === 0 || height === 0) {
    throw new Error('SVG尺寸无效');
  }

  // 创建Canvas元素
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // 设置Canvas尺寸为2倍以提高清晰度
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;

  if (!ctx) {
    throw new Error('无法获取Canvas上下文');
  }

  // 设置白色背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 克隆SVG并设置尺寸
  const clonedSvg = newSvgElement || svgElement.cloneNode(true) as SVGElement;
  clonedSvg.setAttribute('width', String(width * scale));
  clonedSvg.setAttribute('height', String(height * scale));
  clonedSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // 将SVG转换为Base64编码的数据URL
  const svgData = new XMLSerializer().serializeToString(clonedSvg);
  const svgBase64 = btoa(unescape(encodeURIComponent(svgData)));
  const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;

  // 创建图片对象并加载SVG
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });

  // 在Canvas上绘制图片
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // 返回PNG数据URL
  return canvas.toDataURL('image/png');
};

/**
 * 下载数据URL为文件
 * @param dataUrl 数据URL
 * @param fileName 文件名
 */
export const downloadDataUrl = (dataUrl: string, fileName: string): void => {
  const downloadLink = document.createElement('a');
  downloadLink.href = dataUrl;
  downloadLink.download = fileName;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
};

/**
 * 将SVG下载为PNG图片
 * @param element SVG元素
 * @param fileName 文件名，默认为当前时间戳
 */
export const downloadSvgAsPng = async (svgElement: SVGElement, newSvgElement?: SVGElement, fileName: string = Date.now() + '.png'): Promise<void> => {
  try {
    const pngData = await convertSvgToPngData(svgElement, newSvgElement);
    downloadDataUrl(pngData, fileName);
  } catch (error) {
    console.error('SVG转PNG下载失败:', error);
  }
}

export const copySvgAsPng = async (svgElement: SVGElement, newSvgElement?: SVGElement): Promise<void> => {
  try {
    const pngData = await convertSvgToPngData(svgElement, newSvgElement);

    // 检查是否支持新版剪贴板 API
    if (typeof ClipboardItem !== 'undefined') {
      const clipboardItem = new ClipboardItem({
        'image/png': dataURLtoBlob(pngData)
      });
      await navigator.clipboard.write([clipboardItem]);
    } else {
      // 降级方案：创建一个临时的 textarea 元素
      const textarea = document.createElement('textarea');
      textarea.value = pngData;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        console.log('图片已复制到剪贴板（降级方案）');
      } catch (err) {
        console.error('复制失败:', err);
      }
      document.body.removeChild(textarea);
    }
  } catch (error) {
    console.error('复制SVG到PNG失败:', error);
    throw error;
  }
}

// 辅助函数：将 dataURL 转换为 Blob
function dataURLtoBlob(dataURL: string): Blob {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}