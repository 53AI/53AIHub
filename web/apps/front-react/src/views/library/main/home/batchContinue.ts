import type { Key } from "react";
import type { FileItem } from "@/api/modules/files/types";
import { RUN_STATUS } from "@/constants/chunk";

const CONTINUE_STATUSES = new Set<string>([
  RUN_STATUS.SUCCESS,
  RUN_STATUS.FAILED,
  RUN_STATUS.WAITING,
]);

/**
 * 继续清洗提交集合：选中且状态为 成功 / 失败 / 待人工处理 的文档。
 * 由后端按每个文档的实际状态决定重跑起点（成功→从头，失败→失败步骤，待人工→手动步骤）。
 */
export function collectBatchContinueIDs(files: FileItem[], keys: Key[]): string[] {
  return files
    .filter(
      (file) =>
        keys.includes(file.id) &&
        file.isfile &&
        CONTINUE_STATUSES.has(String(file.cleaning_info?.status ?? "")),
    )
    .map((file) => file.id);
}

/** 一次批量请求提交选中集合；集合为空时不发请求。返回实际提交的 id。 */
export async function submitBatchContinue(
  files: FileItem[],
  keys: Key[],
  api: { batchContinue: (data: { related_ids: string[] }) => Promise<unknown> },
): Promise<string[]> {
  const relatedIds = collectBatchContinueIDs(files, keys);
  if (relatedIds.length === 0) return [];
  await api.batchContinue({ related_ids: relatedIds });
  return relatedIds;
}
