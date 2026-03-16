const { spawn } = require('node:child_process');
const electronBinary = require('electron');
const { sanitizeElectronEnv } = require('./electron-runner-utils.cjs');

function spawnElectronProcess(projectRoot, extraArgs = []) {
  return spawn(electronBinary, ['.', ...extraArgs], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: sanitizeElectronEnv(process.env),
  });
}

module.exports = {
  spawnElectronProcess,
};
