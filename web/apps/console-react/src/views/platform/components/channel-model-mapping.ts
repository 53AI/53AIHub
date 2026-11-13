// Keep the existing channel model keys; only exclude known metadata fields.
export const getChannelModelTypeKeys = (config: Record<string, unknown>): string[] =>
  Object.keys(config).filter(
    (key) => !['deep_thinking', 'vision', 'alias_map', 'models', 'voice_models', 'decision_model_endpoints'].includes(key),
  )
