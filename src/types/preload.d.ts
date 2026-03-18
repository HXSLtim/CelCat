import type { SessionEvent, SessionSnapshot, StreamingAudioFrame, UserAudioPayload } from './session';
import type { UserSettings } from './settings';
import type { AgentCapabilityCatalogEntry, TaskRecord } from './tasks';
import type { WindowStateEvent, WindowStateSnapshot } from './windowState';

type Unsubscribe = () => void;

type ElectronApi = {
  runtime: {
    isDev: boolean;
  };
  windowDrag: {
    getPosition(): Promise<[number, number]>;
    setPosition(nextX: number, nextY: number): void;
  };
  windowState: {
    get(): Promise<WindowStateSnapshot>;
    setFullscreen(nextIsFullscreen: boolean): Promise<WindowStateSnapshot>;
    toggleFullscreen(): Promise<WindowStateSnapshot>;
    onChange(listener: (event: WindowStateEvent) => void): Unsubscribe;
  };
  session: {
    start(): Promise<SessionSnapshot>;
    stop(): Promise<SessionSnapshot>;
    submitUserAudio(payload: UserAudioPayload): Promise<void>;
    submitUserTranscript(transcript: string): Promise<void>;
    appendInputAudioFrame(frame: StreamingAudioFrame): Promise<void>;
    commitInputAudio(): Promise<void>;
    onEvent(listener: (event: SessionEvent) => void): Unsubscribe;
  };
  tasks: {
    list(): Promise<TaskRecord[]>;
    get(taskId: string): Promise<TaskRecord | null>;
    cancel(taskId: string): Promise<TaskRecord | null>;
    approve(taskId: string): Promise<TaskRecord | null>;
    onUpdate(listener: (task: TaskRecord) => void): Unsubscribe;
  };
  agentCapabilities: {
    list(): Promise<AgentCapabilityCatalogEntry[]>;
  };
  settings: {
    get(): Promise<UserSettings>;
    update(nextSettings: Partial<UserSettings>): Promise<UserSettings>;
  };
  controlPanel: {
    getUrl(): Promise<string | null>;
    open(): Promise<string | null>;
  };
};

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}

export {};
