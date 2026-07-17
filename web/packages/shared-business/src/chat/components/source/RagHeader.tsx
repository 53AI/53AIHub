// packages/shared-business/src/chat/components/source/RagHeader.tsx

import { RightOutlined } from '@ant-design/icons';
import { useTranslation } from '../../i18n';
import type { RagStats } from '../../types/message';
import RagPill from './RagPill';

export interface RagHeaderProps {
  ragStats?: RagStats | null;
  loading?: boolean;
  ragSearchText?: string;
  specifiedContent?: string;
  showLibraryCount?: boolean;
  onOpenKnow?: () => void;
}

export function RagHeader({
  ragStats,
  loading = false,
  ragSearchText,
  specifiedContent,
  showLibraryCount = true,
  onOpenKnow,
}: RagHeaderProps) {
  const { t } = useTranslation();

  const handleOpenKnow = () => {
    if (!showLibraryCount) return;
    onOpenKnow?.();
  };

  // RAG statistics display
  if (ragStats) {
    if (ragStats.type === 'web_search') {
      return (
        <RagPill className="mb-3" onClick={handleOpenKnow}>
          <p className="text-sm text-[#1D1E1F]">
            {t('rag.web_search_found', { count: ragStats.files_search?.length || 0 })}
          </p>
          <RightOutlined className="text-[#939499]" />
        </RagPill>
      );
    }

    return (
      <RagPill className="mb-3" onClick={handleOpenKnow}>
        <p className="text-sm text-[#1D1E1F]">
          {showLibraryCount ? (
            t('rag.library_search_found', {
              libraryCount: ragStats.library_search?.length || 0,
              fileCount: ragStats.files_search?.length || 0,
            })
          ) : (
            t('rag.search_complete')
          )}
        </p>
        {showLibraryCount && <RightOutlined className="text-[#939499]" />}
      </RagPill>
    );
  }

  // Loading state
  if (loading && ragSearchText) {
    return (
      <RagPill className="mb-3">
        <p className="flex-1 text-sm text-[#1D1E1F] truncate">{ragSearchText}</p>
      </RagPill>
    );
  }

  // Specified content
  if (specifiedContent) {
    return (
      <RagPill className="mb-3">
        <p className="flex-1 text-sm text-[#1D1E1F] truncate">{t('rag.analyzed_knowledge')}</p>
      </RagPill>
    );
  }

  return null;
}

export default RagHeader;
