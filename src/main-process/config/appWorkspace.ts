import path from 'node:path';

type AppLike = {
  isPackaged?: boolean;
  getPath(name: string): string;
};

function usesWindowsPaths(candidate: string | undefined): boolean {
  return Boolean(candidate && /^[A-Za-z]:[\\/]/.test(candidate));
}

export function resolveAppWorkspaceRoot(
  appLike: AppLike,
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): string {
  const explicitWorkspaceDir = env.CELCAT_WORKSPACE_DIR?.trim();
  if (explicitWorkspaceDir) {
    return (usesWindowsPaths(explicitWorkspaceDir) ? path.win32 : path).resolve(explicitWorkspaceDir);
  }

  if (!appLike.isPackaged) {
    return (usesWindowsPaths(cwd) ? path.win32 : path).join(cwd, 'agentWorkspace');
  }

  const documentsPath = appLike.getPath('documents');
  return (usesWindowsPaths(documentsPath) ? path.win32 : path).join(documentsPath, 'CelCat', 'agentWorkspace');
}
