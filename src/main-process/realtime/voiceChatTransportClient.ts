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
  transportMode: 'shim' | 'native';
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
  const transportMode = resolveVoiceChatTransportMode(env.VOLCENGINE_VOICECHAT_TRANSPORT_MODE);
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
    transportMode,
    protocolFamily: transportMode === 'native' ? 'native-voicechat-openapi' : 'dialogue-websocket',
    lifecycleMode: transportMode === 'native' ? 'voiceChatNative' : 'voiceChatShim',
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
    const startConfig = blueprint ? buildVoiceChatStartConfig(blueprint) : null;
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
    logDebug('provider', 'Connecting via dedicated voiceChat transport', {
      address: this.config.address,
      uri: this.config.uri,
      resourceId: this.config.resourceId,
      startEventName: this.config.startEventName,
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
    logDebug('provider', 'Starting voiceChat transport session', {
      displayName: this.sessionBlueprint?.assistant.displayName ?? this.config.botName,
      toolCount: this.sessionBlueprint?.capabilities.tools.length ?? 0,
      mcpCount: this.sessionBlueprint?.capabilities.mcpServers.length ?? 0,
      nativeFunctionCount: startConfig?.functions.length ?? 0,
      nativeMcpCount: startConfig?.mcps.length ?? 0,
      hasActiveTask: Boolean(this.sessionBlueprint?.activeTask),
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
}

function buildVoiceChatSessionSystemRole(blueprint: VoiceChatSessionBlueprint): string {
  const toolSummary = blueprint.capabilities.tools
    .map((tool) => `${tool.id}: ${tool.description}`)
    .join('；');
  const mcpSummary = blueprint.capabilities.mcpServers.length
    ? blueprint.capabilities.mcpServers
      .slice(0, 4)
      .map((capability) => `${capability.label}: ${capability.defaultReason}`)
      .join('；')
    : '当前没有额外 MCP。';
  const sections = [
    blueprint.assistant.systemPrompt,
    blueprint.memory.stablePreferences.length
      ? `用户稳定偏好：${blueprint.memory.stablePreferences.join('；')}`
      : '',
    blueprint.memory.relevantMemories.length
      ? `相关记忆：${blueprint.memory.relevantMemories.join('；')}`
      : '',
    blueprint.memory.longTermMemories.length
      ? `长期记忆：${blueprint.memory.longTermMemories.join('；')}`
      : '',
    `可用工具：${toolSummary}`,
    `可用 MCP：${mcpSummary}`,
    blueprint.activeTask
      ? `当前后台任务：${blueprint.activeTask.title}，进度：${blueprint.activeTask.progressSummary}`
      : '',
    '如果用户明确要求你改名、换名、以后改叫某个名字，优先输出 [[CELCAT_TOOL name=renameCompanion]]{"displayName":"新名字"}。',
    '如果用户要求打开浏览器、访问网页、搜索资料或执行任务，优先输出对应工具调用，而不是口头拒绝。',
    '如果只是普通聊天，就自然直接回复，不要输出工具调用。',
  ].filter(Boolean);

  return sections.join('\n').slice(0, 2400);
}

function resolveVoiceChatTransportMode(rawMode?: string): 'shim' | 'native' {
  const normalized = (rawMode || 'shim').trim().toLowerCase();
  return normalized === 'native' || normalized === 'startvoicechat-native'
    ? 'native'
    : 'shim';
}
