export type CompanionProviderMode = 'dialogue' | 'voiceChat';

export type CompanionProviderModeConfig = {
  mode: CompanionProviderMode;
};

export function readCompanionProviderModeConfig(
  env: NodeJS.ProcessEnv = process.env,
): CompanionProviderModeConfig {
  const rawMode = (env.VOLCENGINE_REALTIME_PROVIDER_MODE || 'dialogue').trim().toLowerCase();
  return {
    mode: rawMode === 'voicechat' || rawMode === 'voice_chat' || rawMode === 'voice-chat'
      ? 'voiceChat'
      : 'dialogue',
  };
}
