import React, { useState, forwardRef, useImperativeHandle } from 'react';
import { CloseOutlined, InboxOutlined } from '@ant-design/icons';

export interface ThinkKnowledgeRef {
  updateResults: (results: any[], type: string) => void;
}

interface ThinkKnowledgeProps {
  onClose?: () => void;
}

const ThinkKnowledge = forwardRef<ThinkKnowledgeRef, ThinkKnowledgeProps>(({ onClose }, ref) => {
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [searchType, setSearchType] = useState('rag_search');

  const isRagSearch = searchType === 'rag_search';

  useImperativeHandle(ref, () => ({
    updateResults: (results: any[], type: string) => {
      setSearchResults(results);
      setSearchType(type);
    }
  }));

  const handleClose = () => {
    setSelectedIndex(-1);
    onClose?.();
  };

  const handleItemClick = (item: any, index: number) => {
    if (isRagSearch) {
      // open drawer
    } else {
      window.open(item.file_path, '_blank');
    }
    setSelectedIndex(index);
  };

  const resultCount = searchResults.length;

  return (
    <div className="bg-white flex flex-col h-screen absolute right-0 top-0 w-80 shadow-xl z-50">
      <div className="flex items-center justify-between px-4 py-5 border-b border-gray-100">
        <h2 className="text-xl font-semibold text-gray-800 m-0">
          {isRagSearch ? `搜索到 ${resultCount} 篇资料` : `参考网页 ( ${resultCount} 个)`}
        </h2>
        <button
          className="text-gray-400 hover:text-gray-600 transition-colors bg-transparent border-none cursor-pointer"
          onClick={handleClose}
        >
          <CloseOutlined />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <InboxOutlined className="text-4xl text-gray-300 mb-4" />
            <p className="text-lg font-medium mb-2 m-0">暂无搜索结果</p>
          </div>
        ) : (
          <div className="space-y-4">
            {searchResults.map((item, index) => (
              <div
                key={index}
                className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 cursor-pointer group mb-4"
                onClick={() => handleItemClick(item, index)}
              >
                {isRagSearch ? (
                  <>
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0">
                        <img className="w-5 h-5" src={item.file_icon} alt="icon" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={`text-sm font-medium truncate m-0 ${index === selectedIndex ? 'text-blue-600' : 'text-gray-800'}`}>
                          {item.file_name}
                        </h3>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2 m-0">
                      {item.content}
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-medium truncate text-blue-600 m-0">
                      {index + 1}. {item.file_name} {item.file_name ? '' : item.chunk_type}
                    </h3>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-shrink-0">
                        <img className="w-4 h-4" src={item.library_icon} alt="icon" />
                      </div>
                      <div className="flex-1 min-w-0 text-xs text-gray-800">
                        {item.library_name}
                      </div>
                    </div>
                    {item.file_name && (
                      <p className="text-sm text-gray-600 mt-2 line-clamp-2 m-0">
                        {item.content}
                      </p>
                    )}
                  </>
                )}
                {isRagSearch && (
                  <div className="flex items-center justify-between text-xs text-gray-400 mt-2">
                    <span>
                      {item.space_name ? `${item.space_name}/` : ''}{item.library_name}
                    </span>
                    <span>{item.created_at}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

ThinkKnowledge.displayName = 'ThinkKnowledge';

export default ThinkKnowledge;