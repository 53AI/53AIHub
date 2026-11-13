export const CHAT_COMPLETIONS_API_FORMAT = "chat_completions";
export const RESPONSES_API_FORMAT = "responses";

const responsesAPIChannelTypes = new Set([1, 3, 17, 36, 900, 1012, 1019]);

export const supportsModelAPIFormat = (
  channelType: number,
  modelType: string,
  baseURL: string,
) =>
  responsesAPIChannelTypes.has(Number(channelType)) &&
  modelType === "1" &&
  (Number(channelType) !== 17 || baseURL.includes("/compatible-mode"));

export const applyModelAPIFormat = <T extends Record<string, any>>(
  config: T[] | T,
  modelId: string,
  format: string,
): T[] | T => {
  if (Array.isArray(config)) {
    return config.map((item) =>
      item.model_id === modelId ? { ...item, upstream_api_format: format } : item,
    );
  }
  return { ...config, upstream_api_format: format };
};
