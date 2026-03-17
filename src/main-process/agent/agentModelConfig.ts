export type AgentModelConfig = {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

const DEFAULT_AGENT_PROVIDER = 'glm';
const DEFAULT_AGENT_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
const DEFAULT_AGENT_MODEL = 'glm5';

export function readAgentModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): AgentModelConfig {
  const provider = (env.AGENT_PROVIDER || DEFAULT_AGENT_PROVIDER).trim();
  const baseUrl = (env.AGENT_BASE_URL || DEFAULT_AGENT_BASE_URL).trim();
  const model = (env.AGENT_MODEL || DEFAULT_AGENT_MODEL).trim();
  const apiKey = (env.AGENT_API_KEY || '').trim();

  return {
    enabled: Boolean(baseUrl && model && apiKey),
    provider,
    baseUrl,
    model,
    apiKey,
  };
}

export function getSafeAgentModelMeta(
  config: AgentModelConfig,
): Record<string, unknown> {
  return {
    enabled: config.enabled,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
  };
}
