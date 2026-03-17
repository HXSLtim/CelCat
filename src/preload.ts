import { contextBridge, ipcRenderer } from 'electron';
import type { SessionEvent, SessionSnapshot, StreamingAudioFrame, UserAudioPayload } from './types/session';
import type { UserSettings } from './types/settings';
import type { AgentCapabilityCatalogEntry, TaskRecord } from './types/tasks';
import type { WindowStateEvent, WindowStateSnapshot } from './types/windowState';

function subscribe<EventPayload>(
  channel: 'session:event' | 'task:event' | 'window:event',
  listener: (payload: EventPayload) => void,
): () => void {
  const wrappedListener = (_event: Electron.IpcRendererEvent, payload: EventPayload) => {
    listener(payload);
  };

  ipcRenderer.on(channel, wrappedListener);
  return () => {
    ipcRenderer.off(channel, wrappedListener);
  };
}

const electronApi = {
  windowDrag: {
    getPosition(): Promise<[number, number]> {
      return ipcRenderer.invoke('window-drag:get-position');
    },
    setPosition(nextX: number, nextY: number): void {
      ipcRenderer.send('window-drag:set-position', nextX, nextY);
    },
  },
  windowState: {
    get(): Promise<WindowStateSnapshot> {
      return ipcRenderer.invoke('window-state:get');
    },
    setFullscreen(nextIsFullscreen: boolean): Promise<WindowStateSnapshot> {
      return ipcRenderer.invoke('window-state:set-fullscreen', nextIsFullscreen);
    },
    toggleFullscreen(): Promise<WindowStateSnapshot> {
      return ipcRenderer.invoke('window-state:toggle-fullscreen');
    },
    onChange(listener: (event: WindowStateEvent) => void): () => void {
      return subscribe('window:event', listener);
    },
  },
  session: {
    start(): Promise<SessionSnapshot> {
      return ipcRenderer.invoke('session:start');
    },
    stop(): Promise<SessionSnapshot> {
      return ipcRenderer.invoke('session:stop');
    },
    submitUserAudio(payload: UserAudioPayload): Promise<void> {
      return ipcRenderer.invoke('session:submit-user-audio', payload);
    },
    submitUserTranscript(transcript: string): Promise<void> {
      return ipcRenderer.invoke('session:submit-user-transcript', transcript);
    },
    appendInputAudioFrame(frame: StreamingAudioFrame): Promise<void> {
      return ipcRenderer.invoke('session:append-input-audio-frame', frame);
    },
    commitInputAudio(): Promise<void> {
      return ipcRenderer.invoke('session:commit-input-audio');
    },
    onEvent(listener: (event: SessionEvent) => void): () => void {
      return subscribe('session:event', listener);
    },
  },
  tasks: {
    list(): Promise<TaskRecord[]> {
      return ipcRenderer.invoke('task:list');
    },
    get(taskId: string): Promise<TaskRecord | null> {
      return ipcRenderer.invoke('task:get', taskId);
    },
    cancel(taskId: string): Promise<TaskRecord | null> {
      return ipcRenderer.invoke('task:cancel', taskId);
    },
    approve(taskId: string): Promise<TaskRecord | null> {
      return ipcRenderer.invoke('task:approve', taskId);
    },
    onUpdate(listener: (task: TaskRecord) => void): () => void {
      return subscribe('task:event', listener);
    },
  },
  agentCapabilities: {
    list(): Promise<AgentCapabilityCatalogEntry[]> {
      return ipcRenderer.invoke('agent-capabilities:list');
    },
  },
  settings: {
    get(): Promise<UserSettings> {
      return ipcRenderer.invoke('settings:get');
    },
    update(nextSettings: Partial<UserSettings>): Promise<UserSettings> {
      return ipcRenderer.invoke('settings:update', nextSettings);
    },
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', electronApi);
} else {
  (window as typeof window & { electronAPI: typeof electronApi }).electronAPI = electronApi;
}
