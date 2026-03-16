# Live2D Desktop Companion Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Live2D desktop AI companion with transparent window, basic interactions, and extensible architecture

**Architecture:** Electron app with transparent window, Live2D Web SDK integration, event-driven interaction system

**Tech Stack:** Electron, Live2D Web SDK, HTML5 Canvas, Node.js

---

## File Structure

```
src/
├── main.js              # Electron main process
├── preload.js           # Preload script for security
├── renderer/
│   ├── index.html       # Main window HTML
│   ├── renderer.js      # Renderer process logic
│   ├── live2d/
│   │   ├── live2d.js    # Live2D integration
│   │   └── model.js     # Model management
│   └── styles/
│       └── main.css     # Window styling
├── assets/
│   └── models/          # Live2D model files
└── package.json         # Dependencies and scripts
```

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `src/main.js`
- Create: `src/preload.js`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "live2d-desktop-companion",
  "version": "1.0.0",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev"
  },
  "devDependencies": {
    "electron": "^28.0.0"
  },
  "dependencies": {
    "pixi.js": "^7.3.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: Dependencies installed successfully

- [ ] **Step 3: Create main process**

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 300,
    height: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('src/renderer/index.html');
  mainWindow.setIgnoreMouseEvents(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 4: Create preload script**

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Future API methods will go here
});
```

- [ ] **Step 5: Test basic window**

Run: `npm start`
Expected: Transparent window appears

- [ ] **Step 6: Commit setup**

```bash
git init
git add package.json src/main.js src/preload.js
git commit -m "feat: initial Electron setup with transparent window"
```

### Task 2: HTML Structure and Styling

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/styles/main.css`

- [ ] **Step 1: Create HTML structure**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Live2D Companion</title>
  <link rel="stylesheet" href="styles/main.css">
</head>
<body>
  <div id="app">
    <canvas id="live2d-canvas"></canvas>
    <div id="controls" class="hidden">
      <button id="close-btn">×</button>
    </div>
  </div>
  <script src="https://pixijs.download/release/pixi.min.js"></script>
  <script src="renderer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create CSS styling**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: transparent;
  overflow: hidden;
  -webkit-app-region: drag;
  user-select: none;
}

#app {
  width: 100vw;
  height: 100vh;
  position: relative;
}

#live2d-canvas {
  width: 100%;
  height: 100%;
  -webkit-app-region: no-drag;
}

#controls {
  position: absolute;
  top: 10px;
  right: 10px;
  -webkit-app-region: no-drag;
}

#controls.hidden {
  display: none;
}

#close-btn {
  background: rgba(255, 255, 255, 0.8);
  border: none;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  cursor: pointer;
  font-size: 16px;
}

#close-btn:hover {
  background: rgba(255, 255, 255, 1);
}
```

- [ ] **Step 3: Test HTML structure**

Run: `npm start`
Expected: Canvas element visible in transparent window

- [ ] **Step 4: Commit HTML/CSS**

```bash
git add src/renderer/
git commit -m "feat: add HTML structure and CSS styling"
```

### Task 3: Live2D Integration

**Files:**
- Create: `src/renderer/renderer.js`
- Create: `src/renderer/live2d/live2d.js`
- Create: `src/assets/models/` (directory)

- [ ] **Step 1: Create renderer entry point**

```javascript
class DesktopCompanion {
  constructor() {
    this.app = null;
    this.live2d = null;
    this.init();
  }

  async init() {
    await this.setupPixi();
    await this.setupLive2D();
    this.setupEvents();
  }

  async setupPixi() {
    this.app = new PIXI.Application({
      view: document.getElementById('live2d-canvas'),
      transparent: true,
      width: 300,
      height: 400
    });
  }

  async setupLive2D() {
    const { Live2DManager } = await import('./live2d/live2d.js');
    this.live2d = new Live2DManager(this.app);
    await this.live2d.loadModel();
  }

  setupEvents() {
    // Show controls on hover
    document.body.addEventListener('mouseenter', () => {
      document.getElementById('controls').classList.remove('hidden');
    });

    document.body.addEventListener('mouseleave', () => {
      document.getElementById('controls').classList.add('hidden');
    });

    // Close button
    document.getElementById('close-btn').addEventListener('click', () => {
      window.close();
    });
  }
}

