const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');

let mainWindow: Electron.BrowserWindow | null;
let tray: Electron.Tray | null = null;

function createWindow(): void {
  const isDev = process.argv.includes('--dev');

  mainWindow = new BrowserWindow({
    width: 300,
    height: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow!.loadFile(path.join(__dirname, 'renderer/index.html'));

  if (isDev) {
    mainWindow!.webContents.on('did-finish-load', () => {
      console.log('Renderer finished loading.');
    });
    mainWindow!.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Renderer failed to load:', { errorCode, errorDescription, validatedURL });
    });
    mainWindow!.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow!.webContents.openDevTools();
  }
  mainWindow!.setIgnoreMouseEvents(false);
}

function createTray(): void {
  tray = new Tray(nativeImage.createEmpty());

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray!.setToolTip('Live2D Desktop Companion');
  tray!.setContextMenu(contextMenu);
}

ipcMain.handle('window-drag:get-position', () => {
  return mainWindow?.getPosition() ?? [0, 0];
});

ipcMain.on('window-drag:set-position', (_event: Electron.IpcMainEvent, nextX: number, nextY: number) => {
  if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
    return;
  }

  mainWindow?.setPosition(Math.round(nextX), Math.round(nextY));
});

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
