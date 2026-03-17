import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { logDebug } from '../../shared/debugLogger';
import type { SessionSnapshot } from '../../types/session';
import type { AgentCapabilityCatalogEntry, TaskRecord } from '../../types/tasks';
import type { UserSettings } from '../../types/settings';

type ControlPanelServerDependencies = {
  staticRoot: string;
  taskStore: {
    list(): TaskRecord[];
    get(taskId: string): TaskRecord | null;
    getLatestActive(): TaskRecord | null;
  };
  getSessionSnapshot(): SessionSnapshot | null;
  getSettings(): UserSettings;
  getCapabilities(): AgentCapabilityCatalogEntry[];
  approveTask(taskId: string): TaskRecord | null;
  cancelTask(taskId: string): TaskRecord | null;
  host?: string;
  port?: number;
};

type ControlPanelStatePayload = {
  generatedAt: string;
  session: SessionSnapshot | null;
  latestTask: TaskRecord | null;
  tasks: TaskRecord[];
  settings: UserSettings;
  capabilities: AgentCapabilityCatalogEntry[];
  controlPanelUrl: string | null;
};

const DEFAULT_CONTROL_PANEL_HOST = '127.0.0.1';
const DEFAULT_CONTROL_PANEL_PORT = 47831;

export class ControlPanelServer {
  private server: http.Server | null = null;
  private listenPromise: Promise<string> | null = null;
  private resolvedUrl: string | null = null;

  constructor(private readonly dependencies: ControlPanelServerDependencies) {}

  async start(): Promise<string> {
    if (this.resolvedUrl) {
      return this.resolvedUrl;
    }

    if (this.listenPromise) {
      return this.listenPromise;
    }

    this.listenPromise = this.listenWithFallback();
    try {
      this.resolvedUrl = await this.listenPromise;
      return this.resolvedUrl;
    } finally {
      this.listenPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.resolvedUrl = null;
      return;
    }

    const server = this.server;
    this.server = null;
    this.resolvedUrl = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  getUrl(): string | null {
    return this.resolvedUrl;
  }

  private async listenWithFallback(): Promise<string> {
    const host = this.dependencies.host || DEFAULT_CONTROL_PANEL_HOST;
    const requestedPort = Number.isFinite(this.dependencies.port)
      ? this.dependencies.port!
      : DEFAULT_CONTROL_PANEL_PORT;

    try {
      return await this.listen(host, requestedPort);
    } catch (error: any) {
      if (error?.code !== 'EADDRINUSE' || requestedPort === 0) {
        throw error;
      }

      logDebug('main', 'Control panel port is already in use; falling back to a random localhost port', {
        requestedPort,
      });
      return this.listen(host, 0);
    }
  }

  private async listen(host: string, port: number): Promise<string> {
    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    this.server = server;
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve control panel server address');
    }

    const url = `http://${host}:${address.port}`;
    logDebug('main', 'Control panel server started', {
      url,
      staticRoot: this.dependencies.staticRoot,
    });
    return url;
  }

  private async handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', this.resolvedUrl || 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);

    if (method === 'GET' && pathname === '/api/state') {
      this.sendJson(response, 200, this.buildStatePayload());
      return;
    }

    const taskActionMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/(approve|cancel)$/);
    if (method === 'POST' && taskActionMatch) {
      const taskId = taskActionMatch[1];
      const action = taskActionMatch[2];
      const task = action === 'approve'
        ? this.dependencies.approveTask(taskId)
        : this.dependencies.cancelTask(taskId);

      if (!task) {
        this.sendJson(response, 404, { error: 'Task not found' });
        return;
      }

      this.sendJson(response, 200, task);
      return;
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (method === 'GET' && taskMatch) {
      const task = this.dependencies.taskStore.get(taskMatch[1]);
      if (!task) {
        this.sendJson(response, 404, { error: 'Task not found' });
        return;
      }

      this.sendJson(response, 200, task);
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      this.sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const staticPath = this.resolveStaticPath(pathname);
    if (!staticPath) {
      this.sendJson(response, 404, { error: 'Not found' });
      return;
    }

    this.sendStaticFile(response, staticPath, method === 'HEAD');
  }

  private buildStatePayload(): ControlPanelStatePayload {
    return {
      generatedAt: new Date().toISOString(),
      session: this.dependencies.getSessionSnapshot(),
      latestTask: this.dependencies.taskStore.getLatestActive(),
      tasks: this.dependencies.taskStore.list(),
      settings: this.dependencies.getSettings(),
      capabilities: this.dependencies.getCapabilities(),
      controlPanelUrl: this.resolvedUrl,
    };
  }

  private resolveStaticPath(pathname: string): string | null {
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const normalizedPath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const candidate = path.join(this.dependencies.staticRoot, normalizedPath);
    const resolvedRoot = path.resolve(this.dependencies.staticRoot);
    const resolvedCandidate = path.resolve(candidate);

    if (!resolvedCandidate.startsWith(resolvedRoot)) {
      return null;
    }

    if (!fs.existsSync(resolvedCandidate) || fs.statSync(resolvedCandidate).isDirectory()) {
      return null;
    }

    return resolvedCandidate;
  }

  private sendStaticFile(response: http.ServerResponse, filePath: string, headOnly: boolean): void {
    const extension = path.extname(filePath).toLowerCase();
    const contentType = extension === '.html'
      ? 'text/html; charset=utf-8'
      : extension === '.css'
        ? 'text/css; charset=utf-8'
        : extension === '.js'
          ? 'application/javascript; charset=utf-8'
          : 'application/octet-stream';

    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });

    if (headOnly) {
      response.end();
      return;
    }

    fs.createReadStream(filePath).pipe(response);
  }

  private sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(payload));
  }
}
