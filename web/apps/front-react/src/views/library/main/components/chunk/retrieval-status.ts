import { EMBEDDING_STATUS } from "@/constants/chunk";

export interface RetrievalChunkStatusMeta {
  label: string;
  className: string;
  dotClassName: string;
}

export function isRetrievalChunkEmbeddingInProgress(status?: string): boolean {
  return (
    status === EMBEDDING_STATUS.PENDING || status === EMBEDDING_STATUS.PARSING
  );
}

export function getRetrievalChunkStatusMeta(
  status?: string,
): RetrievalChunkStatusMeta {
  switch (status) {
    case EMBEDDING_STATUS.NORMAL:
    case EMBEDDING_STATUS.COMPLETED:
      return {
        label: "索引成功",
        className: "bg-[#EAF8EF] text-[#179B45]",
        dotClassName: "bg-[#22A06B]",
      };
    case EMBEDDING_STATUS.PENDING:
      return {
        label: "排队中",
        className: "bg-[#F5F4F4] text-[#666666]",
        dotClassName: "bg-[#999999]",
      };
    case EMBEDDING_STATUS.PARSING:
      return {
        label: "索引中",
        className: "bg-[#F5F4F4] text-[#666666]",
        dotClassName: "bg-[#999999]",
      };
    case EMBEDDING_STATUS.FAILED:
      return {
        label: "索引失败",
        className: "bg-[#FFEDED] text-[#FA5151]",
        dotClassName: "bg-[#FA5151]",
      };
    default:
      return {
        label: "状态未知",
        className: "bg-[#F5F4F4] text-[#666666]",
        dotClassName: "bg-[#999999]",
      };
  }
}
