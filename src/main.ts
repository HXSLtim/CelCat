const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session } = require('electron');
const path = require('path');
import type { SessionEvent } from './types/session';
import type { TaskRecord } from './types/tasks';
const {
  shouldGrantPermissionCheck,
  shouldGrantPermissionRequest,
} = require('./main-process/permissions');
const { transcribeAudioWithOpenAi } = require('./main-process/openaiTranscription');
const { loadProjectEnvFiles } = require('./main-process/config/envLoader');
const { InMemoryTaskStore } = require('./main-process/tasks/taskStore');
const { TaskRunner } = require('./main-process/tasks/taskRunner');
const { UserSettingsStore } = require('./main-process/config/userSettings');
const { ConversationOrchestrator } = require('./main-process/orchestrator/conversationOrchestrator');
const { SessionManager } = require('./main-process/realtime/sessionManager');
const { VolcengineRealtimeProviderClient } = require('./main-process/realtime/providerClient');
const { isDebugLoggingEnabled, logDebug, safeConsoleError, safeConsoleLog } = require('./shared/debugLogger');

let mainWindow: Electron.BrowserWindow | null;
let tray: Electron.Tray | null = null;
let taskStore: InstanceType<typeof InMemoryTaskStore> | null = null;
let taskRunner: InstanceType<typeof TaskRunner> | null = null;
let settingsStore: InstanceType<typeof UserSettingsStore> | null = null;
let orchestrator: InstanceType<typeof ConversationOrchestrator> | null = null;
let sessionManager: InstanceType<typeof SessionManager> | null = null;
let companionProvider: InstanceType<typeof VolcengineRealtimeProviderClient> | null = null;

function createWindow(): void {
  const isDev = process.argv.includes('--dev');
  const debugLoggingEnabled = isDebugLoggingEnabled();
  const shouldMirrorRendererLogs = isDev || debugLoggingEnabled;

  mainWindow = new BrowserWindow({
    width: 300,
    height: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow!.loadFile(path.join(__dirname, 'renderer/index.html'));

  if (shouldMirrorRendererLogs) {
    mainWindow!.webContents.on('did-finish-load', () => {
      safeConsoleLog('Renderer finished loading.');
    });
    mainWindow!.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      safeConsoleError('Renderer failed to load:', { errorCode, errorDescription, validatedURL });
    });
    mainWindow!.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      safeConsoleLog(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }

  if (isDev) {
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

ipcMain.handle('session:start', async () => {
  return sessionManager?.startSession() ?? null;
});

ipcMain.handle('session:stop', async () => {
  return sessionManager?.stopSession() ?? null;
});

ipcMain.handle('session:submit-user-audio', async (_event: Electron.IpcMainInvokeEvent, payload: {
  audioBuffer: ArrayBuffer;
  mimeType: string;
}) => {
  await sessionManager?.submitUserAudio(payload);
});

ipcMain.handle('session:submit-user-transcript', async (_event: Electron.IpcMainInvokeEvent, transcript: string) => {
  await sessionManager?.submitUserTranscript(transcript);
});

ipcMain.handle('session:append-input-audio-frame', async (_event: Electron.IpcMainInvokeEvent, frame: {
  pcmBase64: string;
  sampleRate: number;
  channels: number;
}) => {
  await sessionManager?.appendInputAudioFrame(frame);
});

ipcMain.handle('session:commit-input-audio', async () => {
  await sessionManager?.commitInputAudio();
});

ipcMain.handle('task:list', () => {
  return taskStore?.list() ?? [];
});

ipcMain.handle('task:get', (_event: Electron.IpcMainInvokeEvent, taskId: string) => {
  return taskStore?.get(taskId) ?? null;
});

ipcMain.handle('task:cancel', (_event: Electron.IpcMainInvokeEvent, taskId: string) => {
  return taskRunner?.cancelTask(taskId) ?? null;
});

ipcMain.handle('settings:get', () => {
  return settingsStore?.get() ?? { autoExecute: false };
});

ipcMain.handle('settings:update', (_event: Electron.IpcMainInvokeEvent, nextSettings: {
  autoExecute?: boolean;
}) => {
  return settingsStore?.update(nextSettings) ?? { autoExecute: false };
});

app.whenReady().then(() => {
  const loadedEnvFiles = loadProjectEnvFiles(process.cwd(), process.env);
  logDebug('main', 'Loaded project env files', {
    files: loadedEnvFiles.map((entry: { path: string; keys: string[] }) => ({
      path: entry.path,
      keyCount: entry.keys.length,
    })),
  });
  if (process.env.VOLCENGINE_APP_KEY) {
    logDebug('main', 'Ignoring VOLCENGINE_APP_KEY from env; realtime protocol uses a fixed app key');
  }
  logDebug('main', 'Application bootstrapping');
  taskStore = new InMemoryTaskStore();
  taskRunner = new TaskRunner(taskStore);
  settingsStore = new UserSettingsStore(app.getPath('userData'));
  orchestrator = new ConversationOrchestrator(taskStore, taskRunner, settingsStore);
  companionProvider = new VolcengineRealtimeProviderClient();
  sessionManager = new SessionManager({
    transcribeAudio: transcribeAudioWithOpenAi,
    orchestrator,
    companionProvider,
    emitEvent: (event: SessionEvent) => {
      logDebug('main', 'Forwarding session event to renderer', {
        type: event.type,
      });
      mainWindow?.webContents.send('session:event', event);
    },
  });
  taskStore.onUpdated((task: TaskRecord) => {
    logDebug('main', 'Forwarding task update to renderer', {
      taskId: task.id,
      status: task.status,
    });
    mainWindow?.webContents.send('task:event', task);
  });

  session.defaultSession.setPermissionCheckHandler((
    _webContents: Electron.WebContents | null,
    permission: string,
    _requestingOrigin: string,
    details: Electron.PermissionCheckHandlerHandlerDetails,
  ) => {
    return shouldGrantPermissionCheck(permission, details);
  });
  session.defaultSession.setPermissionRequestHandler((
    _webContents: Electron.WebContents,
    permission: string,
    callback: (permissionGranted: boolean) => void,
    details: Electron.PermissionRequestHandlerHandlerDetails,
  ) => {
    callback(shouldGrantPermissionRequest(permission, details));
  });
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