new DesktopCompanion();
```

- [ ] **Step 2: Create Live2D manager**

```javascript
export class Live2DManager {
  constructor(app) {
    this.app = app;
    this.model = null;
  }

  async loadModel() {
    // For now, create a simple placeholder
    const graphics = new PIXI.Graphics();
    graphics.beginFill(0x66CCFF);
    graphics.drawCircle(150, 200, 50);
    graphics.endFill();

    // Add simple eyes
    graphics.beginFill(0x000000);
    graphics.drawCircle(135, 190, 8);
    graphics.drawCircle(165, 190, 8);
    graphics.endFill();

    // Add simple mouth
    graphics.lineStyle(3, 0x000000);
    graphics.arc(150, 210, 15, 0, Math.PI);

    this.model = graphics;
    this.app.stage.addChild(this.model);

    // Simple animation
    this.animate();
  }

  animate() {
    let time = 0;
    this.app.ticker.add(() => {
      time += 0.05;
      if (this.model) {
        this.model.y = Math.sin(time) * 5 + 200;
      }
    });
  }
}
```

- [ ] **Step 3: Test Live2D placeholder**

Run: `npm start`
Expected: Animated blue circle with face appears

- [ ] **Step 4: Commit Live2D integration**

```bash
git add src/renderer/renderer.js src/renderer/live2d/
git commit -m "feat: add Live2D manager with placeholder model"
```

### Task 4: Basic Interactions

**Files:**
- Modify: `src/renderer/renderer.js`
- Modify: `src/renderer/live2d/live2d.js`

- [ ] **Step 1: Add click interaction**

```javascript
// Add to DesktopCompanion.setupEvents()
this.app.stage.interactive = true;
this.app.stage.on('pointerdown', (event) => {
  this.live2d.onTouch(event.data.global);
});
```

- [ ] **Step 2: Add touch response to Live2D manager**

```javascript
// Add to Live2DManager class
onTouch(position) {
  if (this.model) {
    // Simple touch response - scale animation
    const originalScale = this.model.scale.x;
    this.model.scale.set(originalScale * 1.2);

    setTimeout(() => {
      this.model.scale.set(originalScale);
    }, 200);
  }
}
```

- [ ] **Step 3: Test interactions**

Run: `npm start`
Expected: Model responds to clicks with scale animation

- [ ] **Step 4: Commit interactions**

```bash
git add src/renderer/renderer.js src/renderer/live2d/live2d.js
git commit -m "feat: add basic click interactions"
```

### Task 5: System Tray Integration

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Add tray functionality**

```javascript
const { app, BrowserWindow, Tray, Menu } = require('electron');

let tray = null;

// Add after createWindow function
function createTray() {
  // Create a simple tray icon (you can replace with actual icon)
  tray = new Tray(nativeImage.createEmpty());

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { label: 'Hide', click: () => mainWindow.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.setToolTip('Live2D Desktop Companion');
  tray.setContextMenu(contextMenu);
}

// Modify app.whenReady()
app.whenReady().then(() => {
  createWindow();
  createTray();
});
```

- [ ] **Step 2: Test tray functionality**

Run: `npm start`
Expected: System tray icon appears with context menu

- [ ] **Step 3: Commit tray integration**

```bash
git add src/main.js
git commit -m "feat: add system tray integration"
```

### Task 6: Documentation and Final Setup

**Files:**
- Create: `README.md`
- Create: `.gitignore`

- [ ] **Step 1: Create README**

```markdown
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

## Architecture

- **Main Process**: Window management, system tray
- **Renderer Process**: Live2D display, user interactions
- **Live2D Manager**: Model loading and animation

## Future Enhancements

- Real Live2D model integration
- AI conversation system
- Voice recognition
- System integration features
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 3: Final commit**

```bash
git add README.md .gitignore
git commit -m "docs: add README and gitignore"
```

## Review Loop

This plan creates a minimal but functional Live2D desktop companion framework. The review loop may be unnecessary for this straightforward implementation. Want me to proceed without the review loop?