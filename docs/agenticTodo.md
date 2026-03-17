# Agentic TODO

## Goal

- 把当前“提示词 + 文本协议 + 正则兜底”的混合链路，逐步迁移到更稳定的 agent / tool / MCP 决策链。

## Current Reality

- 现在已经撤掉了“口头改名的本地正则拦截”。
- 但仍有几类规则属于本地启发式，不是纯 agent：
  - `ConversationOrchestrator` 里的进度查询 / 取消任务 / 后台任务判断
  - 浏览器相关的强制 agent 兜底
  - `[[CELCAT_AGENT ...]]` / `[[CELCAT_TOOL ...]]` 文本协议解析
  - `AgentIntentRouter` 失败时的本地回退

## Initial Change

- 已完成首轮降级改动：
  - `AgentIntentRouter` 先判定
  - 本地 `shouldCreateBackgroundTask()` 不再是主路径
  - 只有当 router 返回 `null` 时，才回退到正则启发式

## Next Steps

1. 修复 `AgentIntentRouter` 对 GLM Coding API 的 `400`，让语音意图分流真正稳定可用。
2. 把 `shouldCreateBackgroundTask()` / `getTaskKind()` 的命中结果打到单独 debug 日志里，便于观察还有多少请求落在正则兜底。
3. 把“浏览器拒答强制改判”从正则兜底迁到结构化 tool-call / agent fallback。
4. 把 `[[CELCAT_AGENT ...]]` / `[[CELCAT_TOOL ...]]` 从文本协议逐步换成真正的结构化 function calling。
5. 让改名、浏览器、网页访问都尽量走同一条 agent / tool 判定链，而不是局部特判。

## Review Targets

- `src/main-process/orchestrator/conversationOrchestrator.ts`
- `src/main-process/agent/agentIntentRouter.ts`
- `src/main-process/realtime/voiceChatProvider.ts`
- `src/main-process/realtime/voiceChatToolExecutor.ts`
- `src/main-process/realtime/sessionManager.ts`
