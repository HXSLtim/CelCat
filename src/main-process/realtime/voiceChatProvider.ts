import { logDebug } from '../../shared/debugLogger';
import type { CompanionIdentityProfile } from '../agent/agentMemoryStore';
import {
  type CompanionReplyPayload,
  type CompanionProvider,
  type CompanionToolCall,
  type ProviderEvent,
} from './providerClient';
import { getVoiceChatToolPromptSummary } from './voiceChatToolRegistry';
import {
  looksLikeVoiceChatToolDirectiveFragment,
  parseVoiceChatToolCall,
  VoiceChatToolExecutor,
} from './voiceChatToolExecutor';
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
      hasBlueprint: Boolean(blueprint),
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

    if (event.type === 'transcript' || event.type === 'error') {
      this.suppressCompatibilityToolMessage = false;
    }

    if (event.type === 'assistant-message' && this.toolExecutor) {
      const normalizedText = event.text.trim();
      const looksLikeDirective = looksLikeVoiceChatToolDirectiveFragment(normalizedText);
      if (looksLikeDirective) {
        this.suppressCompatibilityToolMessage = true;
      }

      if (this.suppressCompatibilityToolMessage) {
        const toolCall = parseVoiceChatToolCall(normalizedText);
        if (toolCall) {
          if (event.isFinal !== false) {
            this.suppressCompatibilityToolMessage = false;
            this.eventSink({
              type: 'tool-call',
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              rawText: normalizedText,
            });
          }
          return;
        }

        if (event.isFinal !== false) {
          this.suppressCompatibilityToolMessage = false;
          if (looksLikeDirective) {
            logDebug('provider', 'Dropped malformed compatibility tool fragment from provider stream', {
              text: normalizedText.slice(0, 200),
            });
            return;
          }

          this.eventSink(event);
          return;
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
    '关于 renameCompanion：只有在用户明确要求你改名、换名、以后改叫某个名字时才调用。',
    '如果用户只是问“你叫什么名字”“你现在叫什么”“你是谁”，这是普通聊天，直接回答当前名字，不要调用 renameCompanion。',
    'renameCompanion 的 displayName 必须只填写新的名字本身，不能带“名字”“叫什么”“我说”这类多余词。',
    '正例：“以后叫你小影” -> [[CELCAT_TOOL name=renameCompanion]]{"displayName":"小影"}',
    '反例：“你叫什么名字” -> 直接回答当前名字，不调用工具。',
    '如果只是普通闲聊，正常直接回复即可。',
    '兼容说明：如果上游提示里已经要求你输出 [[CELCAT_AGENT ...]]，你也可以照做；但优先使用上面的工具调用格式。',
    blueprint ? '以下是本轮会话初始化蓝图摘要：' : '',
    blueprint ? buildVoiceChatCompatibilityContextBlock(blueprint) : '',
    '以下是本轮对话输入：',
    input,
  ].join('\n');
}
