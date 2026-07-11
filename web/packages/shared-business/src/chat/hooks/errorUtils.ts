/**
 * Error types that indicate API errors
 */
const ERROR_TYPES = [
  "upstream_error",
  "BadRequest",
  "authentication_error",
  "invalid_request_error",
  "Unauthorized",
];

const ERROR_MESSAGES = [
  "token验证失败",
  "请求参数有误",
  "Resource not found",
];

/**
 * Check if parsed answer object contains an API error
 */
export function isParsedAnswerError(obj: any): boolean {
  const type = obj?.error?.type;
  const msg = obj?.error?.message;
  if (ERROR_TYPES.includes(type) || ERROR_MESSAGES.includes(msg)) return true;
  if (obj?.status === 401) return true;
  if (obj?.code === "InvalidApiKey") return true;
  return false;
}

/**
 * Check if answer text contains a catchable error message
 */
export function isParsedAnswerCatchError(text: string): boolean {
  if (!text) return false;
  if (text.startsWith("Upstream Error")) return true;
  if (text.includes("App access denied")) return true;
  return false;
}

/**
 * Get user-friendly error message from answer
 */
export function getErrorMessage(answer: string, fallbackMessage?: string): string {
  try {
    const parsed = answer && JSON.parse(answer);
    if (parsed && typeof parsed === "object" && isParsedAnswerError(parsed)) {
      return fallbackMessage || "响应生成失败，请重试";
    }
  } catch {
    if (isParsedAnswerCatchError(answer)) {
      return fallbackMessage || "响应生成失败，请重试";
    }
  }
  return answer;
}
