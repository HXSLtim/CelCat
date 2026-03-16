const { spawn } = require('node:child_process');
const electronBinary = require('electron');
const { sanitizeElectronEnv } = require('./electron-runner-utils.cjs');

const child = spawn(electronBinary, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: sanitizeElectronEnv(process.env),
});

child.on('error', (error) => {
  console.error('Failed to start Electron:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
