import {
  type CompanionProvider,
  VolcengineRealtimeProviderClient,
} from './providerClient';
import type { AgentPlanningMemoryContext, CompanionIdentityProfile } from '../agent/agentMemoryStore';
import {
  readCompanionProviderModeConfig,
  type CompanionProviderModeConfig,
} from './providerMode';
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
  if (config.mode === 'voiceChat') {
    const sessionContext = runtime.orchestrator?.getVoiceChatSessionContext?.() ?? null;
    return new VolcengineVoiceChatProviderClient(
      new VolcengineVoiceChatTransportClient(),
      runtime.orchestrator ? new VoiceChatToolExecutor(runtime.orchestrator) : null,
      () => buildVoiceChatSessionBlueprint({
        env: process.env,
        cwd: process.cwd(),
        companionIdentity: sessionContext?.companionIdentity
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
        memoryContext: sessionContext?.memoryContext ?? null,
        latestTask: sessionContext?.latestTask ?? null,
      }),
    );
  }

  return new VolcengineRealtimeProviderClient();
}
