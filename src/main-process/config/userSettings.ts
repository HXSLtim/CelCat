import fs from 'node:fs';
import path from 'node:path';
import type { UserSettings } from '../../types/settings';

const DEFAULT_SETTINGS: UserSettings = {
  autoExecute: false,
};

export class UserSettingsStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'celcat-settings.json');
  }

  get(): UserSettings {
    try {
      if (!fs.existsSync(this.filePath)) {
        return DEFAULT_SETTINGS;
      }

      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<UserSettings>;

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  update(nextSettings: Partial<UserSettings>): UserSettings {
    const merged = {
      ...this.get(),
      ...nextSettings,
    };

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  }
}
