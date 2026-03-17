import { logDebug } from '../../shared/debugLogger';
import type { CompanionIdentityProfile } from '../agent/agentMemoryStore';
import {
  type CompanionReplyPayload,
  type CompanionProvider,
  type CompanionToolCall,
  type ProviderEvent,
} from './providerClient';
import { getVoiceChatToolPromptSummary } from './voiceChatToolRegistry';
import { parseVoiceChatToolCall, VoiceChatToolExecutor } from './voiceChatToolExecutor';
import {
  buildVoiceChatCompatibilityContextBlock,
  type VoiceChatSessionBlueprint,
} from './voiceChatSessionBlueprint';
import { VolcengineVoiceChatTransportClient } from './voiceChatTransportClient';

export class VolcengineVoiceChatProviderClient implements CompanionProvider {
  private eventSink: Parameters<CompanionProvider['setEventSink']>[0] = null;
  private suppressCompatibilityToolMessage = false;

  constructor(
    private readonly fallbackProvider: CompanionProvider = new VolcengineVoiceChatTransportClient(),
    private readonly toolExecutor: VoiceChatToolExecutor | null = null,
    private readonly sessionBlueprintResolver: (() => VoiceChatSessionBlueprint) | null = null,
  ) {
    this.fallbackProvider.setEventSink((event) => {
      this.handleFallbackProviderEvent(event);
    });
    logDebug('provider', 'Initialized VoiceChat migration provider in compatibility mode', {
      toolSummary: getVoiceChatToolPromptSummary(),
      toolExecutorEnabled: Boolean(this.toolExecutor),
    });
  }

  connect(): Promise<void> {
    return this.fallbackProvider.connect();
  }

  disconnect(): Promise<void> {
    return this.fallbackProvider.disconnect();
  }

  startSession(): Promise<void> {
    const blueprint = this.sessionBlueprintResolver?.() ?? null;
    logDebug('provider', 'VoiceChat migration provider starting session via compatibility transport');
    if (blueprint) {
      if ('setSessionBlueprint' in this.fallbackProvider && typeof this.fallbackProvider.setSessionBlueprint === 'function') {
        this.fallbackProvider.setSessionBlueprint(blueprint);
      }
      logDebug('provider', 'Prepared StartVoiceChat-compatible session blueprint', {
        displayName: blueprint.assistant.displayName,
        toolCount: blueprint.capabilities.tools.length,
        mcpCount: blueprint.capabilities.mcpServers.length,
        stablePreferenceCount: blueprint.memory.stablePreferences.length,
        relevantMemoryCount: blueprint.memory.relevantMemories.length,
        activeTaskTitle: blueprint.activeTask?.title ?? null,
      });
    }
    return this.fallbackProvider.startSession();
  }

  async generateReply(input: string): Promise<string | null> {
    const payload = await this.generateReplyPayload(input);
    return payload.toolCall ? payload.toolCall.rawText || null : payload.message;
  }

  async generateReplyPayload(input: string): Promise<CompanionReplyPayload> {
    const blueprint = this.sessionBlueprintResolver?.() ?? null;
    const prompt = this.toolExecutor
      ? buildVoiceChatCompatibilityPrompt(input, blueprint)
      : input;
    logDebug('provider', 'VoiceChat compatibility prompt prepared', {
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 1200),
    });
    const reply = await this.fallbackProvider.generateReply(prompt);
    if (!reply || !this.toolExecutor) {
      return {
        message: reply,
        toolCall: null,
      };
    }

    const toolCall = parseVoiceChatToolCall(reply);
    if (!toolCall) {
      return {
        message: reply,
        toolCall: null,
      };
    }

    return {
      message: null,
      toolCall: {
        ...toolCall,
        rawText: reply,
      },
    };
  }

  appendInputAudioFrame(frame: { pcmBase64: string; sampleRate: number; channels: number }): Promise<void> {
    return this.fallbackProvider.appendInputAudioFrame(frame);
  }

  commitInputAudio(): Promise<void> {
    return this.fallbackProvider.commitInputAudio();
  }

  isEnabled(): boolean {
    return this.fallbackProvider.isEnabled();
  }

  setEventSink(listener: Parameters<CompanionProvider['setEventSink']>[0]): void {
    this.eventSink = listener;
  }

  syncCompanionIdentity(identity: Pick<CompanionIdentityProfile, 'displayName'>): Promise<void> {
    return this.fallbackProvider.syncCompanionIdentity(identity);
  }

  async executeToolCall(toolCall: CompanionToolCall) {
    if (!this.toolExecutor) {
      return null;
    }

    const toolExecution = await this.toolExecutor.executeToolCall(toolCall);
    if (!toolExecution) {
      return null;
    }

    logDebug('provider', 'Executed compatibility VoiceChat tool call', {
      toolName: toolExecution.toolName,
      relatedTaskId: toolExecution.relatedTaskId,
      syncCompanionIdentity: toolExecution.syncCompanionIdentity,
    });

    return toolExecution;
  }

  private handleFallbackProviderEvent(event: ProviderEvent): void {
    if (!this.eventSink) {
      return;
    }

    if (event.type === 'assistant-message' && this.toolExecutor) {
      if (event.text.trim().startsWith('[[CELCAT_TOOL')) {
        this.suppressCompatibilityToolMessage = true;
      }

      if (this.suppressCompatibilityToolMessage) {
        if (event.isFinal !== false) {
          this.suppressCompatibilityToolMessage = false;
          const toolCall = parseVoiceChatToolCall(event.text);
          if (toolCall) {
            this.eventSink({
              type: 'tool-call',
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              rawText: event.text,
            });
            return;
          }
        }

        return;
      }
    }

    this.eventSink(event);
  }
}

function buildVoiceChatCompatibilityPrompt(
  input: string,
  blueprint: VoiceChatSessionBlueprint | null,
): string {
  return [
    '你正在运行在 CelCat 的 VoiceChat 兼容 Function Calling 模式中。',
    '如果需要调用本地工具，请只输出一行工具调用，不要输出解释、前后缀或 Markdown。',
    '工具调用格式：[[CELCAT_TOOL name=<toolName>]]{"field":"value"}',
    '可用工具：startAgentTask={kind,transcript}；renameCompanion={displayName}；openBrowser={url?,query?}。',
    '当用户要求你执行任务、打开浏览器、访问网页、搜索资料、修改项目、处理文件、调用 skill 或 MCP、或者要求更改你的名字时，优先使用工具调用。',
    '如果只是普通闲聊，正常直接回复即可。',
    '兼容说明：如果上游提示里已经要求你输出 [[CELCAT_AGENT ...]]，你也可以照做；但优先使用上面的工具调用格式。',
    blueprint ? '以下是本轮会话初始化蓝图摘要：' : '',
    blueprint ? buildVoiceChatCompatibilityContextBlock(blueprint) : '',
    '以下是本轮对话输入：',
    input,
  ].join('\n');
}
