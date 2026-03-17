import {
  type CompanionProvider,
  VolcengineRealtimeProviderClient,
} from './providerClient';
import type { AgentPlanningMemoryContext, CompanionIdentityProfile } from '../agent/agentMemoryStore';
import {
  readCompanionProviderModeConfig,
  type CompanionProviderModeConfig,
} from './providerMode';
import { logDebug } from '../../shared/debugLogger';
import { VolcengineVoiceChatProviderClient } from './voiceChatProvider';
import { VoiceChatToolExecutor } from './voiceChatToolExecutor';
import { buildVoiceChatSessionBlueprint } from './voiceChatSessionBlueprint';
import { VolcengineVoiceChatTransportClient } from './voiceChatTransportClient';

type CompanionProviderRuntime = {
  orchestrator?: {
    startAgentTaskFromSystem(input: {
      transcript: string;
      kind?: 'codex' | 'tool' | 'claude' | 'mcp';
    }): {
      relatedTask: {
        id: string;
      } | null;
      events: Array<{
        type: string;
        text?: string;
      }>;
    } | null;
    renameCompanionFromSystem(displayName: string): {
      relatedTask: {
        id: string;
      } | null;
      events: Array<{
        type: string;
        text?: string;
      }>;
    } | null;
    getCompanionIdentity(): {
      displayName: string;
    } | null;
    getVoiceChatSessionContext?(): {
      companionIdentity: Pick<CompanionIdentityProfile, 'displayName' | 'identityNotes'> | null;
      memoryContext: AgentPlanningMemoryContext | null;
      latestTask: {
        id: string;
        title: string;
        progressSummary: string;
      } | null;
    };
  };
};

export function createCompanionProvider(
  env: NodeJS.ProcessEnv = process.env,
  runtime: CompanionProviderRuntime = {},
): CompanionProvider {
  const config = readCompanionProviderModeConfig(env);
  return createCompanionProviderForMode(config, runtime);
}

export function createCompanionProviderForMode(
  config: CompanionProviderModeConfig,
  runtime: CompanionProviderRuntime = {},
): CompanionProvider {
  logDebug('provider', 'Resolved companion provider mode', {
    mode: config.mode,
    hasRuntimeOrchestrator: Boolean(runtime.orchestrator),
  });
  if (config.mode === 'voiceChat') {
    return new VolcengineVoiceChatProviderClient(
      new VolcengineVoiceChatTransportClient(),
      runtime.orchestrator ? new VoiceChatToolExecutor(runtime.orchestrator) : null,
      () => buildVoiceChatSessionBlueprint({
        env: process.env,
        cwd: process.cwd(),
        companionIdentity: (runtime.orchestrator?.getVoiceChatSessionContext?.() ?? null)?.companionIdentity
          ?? (() => {
            const identity = runtime.orchestrator?.getCompanionIdentity?.();
            return identity
              ? {
                  displayName: identity.displayName,
                  identityNotes: [],
                }
              : null;
          })()
          ?? null,
        memoryContext: (runtime.orchestrator?.getVoiceChatSessionContext?.() ?? null)?.memoryContext ?? null,
        latestTask: (runtime.orchestrator?.getVoiceChatSessionContext?.() ?? null)?.latestTask ?? null,
      }),
    );
  }

  return new VolcengineRealtimeProviderClient();
}
