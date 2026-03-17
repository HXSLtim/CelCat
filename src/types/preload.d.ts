import type { SessionEvent, SessionSnapshot, StreamingAudioFrame, UserAudioPayload } from './session';
import type { UserSettings } from './settings';
import type { TaskRecord } from './tasks';

type Unsubscribe = () => void;

type ElectronApi = {
  windowDrag: {
    getPosition(): Promise<[number, number]>;
    setPosition(nextX: number, nextY: number): void;
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
    onUpdate(listener: (task: TaskRecord) => void): Unsubscribe;
  };
  settings: {
    get(): Promise<UserSettings>;
    update(nextSettings: Partial<UserSettings>): Promise<UserSettings>;
  };
};

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}

export {};
