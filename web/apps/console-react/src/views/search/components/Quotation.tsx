import React, { useState, useMemo } from 'react';
import { UpOutlined, RightOutlined, LinkOutlined } from '@ant-design/icons';
import { useEnv } from '@/hooks/useEnv';

interface QuotationProps {
  files?: any[];
  type?: string;
}

export const Quotation: React.FC<QuotationProps> = ({ files = [], type = 'rag_search' }) => {
  const [showFiles, setShowFiles] = useState(false);
  const { buildFrontLibraryFileUrl } = useEnv();

  const getIndex = (source_key: string) => {
    if (!source_key) return '';
    const match = source_key.replace('[Source:', '').replace(']', '').split('-');
    const index = type === 'web_search' ? match[1] : match[0];
    return Number(index) > -1 ? index : '';
  };

  const fileList = useMemo(() => {
    const list = files.map((item, index) => ({
      ...item,
      index: item.source_key ? Number(getIndex(item.source_key)) : index + 1,
    }));
    return list.sort((a, b) => a.index - b.index);
  }, [files, type]);

  const handleToLibrary = (library_id: string, file_id: string) => {
    window.open(buildFrontLibraryFileUrl(library_id, file_id), '_blank');
  };

  return (
    <div>
      <div
        className="h-8 px-2 rounded-lg cursor-pointer bg-gray-100 hover:bg-gray-200 inline-flex items-center mt-3"
        onClick={() => setShowFiles(!showFiles)}
      >
        <p className="text-sm text-gray-800 m-0 mr-2">引用 {fileList.length} 篇资料作为参考</p>
        {showFiles ? <UpOutlined className="text-gray-500 text-xs" /> : <RightOutlined className="text-gray-500 text-xs" />}
      </div>
      
      {showFiles && (
        <div className="space-y-1.5 mt-3">
          {fileList.map((item, index) => {
            if (type === 'web_search') {
              return (
                <a
                  key={item.file_id || index}
                  href={item.file_path}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 hover:bg-gray-50 p-1 rounded"
                >
                  <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">
                    {item.source_key ? getIndex(item.source_key) : index + 1}
                  </div>
                  <LinkOutlined className="text-gray-500" />
                  <div className="flex-1 text-sm text-gray-800 truncate">
                    {item.file_name}
                  </div>
                </a>
              );
            }
            
            return (
              <div
                key={item.file_id || index}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded"
                onClick={() => handleToLibrary(item.library_id, item.file_id)}
              >
                <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">
                  {item.source_key ? getIndex(item.source_key) : index + 1}
                </div>
                <img src={item.file_icon} className="w-5 h-5" alt="icon" />
                <div className="flex-1 text-sm text-gray-800 truncate">
                  {item.file_name}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Quotation;