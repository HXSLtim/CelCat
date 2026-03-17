import {
  getSafeAgentModelMeta,
  readAgentModelConfig,
  type AgentModelConfig,
} from './agentModelConfig';
import type { AgentPlanningMemoryContext, CompanionIdentityProfile } from './agentMemoryStore';
import type { TaskKind } from '../../types/tasks';
import { logDebug, truncateDebugText } from '../../shared/debugLogger';

const GLM_CHAT_COMPLETIONS_PATH = '/chat/completions';

export type IntentRoutingDecision = {
  mode: 'chat' | 'agent';
  kind?: TaskKind;
  transcript?: string;
  confidence?: number;
  reason?: string;
};

type RouteTranscriptInput = {
  transcript: string;
  latestTaskTitle?: string | null;
  companionIdentity?: CompanionIdentityProfile | null;
  memoryContext?: AgentPlanningMemoryContext;
};

type RouterResponse = {
  mode?: 'chat' | 'agent';
  kind?: 'codex' | 'tool' | 'claude' | 'mcp';
  transcript?: string;
  confidence?: number;
  reason?: string;
};

export class AgentIntentRouter {
  constructor(
    private readonly config: AgentModelConfig = readAgentModelConfig(process.env),
  ) {}

  async routeTranscript(input: RouteTranscriptInput): Promise<IntentRoutingDecision | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}${GLM_CHAT_COMPLETIONS_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: [
                '你是 CelCat 实时语音系统内部的意图路由器。',
                '你的任务是判断：当前用户转写应该继续走陪聊(chat)，还是必须交给后台 agent(agent)。',
                '凡是需要实际执行、打开浏览器/网页、搜索、访问网站、代码修改、文件操作、运行命令、持续处理、多步骤规划、调用工具/skill/MCP 的，都应判为 agent。',
                '纯闲聊、寒暄、情绪陪伴、简单追问、身份聊天才是 chat。',
                '输出 JSON，不要输出任何额外文本。',
              ].join(' '),
            },
            {
              role: 'user',
              content: JSON.stringify({
                transcript: input.transcript,
                latestTaskTitle: input.latestTaskTitle || '',
                companionIdentity: input.companionIdentity
                  ? {
                      displayName: input.companionIdentity.displayName,
                      identityNotes: input.companionIdentity.identityNotes.slice(0, 3),
                    }
                  : null,
                memoryHints: {
                  relevantMemories: (input.memoryContext?.relevantMemories || []).slice(0, 2),
                  stablePreferences: (input.memoryContext?.stablePreferences || []).slice(0, 3),
                },
                outputSchema: {
                  mode: 'chat|agent',
                  kind: 'codex|tool|claude|mcp',
                  transcript: 'string',
                  confidence: '0-1',
                  reason: 'string',
                },
              }),
            },
          ],
          response_format: {
            type: 'json_object',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Agent intent router request failed (${response.status})`);
      }

      const payload = await response.json() as Record<string, any>;
      const content = extractRouterContent(payload);
      const parsed = JSON.parse(content) as RouterResponse;
      const normalized = normalizeRouterResponse(parsed, input.transcript);
      logDebug('intent', 'Agent intent router classified transcript', {
        transcript: truncateDebugText(input.transcript, 200),
        decision: normalized,
      });
      return normalized;
    } catch (error: any) {
      logDebug('intent', 'Agent intent router fell back to local heuristics', {
        reason: error?.message || 'unknown error',
        model: getSafeAgentModelMeta(this.config),
        transcript: truncateDebugText(input.transcript, 200),
      });
      return null;
    }
  }
}

function extractRouterContent(payload: Record<string, any>): string {
  const candidate =
    payload.choices?.[0]?.message?.content
    ?? payload.choices?.[0]?.delta?.content
    ?? payload.output?.text
    ?? payload.text;

  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }

  throw new Error('Agent intent router returned an empty response');
}

function normalizeRouterResponse(
  parsed: RouterResponse,
  transcript: string,
): IntentRoutingDecision | null {
  if (parsed.mode !== 'chat' && parsed.mode !== 'agent') {
    return null;
  }

  if (parsed.mode === 'chat') {
    return {
      mode: 'chat',
      confidence: clampConfidence(parsed.confidence),
      reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
    };
  }

  const kind = parsed.kind === 'codex' || parsed.kind === 'tool' || parsed.kind === 'claude' || parsed.kind === 'mcp'
    ? parsed.kind
    : 'claude';

  return {
    mode: 'agent',
    kind,
    transcript: typeof parsed.transcript === 'string' && parsed.transcript.trim()
      ? parsed.transcript.trim()
      : transcript,
    confidence: clampConfidence(parsed.confidence),
    reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
  };
}

function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, value));
}
