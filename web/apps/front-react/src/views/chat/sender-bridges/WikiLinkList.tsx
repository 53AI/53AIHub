/**
 * WikiLinkList — 动态知识选中项 chip 列表，渲染在 Sender 输入框下方、@ 链接列表下方。
 * chip 视觉与交互收敛到 ./LinkChip,与 LegacyLinkList 共享同一组件。
 */
import { SvgIcon } from "@km/shared-components-react";
import type { KnowledgeSourceState } from "@/components/KnowledgeSource";
import { LinkChip } from "./LinkChip";

export interface WikiLinkListProps {
  knowledgeSource: KnowledgeSourceState;
  onChangeKnowledgeSource: (state: KnowledgeSourceState) => void;
}

/**
 * 动态知识选中项 — 渲染在 linkList 下方
 */
export function WikiLinkList({ knowledgeSource, onChangeKnowledgeSource }: WikiLinkListProps) {
  // 是否有选中的动态知识
  const hasWikiSelection =
    (knowledgeSource.selectedWikiSpaces?.length ?? 0) > 0 ||
    (knowledgeSource.selectedWikiPages?.length ?? 0) > 0;

  if (!hasWikiSelection) return null;

  // 移除单个动态知识空间
  const handleRemoveWikiSpace = (spaceId: string) => {
    const newSpaces = knowledgeSource.selectedWikiSpaces?.filter(
      (s) => s.id !== spaceId
    );
    onChangeKnowledgeSource({
      ...knowledgeSource,
      selectedWikiSpaces: newSpaces,
      wiki: newSpaces && newSpaces.length > 0 ? true : false,
    });
  };

  // 移除单个动态知识页面
  const handleRemoveWikiPage = (pageId: string) => {
    const newPages = knowledgeSource.selectedWikiPages?.filter(
      (p) => p.id !== pageId
    );
    onChangeKnowledgeSource({
      ...knowledgeSource,
      selectedWikiPages: newPages,
      wiki:
        newPages && newPages.length > 0
          ? true
          : (knowledgeSource.selectedWikiSpaces?.length ?? 0) > 0,
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap overflow-x-auto overflow-y-hidden mb-1.5">
      {/* 选中的空间 */}
      {knowledgeSource.selectedWikiSpaces?.map((space) => (
        <LinkChip
          key={`wiki-space-${space.id}`}
          icon={<div className="size-4 bg-[#E6EEFF] text-[#4798F5] flex-center"><SvgIcon name="database-k" size={13} /></div>}
          name={space.name}
          onRemove={() => handleRemoveWikiSpace(space.id)}
        />
      ))}
      {/* 选中的页面 */}
      {knowledgeSource.selectedWikiPages?.map((page) => (
        <LinkChip
          key={`wiki-page-${page.id}`}
          icon={<div className="size-4 bg-[#4798F5] text-white flex-center"><SvgIcon name="doc-detail" size={13} /></div>}
          name={page.title}
          onRemove={() => handleRemoveWikiPage(page.id)}
        />
      ))}
    </div>
  );
}

export default WikiLinkList;