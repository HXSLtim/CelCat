const { spawn } = require('node:child_process');
const electronBinary = require('electron');
const { getElectronLaunchArgs, sanitizeElectronEnv } = require('./electron-runner-utils.cjs');

function spawnElectronProcess(projectRoot, extraArgs = []) {
  const sanitizedEnv = sanitizeElectronEnv(process.env);
  const launchArgs = getElectronLaunchArgs(['.', ...extraArgs], sanitizedEnv);
  return spawn(electronBinary, launchArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: sanitizedEnv,
  });
}

module.exports = {
  spawnElectronProcess,
};
