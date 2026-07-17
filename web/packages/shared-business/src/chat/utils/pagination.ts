/**
 * 从响应里读取 hasMore，兼容 response.data.pagination 与 response.pagination 两种形态。
 * 后端未提供时返回 undefined，由调用方决定兜底策略。
 */
export function readPaginationHasMore(response: any): boolean | undefined {
  const value = response?.data?.pagination?.hasMore ?? response?.pagination?.hasMore;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * 从响应里读取 nextOffset；缺失或非法时返回 undefined，由调用方决定兜底策略。
 */
export function readPaginationNextOffset(response: any): number | undefined {
  const value = response?.data?.pagination?.nextOffset ?? response?.pagination?.nextOffset;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * 读取标准会话接口返回的总条数（response.data.count）。
 * 仅适用于非 OpenClaw 标准接口；OpenClaw 用 pagination.hasMore 即可。
 */
export function readResponseCount(response: any): number | undefined {
  const value = response?.data?.count ?? response?.count;
  return typeof value === "number" && value >= 0 ? value : undefined;
}