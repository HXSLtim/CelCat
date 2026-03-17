# Volcengine VoiceChat Migration

## Target

- 从当前 `openspeech realtime dialogue` 兼容链路迁移到更接近官方 `StartVoiceChat + Function Calling + MCP + Memory` 的架构。
- 保留现有桌宠 UI、工作区、记忆系统和后台 agent 执行能力。

## Why

- 旧链路更偏底层实时对话，agent/改名/浏览器调用主要依赖本地注入与兜底。
- 官方方案更适合“语音模型先判断，再触发工具 / agent / MCP”。

## Current Migration Status

### Phase 1

- 已加入 provider 模式切换：
  - `dialogue`
  - `voiceChat`
- 已加入 VoiceChat 工具注册表：
  - `startAgentTask`
  - `renameCompanion`
  - `openBrowser`
- 已加入 `VolcengineVoiceChatProviderClient` 兼容 provider。
  - 当前仍复用旧 transport，先把上层架构和工具定义稳定下来。

### Phase 2

- 将兼容 provider 替换为官方 `StartVoiceChat` transport。
- 接入官方 Function Calling 事件，直接驱动：
  - agent 任务创建
  - 浏览器 / 网页操作
  - companion 身份更新
- 当前已补齐 `StartVoiceChat-compatible session blueprint`：
  - companion identity
  - local memory summary
  - tool definitions
  - MCP capability summary
  - active task context
- 当前 `sessionManager` 已支持结构化 `tool-call` 事件，不再只依赖文本内联解析。

### Phase 3

- 接入官方短期上下文与长期记忆。
- 让本地记忆系统和官方记忆层协同工作，而不是只靠 prompt 注入。

## Env

- `VOLCENGINE_REALTIME_PROVIDER_MODE=dialogue|voiceChat`

## Notes

- 当前 `voiceChat` 模式是迁移兼容层，不等于已经完全切换到官方 StartVoiceChat transport。
- 现有本地 AI 路由、provider 回复缓冲和身份同步逻辑继续保留，作为迁移期兜底。
- 当前已拆出独立 `voiceChat transport` 配置层：
  - `VOLCENGINE_VOICECHAT_*` 专属环境变量
  - 独立 `VolcengineVoiceChatTransportClient`
  - 与 `dialogue` provider 分离的底层装配
- 当前 transport 仍是 `dialogue-compatible transport shim`。
  - 这是一个中间态：上层 session / tool-call / memory blueprint 已按 `StartVoiceChat` 组织，
    下一步只需替换 transport 的真实握手与事件协议。
