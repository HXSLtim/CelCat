const TRUTHY_DEBUG_VALUES = new Set(['1', 'true', 'yes', 'on', 'debug']);
let consolePipeBroken = false;

function readProcessEnv(): Record<string, string | undefined> {
  if (typeof process === 'undefined' || !process.env) {
    return {};
  }

  return process.env as Record<string, string | undefined>;
}

function readProcessArgv(): string[] {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) {
    return [];
  }

  return process.argv;
}

function readGlobalDebugFlag(): boolean {
  const globalWithDebugFlag = globalThis as typeof globalThis & {
    __CELCAT_DEBUG__?: unknown;
  };

  return globalWithDebugFlag.__CELCAT_DEBUG__ === true;
}

export function isDebugLoggingEnabled(
  env: Record<string, string | undefined> = readProcessEnv(),
  argv: string[] = readProcessArgv(),
): boolean {
  const rawValue = env.CELCAT_DEBUG_LOGS ?? env.DEBUG ?? '';
  if (TRUTHY_DEBUG_VALUES.has(rawValue.trim().toLowerCase())) {
    return true;
  }

  if (env.NODE_ENV === 'development') {
    return true;
  }

  if (argv.includes('--dev')) {
    return true;
  }

  return readGlobalDebugFlag();
}

export function truncateDebugText(text: string, maxLength = 120): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function formatDebugMeta(meta: unknown): string {
  if (typeof meta === 'string') {
    return meta;
  }

  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

function isBrokenConsolePipeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: string;
    errno?: number;
    message?: string;
  };

  return candidate.code === 'EPIPE'
    || candidate.code === 'ERR_STREAM_DESTROYED'
    || candidate.errno === -4047
    || Boolean(candidate.message && /broken pipe|stream.*destroyed/i.test(candidate.message));
}

function safeConsoleWrite(method: 'log' | 'error' | 'warn', message: string, meta?: unknown): void {
  if (consolePipeBroken) {
    return;
  }

  try {
    if (meta === undefined) {
      console[method](message);
      return;
    }

    console[method](message, meta);
  } catch (error) {
    if (isBrokenConsolePipeError(error)) {
      consolePipeBroken = true;
      return;
    }

    throw error;
  }
}

export function safeConsoleLog(message: string, meta?: unknown): void {
  safeConsoleWrite('log', message, meta);
}

export function safeConsoleError(message: string, meta?: unknown): void {
  safeConsoleWrite('error', message, meta);
}

export function logDebug(scope: string, message: string, meta?: unknown): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  const suffix = meta === undefined ? '' : ` ${formatDebugMeta(meta)}`;
  safeConsoleLog(`[celcat:${scope}] ${message}${suffix}`);
}
