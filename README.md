# Live2D Desktop Companion

A desktop AI companion built with Electron and Live2D Web SDK.

## Features

- Transparent desktop window
- Live2D character display
- Basic interactions (click response)
- System tray integration
- Draggable window

## Development

```bash
npm install
npm start
```

## Workspace

- Development mode stores the agent workspace in `./agentWorkspace`.
- You can override it with `CELCAT_WORKSPACE_DIR`.
- Packaged installs fall back to `Documents/CelCat/agentWorkspace` unless overridden.

## Agentic Capability Discovery

- Local skills can be discovered automatically from the default Codex and Agents skill directories.
- You can override skill scan roots with `CELCAT_SKILL_DIRS`.
- External MCP servers can be injected with `CELCAT_MCP_SERVERS_JSON` or `CELCAT_MCP_CONFIG_PATH`.

## Packaging

```bash
npm run dist:win
```

- Installer output: `release/`
- Installer type: NSIS (`setup.exe`)

## Realtime Provider Modes

- `VOLCENGINE_REALTIME_PROVIDER_MODE=dialogue`
  Current legacy `openspeech realtime dialogue` transport.
- `VOLCENGINE_REALTIME_PROVIDER_MODE=voiceChat`
  Official-route migration mode. The current implementation keeps a compatibility transport while the app is being moved toward `StartVoiceChat + Function Calling + MCP + Memory`.

See [docs/volcengineVoiceChatMigration.md](/C:/Users/a2778/Desktop/Code/CelCat/docs/volcengineVoiceChatMigration.md) for the migration plan.

## Architecture

- **Main Process**: Window management, system tray
- **Renderer Process**: Live2D display, user interactions
- **Live2D Manager**: Model loading and animation

## Future Enhancements

- Real Live2D model integration
- AI conversation system
- Voice recognition
- System integration features
