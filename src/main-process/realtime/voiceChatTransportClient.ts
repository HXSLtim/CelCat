import { logDebug } from '../../shared/debugLogger';
import type { CompanionIdentityProfile } from '../agent/agentMemoryStore';
import {
  type CompanionProvider,
  type CompanionReplyPayload,
  type CompanionToolExecutionResult,
  type CompanionToolCall,
  type ProviderEvent,
  type VolcengineRealtimeConfig,
  VolcengineRealtimeProviderClient,
  readVolcengineRealtimeConfig,
} from './providerClient';
import type { VoiceChatSessionBlueprint } from './voiceChatSessionBlueprint';

export type VolcengineVoiceChatTransportConfig = VolcengineRealtimeConfig & {
  transportLabel: 'voiceChat';
  startEventName: string;
  appendEventName: string;
  commitEventName: string;
};

type VoiceChatTransportLike = CompanionProvider & {
  setSessionBlueprint?(blueprint: VoiceChatSessionBlueprint | null): void;
};

export function readVolcengineVoiceChatTransportConfig(
  env: NodeJS.ProcessEnv = process.env,
): VolcengineVoiceChatTransportConfig {
  const baseConfig = readVolcengineRealtimeConfig(env);
  return {
    ...baseConfig,
    enabled: env.VOLCENGINE_VOICECHAT_ENABLED
      ? env.VOLCENGINE_VOICECHAT_ENABLED === 'true'
      : baseConfig.enabled,
    address: env.VOLCENGINE_VOICECHAT_ADDRESS || baseConfig.address,
    uri: env.VOLCENGINE_VOICECHAT_URI || baseConfig.uri,
    appId: env.VOLCENGINE_VOICECHAT_APP_ID || baseConfig.appId,
    accessToken: env.VOLCENGINE_VOICECHAT_ACCESS_KEY || env.VOLCENGINE_VOICECHAT_ACCESS_TOKEN || baseConfig.accessToken,
    resourceId: env.VOLCENGINE_VOICECHAT_RESOURCE_ID || baseConfig.resourceId,
    uid: env.VOLCENGINE_VOICECHAT_UID || baseConfig.uid,
    botName: env.VOLCENGINE_VOICECHAT_BOT_NAME || baseConfig.botName,
    headersJson: env.VOLCENGINE_VOICECHAT_HEADERS_JSON || baseConfig.headersJson,
    systemRole: env.VOLCENGINE_VOICECHAT_SYSTEM_ROLE || baseConfig.systemRole,
    speakingStyle: env.VOLCENGINE_VOICECHAT_SPEAKING_STYLE || baseConfig.speakingStyle,
    speaker: env.VOLCENGINE_VOICECHAT_TTS_SPEAKER || baseConfig.speaker,
    ttsFormat: env.VOLCENGINE_VOICECHAT_TTS_FORMAT === 'pcm' ? 'pcm' : baseConfig.ttsFormat,
    ttsSampleRate: Number.parseInt(env.VOLCENGINE_VOICECHAT_TTS_SAMPLE_RATE || '', 10) || baseConfig.ttsSampleRate,
    startEventName: env.VOLCENGINE_VOICECHAT_START_EVENT || 'StartVoiceChat',
    appendEventName: env.VOLCENGINE_VOICECHAT_APPEND_EVENT || baseConfig.appendEventName,
    commitEventName: env.VOLCENGINE_VOICECHAT_COMMIT_EVENT || baseConfig.commitEventName,
    transportLabel: 'voiceChat',
  };
}

export class VolcengineVoiceChatTransportClient implements VoiceChatTransportLike {
  private sessionBlueprint: VoiceChatSessionBlueprint | null = null;

  constructor(
    private readonly baseClient: CompanionProvider = new VolcengineRealtimeProviderClient(
      readVolcengineVoiceChatTransportConfig(process.env),
    ),
    private readonly config: VolcengineVoiceChatTransportConfig = readVolcengineVoiceChatTransportConfig(process.env),
  ) {}

  setSessionBlueprint(blueprint: VoiceChatSessionBlueprint | null): void {
    this.sessionBlueprint = blueprint;
    logDebug('provider', 'VoiceChat transport received session blueprint', {
      startEventName: this.config.startEventName,
      hasBlueprint: Boolean(blueprint),
      displayName: blueprint?.assistant.displayName ?? null,
      toolCount: blueprint?.capabilities.tools.length ?? 0,
      mcpCount: blueprint?.capabilities.mcpServers.length ?? 0,
    });
  }

  connect(): Promise<void> {
    logDebug('provider', 'Connecting via dedicated voiceChat transport shim', {
      address: this.config.address,
      uri: this.config.uri,
      resourceId: this.config.resourceId,
      startEventName: this.config.startEventName,
      migrationMode: 'dialogue-compatible-transport-shim',
    });
    return this.baseClient.connect();
  }

  disconnect(): Promise<void> {
    return this.baseClient.disconnect();
  }

  startSession(): Promise<void> {
    logDebug('provider', 'Starting voiceChat transport session', {
      displayName: this.sessionBlueprint?.assistant.displayName ?? this.config.botName,
      toolCount: this.sessionBlueprint?.capabilities.tools.length ?? 0,
      mcpCount: this.sessionBlueprint?.capabilities.mcpServers.length ?? 0,
      hasActiveTask: Boolean(this.sessionBlueprint?.activeTask),
      lifecycle: this.sessionBlueprint?.transport.lifecycle ?? 'startVoiceChat-compatible',
    });
    return this.baseClient.startSession();
  }

  generateReply(input: string): Promise<string | null> {
    return this.baseClient.generateReply(input);
  }

  generateReplyPayload?(input: string): Promise<CompanionReplyPayload> {
    return this.baseClient.generateReplyPayload
      ? this.baseClient.generateReplyPayload(input)
      : Promise.resolve({
        message: null,
        toolCall: null,
      });
  }

  appendInputAudioFrame(frame: { pcmBase64: string; sampleRate: number; channels: number }): Promise<void> {
    return this.baseClient.appendInputAudioFrame(frame);
  }

  commitInputAudio(): Promise<void> {
    return this.baseClient.commitInputAudio();
  }

  isEnabled(): boolean {
    return this.baseClient.isEnabled();
  }

  setEventSink(listener: ((event: ProviderEvent) => void) | null): void {
    this.baseClient.setEventSink(listener);
  }

  syncCompanionIdentity(identity: Pick<CompanionIdentityProfile, 'displayName'>): Promise<void> {
    return this.baseClient.syncCompanionIdentity(identity);
  }

  executeToolCall?(toolCall: CompanionToolCall): Promise<CompanionToolExecutionResult | null> {
    return this.baseClient.executeToolCall
      ? this.baseClient.executeToolCall(toolCall)
      : Promise.resolve(null);
  }
}
