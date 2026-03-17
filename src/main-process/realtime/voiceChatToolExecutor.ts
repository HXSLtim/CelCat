import type { TaskKind } from '../../types/tasks';
import type {
  CompanionToolCall,
  CompanionToolExecutionResult,
} from './providerClient';

type ConversationResultLike = {
  relatedTask: {
    id: string;
  } | null;
  events: Array<{
    type: string;
    text?: string;
  }>;
} | null;

type VoiceChatSystemOrchestrator = {
  startAgentTaskFromSystem(input: {
    transcript: string;
    kind?: TaskKind;
  }): ConversationResultLike;
  renameCompanionFromSystem(displayName: string): ConversationResultLike;
  getCompanionIdentity(): {
    displayName: string;
  } | null;
};

const TOOL_CALL_PATTERN = /^\[\[CELCAT_TOOL\s+name=([A-Za-z0-9_-]+)\]\]\s*([\s\S]+)$/i;
const TOOL_CALL_FRAGMENT_PATTERN = /^\[?\[?\s*CELCAT(?:[_\s-]*TOOL|OL)?\s*name\s*=\s*([A-Za-z0-9_-]+)\s*\]?\]?\s*([\s\S]*)$/i;
const VALID_TASK_KINDS = new Set<TaskKind>(['codex', 'tool', 'claude', 'mcp']);
const KNOWN_TOOL_NAMES = ['startAgentTask', 'renameCompanion', 'openBrowser'] as const;

export class VoiceChatToolExecutor {
  constructor(
    private readonly orchestrator: VoiceChatSystemOrchestrator,
  ) {}

  async executeToolCallFromText(text: string): Promise<CompanionToolExecutionResult | null> {
    const toolCall = parseVoiceChatToolCall(text);
    if (!toolCall) {
      return null;
    }

    return this.executeToolCall(toolCall);
  }

  async executeToolCall(toolCall: CompanionToolCall): Promise<CompanionToolExecutionResult | null> {
    switch (toolCall.name) {
      case 'startAgentTask':
        return this.executeStartAgentTask(toolCall.arguments);
      case 'renameCompanion':
        return this.executeRenameCompanion(toolCall.arguments);
      case 'openBrowser':
        return this.executeOpenBrowser(toolCall.arguments);
      default:
        return null;
    }
  }

  private executeStartAgentTask(argumentsPayload: Record<string, unknown>): CompanionToolExecutionResult | null {
    const transcript = typeof argumentsPayload.transcript === 'string'
      ? argumentsPayload.transcript.trim()
      : '';
    if (!transcript) {
      return null;
    }

    const kind = typeof argumentsPayload.kind === 'string' && VALID_TASK_KINDS.has(argumentsPayload.kind as TaskKind)
      ? argumentsPayload.kind as TaskKind
      : undefined;
    const result = this.orchestrator.startAgentTaskFromSystem({
      transcript,
      kind,
    });
    return this.toExecutionResult('startAgentTask', result);
  }

  private executeRenameCompanion(argumentsPayload: Record<string, unknown>): CompanionToolExecutionResult | null {
    const displayName = typeof argumentsPayload.displayName === 'string'
      ? argumentsPayload.displayName.trim()
      : '';
    if (!displayName) {
      return null;
    }

    const result = this.orchestrator.renameCompanionFromSystem(displayName);
    const currentName = this.orchestrator.getCompanionIdentity()?.displayName || displayName;
    return {
      ...(this.toExecutionResult('renameCompanion', result)),
      syncCompanionIdentity: currentName,
    };
  }

  private executeOpenBrowser(argumentsPayload: Record<string, unknown>): CompanionToolExecutionResult | null {
    const url = typeof argumentsPayload.url === 'string'
      ? argumentsPayload.url.trim()
      : '';
    const query = typeof argumentsPayload.query === 'string'
      ? argumentsPayload.query.trim()
      : '';
    const transcript = buildOpenBrowserTranscript({
      url,
      query,
    });
    const result = this.orchestrator.startAgentTaskFromSystem({
      transcript,
      kind: 'tool',
    });
    return this.toExecutionResult('openBrowser', result);
  }

  private toExecutionResult(
    toolName: string,
    result: ConversationResultLike,
  ): CompanionToolExecutionResult {
    const assistantMessage = result?.events.find((event) => event.type === 'assistant-message')?.text || null;
    return {
      toolName,
      assistantMessage,
      relatedTaskId: result?.relatedTask?.id ?? null,
      syncCompanionIdentity: null,
    };
  }
}

export function parseVoiceChatToolCall(text: string): CompanionToolCall | null {
  const normalizedText = text.trim();
  const match = normalizedText.match(TOOL_CALL_PATTERN);
  if (!match) {
    return parseRelaxedVoiceChatToolCall(normalizedText);
  }

  const name = canonicalizeVoiceChatToolName(match[1].trim());
  const rawArguments = match[2].trim();
  const argumentsPayload = safeParseVoiceChatToolArguments(rawArguments);
  if (!name || !argumentsPayload) {
    return null;
  }

  return {
    name,
    arguments: argumentsPayload,
  };
}

export function looksLikeVoiceChatToolDirectiveFragment(text: string): boolean {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return false;
  }

  if (TOOL_CALL_PATTERN.test(normalizedText) || TOOL_CALL_FRAGMENT_PATTERN.test(normalizedText)) {
    return true;
  }

  const lowered = normalizedText.toLowerCase();
  return lowered.includes('celcat')
    && lowered.includes('name=')
    && KNOWN_TOOL_NAMES.some((toolName) => lowered.includes(toolName.toLowerCase()));
}

function safeParseVoiceChatToolArguments(rawArguments: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawArguments);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function parseRelaxedVoiceChatToolCall(text: string): CompanionToolCall | null {
  if (!looksLikeVoiceChatToolDirectiveFragment(text)) {
    return null;
  }

  const match = text.match(TOOL_CALL_FRAGMENT_PATTERN);
  if (!match) {
    return null;
  }

  const name = canonicalizeVoiceChatToolName(match[1].trim());
  if (!name) {
    return null;
  }

  const rawArguments = match[2].trim();
  const argumentsPayload = rawArguments
    ? safeParseVoiceChatToolArguments(rawArguments)
    : {};
  if (!argumentsPayload) {
    return null;
  }

  return {
    name,
    arguments: argumentsPayload,
  };
}

function canonicalizeVoiceChatToolName(rawName: string): string | null {
  const normalizedRawName = rawName.replace(/[\s_-]+/g, '').toLowerCase();
  return KNOWN_TOOL_NAMES.find((toolName) =>
    toolName.replace(/[\s_-]+/g, '').toLowerCase() === normalizedRawName,
  ) ?? null;
}

function buildOpenBrowserTranscript(input: {
  url: string;
  query: string;
}): string {
  if (input.url && input.query) {
    return `打开浏览器，搜索“${input.query}”，并访问 ${input.url}`;
  }

  if (input.url) {
    return `打开浏览器并访问 ${input.url}`;
  }

  if (input.query) {
    return `打开浏览器并搜索 ${input.query}`;
  }

  return '打开浏览器';
}
