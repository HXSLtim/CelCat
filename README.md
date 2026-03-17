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

## Packaging

```bash
npm run dist:win
```

- Installer output: `release/`
- Installer type: NSIS (`setup.exe`)

## Architecture

- **Main Process**: Window management, system tray
- **Renderer Process**: Live2D display, user interactions
- **Live2D Manager**: Model loading and animation

## Future Enhancements

- Real Live2D model integration
- AI conversation system
- Voice recognition
- System integration features
