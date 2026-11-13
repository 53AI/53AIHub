export interface AzureModelOption {
  model_id: string;
  model_name: string;
  preview?: boolean;
  vision?: boolean;
  enabled_tools?: string[];
  upstream_api_format?: string;
  supported_api_formats?: string[];
}

export interface AzureModelConfig {
  model_id: string;
  base_model_id: string;
  upstream_api_format: string;
  enabled_tools: string[];
  vision: boolean;
}

export const getAzureModelCapabilities = (
  modelID: string,
  models: AzureModelOption[],
) => {
  const model = models.find((item) => item.model_id === modelID);
  return {
    model,
    known: Boolean(model),
    preview: model?.preview ?? false,
    vision: model?.vision ?? false,
    webSearch: model?.enabled_tools?.includes("web_search") ?? false,
    enabledTools: model?.enabled_tools ?? [],
    upstreamAPIFormat: model?.upstream_api_format ?? "chat_completions",
    supportedAPIFormats: model?.supported_api_formats ?? ["chat_completions", "responses"],
  };
};

export const buildAzureModelConfig = (
  baseModelID: string,
  deploymentName: string,
  models: AzureModelOption[],
  options: { upstreamAPIFormat?: string; webSearchEnabled?: boolean } = {},
): AzureModelConfig => {
  const capabilities = getAzureModelCapabilities(baseModelID, models);
  const upstreamAPIFormat = options.upstreamAPIFormat || capabilities.upstreamAPIFormat;
  if (!capabilities.supportedAPIFormats.includes(upstreamAPIFormat)) {
    throw new Error(`Azure 基础模型 ${baseModelID} 不支持 ${upstreamAPIFormat}`);
  }
  const enabledTools = capabilities.enabledTools.filter((tool) => tool !== "web_search");
  if (
    options.webSearchEnabled &&
    capabilities.webSearch &&
    upstreamAPIFormat === "responses"
  ) {
    enabledTools.push("web_search");
  }
  return {
    model_id: deploymentName.trim(),
    base_model_id: baseModelID,
    upstream_api_format: upstreamAPIFormat,
    enabled_tools: enabledTools,
    vision: capabilities.vision,
  };
};
