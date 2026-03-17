import fs from 'node:fs';
import path from 'node:path';

type LoadedEnvFile = {
  path: string;
  keys: string[];
};

export function loadProjectEnvFiles(
  projectRoot: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): LoadedEnvFile[] {
  const candidates = ['.env.local', '.env'];
  const loadedFiles: LoadedEnvFile[] = [];

  for (const candidate of candidates) {
    const filePath = path.join(projectRoot, candidate);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsedEntries = parseDotEnv(raw);
    const loadedKeys: string[] = [];

    for (const [key, value] of Object.entries(parsedEntries)) {
      if (typeof env[key] === 'string' && env[key]?.length) {
        continue;
      }

      env[key] = value;
      loadedKeys.push(key);
    }

    loadedFiles.push({
      path: filePath,
      keys: loadedKeys,
    });
  }

  return loadedFiles;
}

export function parseDotEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value.replace(/\\n/g, '\n');
  }

  return result;
}
