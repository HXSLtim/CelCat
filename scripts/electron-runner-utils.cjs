const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function sanitizeElectronEnv(env, platform = process.platform) {
  const nextEnv = { ...env };
  delete nextEnv.ELECTRON_RUN_AS_NODE;
  if (shouldDisableGpuForElectron(nextEnv, platform)) {
    nextEnv.CELCAT_DISABLE_GPU = '1';
  }
  return nextEnv;
}

function shouldDisableGpuForElectron(env = process.env, platform = process.platform) {
  const rawValue = String(env.CELCAT_DISABLE_GPU || '').trim().toLowerCase();
  if (TRUE_VALUES.has(rawValue)) {
    return true;
  }
  if (FALSE_VALUES.has(rawValue)) {
    return false;
  }

  return platform === 'linux';
}

function getElectronLaunchArgs(extraArgs = [], env = process.env, platform = process.platform) {
  const launchArgs = [...extraArgs];
  if (!shouldDisableGpuForElectron(env, platform)) {
    return launchArgs;
  }

  if (!launchArgs.includes('--disable-gpu')) {
    launchArgs.unshift('--disable-gpu');
  }
  if (!launchArgs.includes('--disable-gpu-compositing')) {
    launchArgs.unshift('--disable-gpu-compositing');
  }

  return launchArgs;
}

module.exports = {
  getElectronLaunchArgs,
  sanitizeElectronEnv,
  shouldDisableGpuForElectron,
};
