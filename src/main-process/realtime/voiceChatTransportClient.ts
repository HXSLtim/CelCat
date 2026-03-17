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
import { buildVoiceChatStartConfig, type VoiceChatSessionBlueprint } from './voiceChatSessionBlueprint';
import type { RealtimeSessionLifecycleMode } from './protocol';

export type VolcengineVoiceChatTransportConfig = VolcengineRealtimeConfig & {
  transportLabel: 'voiceChat';
  requestedTransportMode: 'shim' | 'native';
  transportMode: 'shim' | 'native';
  nativeTransportSupported: boolean;
  protocolFamily: 'dialogue-websocket' | 'native-voicechat-openapi';
  lifecycleMode: RealtimeSessionLifecycleMode;
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
  const requestedTransportMode = resolveVoiceChatTransportMode(env.VOLCENGINE_VOICECHAT_TRANSPORT_MODE);
  const nativeTransportSupported = false;
  const transportMode = requestedTransportMode === 'native' && nativeTransportSupported
    ? 'native'
    : 'shim';
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
    requestedTransportMode,
    transportMode,
    nativeTransportSupported,
    protocolFamily: transportMode === 'native' ? 'native-voicechat-openapi' : 'dialogue-websocket',
    lifecycleMode: transportMode === 'native' ? 'voiceChatNative' : 'voiceChatShim',
  };
}

export class VolcengineVoiceChatTransportClient implements VoiceChatTransportLike {
  private sessionBlueprint: VoiceChatSessionBlueprint | null = null;
  private hasLoggedNativeFallback = false;

  constructor(
    private readonly baseClient: CompanionProvider = new VolcengineRealtimeProviderClient(
      readVolcengineVoiceChatTransportConfig(process.env),
    ),
    private readonly config: VolcengineVoiceChatTransportConfig = readVolcengineVoiceChatTransportConfig(process.env),
  ) {}

  setSessionBlueprint(blueprint: VoiceChatSessionBlueprint | null): void {
    this.sessionBlueprint = blueprint;
    const startConfig = blueprint ? buildVoiceChatStartConfig(blueprint) : null;
    this.logNativeFallbackIfNeeded();
    if ('setTransportLifecycleMode' in this.baseClient && typeof this.baseClient.setTransportLifecycleMode === 'function') {
      this.baseClient.setTransportLifecycleMode(this.config.lifecycleMode);
    }
    if ('setVoiceChatStartConfig' in this.baseClient && typeof this.baseClient.setVoiceChatStartConfig === 'function') {
      this.baseClient.setVoiceChatStartConfig(startConfig);
    }
    if ('setSessionSystemRole' in this.baseClient && typeof this.baseClient.setSessionSystemRole === 'function') {
      this.baseClient.setSessionSystemRole(blueprint ? buildVoiceChatSessionSystemRole(blueprint) : null);
    }
    logDebug('provider', 'VoiceChat transport received session blueprint', {
      startEventName: this.config.startEventName,
      transportMode: this.config.transportMode,
      protocolFamily: this.config.protocolFamily,
      hasBlueprint: Boolean(blueprint),
      displayName: blueprint?.assistant.displayName ?? null,
      toolCount: blueprint?.capabilities.tools.length ?? 0,
      mcpCount: blueprint?.capabilities.mcpServers.length ?? 0,
      nativeSystemMessageCount: startConfig?.systemMessages.length ?? 0,
    });
  }

  connect(): Promise<void> {
    this.logNativeFallbackIfNeeded();
    logDebug('provider', 'Connecting via dedicated voiceChat transport', {
      address: this.config.address,
      uri: this.config.uri,
      resourceId: this.config.resourceId,
      startEventName: this.config.startEventName,
      requestedTransportMode: this.config.requestedTransportMode,
      transportMode: this.config.transportMode,
      protocolFamily: this.config.protocolFamily,
      migrationMode: this.config.transportMode === 'native'
        ? 'native-startvoicechat-transport'
        : 'dialogue-compatible-transport-shim',
    });
    return this.baseClient.connect();
  }

  disconnect(): Promise<void> {
    return this.baseClient.disconnect();
  }

  startSession(): Promise<void> {
    const startConfig = this.sessionBlueprint ? buildVoiceChatStartConfig(this.sessionBlueprint) : null;
    this.logNativeFallbackIfNeeded();
    logDebug('provider', 'Starting voiceChat transport session', {
      displayName: this.sessionBlueprint?.assistant.displayName ?? this.config.botName,
      toolCount: this.sessionBlueprint?.capabilities.tools.length ?? 0,
      mcpCount: this.sessionBlueprint?.capabilities.mcpServers.length ?? 0,
      nativeFunctionCount: startConfig?.functions.length ?? 0,
      nativeMcpCount: startConfig?.mcps.length ?? 0,
      hasActiveTask: Boolean(this.sessionBlueprint?.activeTask),
      requestedTransportMode: this.config.requestedTransportMode,
      transportMode: this.config.transportMode,
      protocolFamily: this.config.protocolFamily,
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

  private logNativeFallbackIfNeeded(): void {
    if (
      this.hasLoggedNativeFallback
      || this.config.requestedTransportMode !== 'native'
      || this.config.transportMode === 'native'
    ) {
      return;
    }

    this.hasLoggedNativeFallback = true;
    logDebug('provider', 'Native StartVoiceChat transport is not implemented yet; falling back to shim mode', {
      requestedTransportMode: this.config.requestedTransportMode,
      effectiveTransportMode: this.config.transportMode,
    });
  }
}

function buildVoiceChatSessionSystemRole(blueprint: VoiceChatSessionBlueprint): string {
  return blueprint.assistant.systemPrompt.slice(0, 1200);
}

function resolveVoiceChatTransportMode(rawMode?: string): 'shim' | 'native' {
  const normalized = (rawMode || 'shim').trim().toLowerCase();
  return normalized === 'native' || normalized === 'startvoicechat-native'
    ? 'native'
    : 'shim';
}
