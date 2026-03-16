const path = require('node:path');
const { spawnElectronProcess } = require('./electron-process.cjs');

const child = spawnElectronProcess(
  path.resolve(__dirname, '..'),
  process.argv.slice(2),
);

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
