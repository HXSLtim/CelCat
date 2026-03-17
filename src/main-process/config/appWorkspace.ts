import path from 'node:path';

type AppLike = {
  isPackaged?: boolean;
  getPath(name: string): string;
};

export function resolveAppWorkspaceRoot(
  appLike: AppLike,
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): string {
  const explicitWorkspaceDir = env.CELCAT_WORKSPACE_DIR?.trim();
  if (explicitWorkspaceDir) {
    return path.resolve(explicitWorkspaceDir);
  }

  if (!appLike.isPackaged) {
    return path.join(cwd, 'agentWorkspace');
  }

  return path.join(appLike.getPath('documents'), 'CelCat', 'agentWorkspace');
}
