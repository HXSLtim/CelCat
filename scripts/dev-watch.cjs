const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { shouldHandleWatchPath } = require('./dev-watch-utils.cjs');
const { spawnElectronProcess } = require('./electron-process.cjs');

const projectRoot = path.resolve(__dirname, '..');
const buildScript = path.join(projectRoot, 'scripts', 'build.cjs');

let electronChild = null;
let isBuilding = false;
let restartAfterBuild = false;
let restartPending = false;
let debounceTimer = null;
let shuttingDown = false;

function runBuild() {
  execFileSync(process.execPath, [buildScript], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}

function launchElectron() {
  electronChild = spawnElectronProcess(projectRoot, ['--dev']);
  electronChild.on('exit', () => {
    electronChild = null;

    if (shuttingDown) {
      return;
    }

    if (restartPending) {
      restartPending = false;
      launchElectron();
    }
  });
}

function restartElectron() {
  if (!electronChild) {
    launchElectron();
    return;
  }

  restartPending = true;
  electronChild.kill();
}

function buildAndReload(reason) {
  if (isBuilding) {
    restartAfterBuild = true;
    return;
  }

  isBuilding = true;
  console.log(`\n[dev] rebuilding after change: ${reason}`);

  try {
    runBuild();
    restartElectron();
  } catch (error) {
    console.error('[dev] build failed, keeping current app instance.');
  } finally {
    isBuilding = false;

    if (restartAfterBuild) {
      restartAfterBuild = false;
      queueRebuild('queued change');
    }
  }
}

function queueRebuild(reason) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    buildAndReload(reason);
  }, 120);
}

function watchPath(targetPath) {
  const absolutePath = path.join(projectRoot, targetPath);
  const isDirectory = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();

  fs.watch(
    absolutePath,
    { recursive: isDirectory },
    (_eventType, fileName) => {
      const changedPath = fileName
        ? path.join(targetPath, fileName.toString())
        : targetPath;

      if (!shouldHandleWatchPath(changedPath)) {
        return;
      }

      queueRebuild(changedPath);
    },
  );
}

function shutdown() {
  shuttingDown = true;
  clearTimeout(debounceTimer);
  if (electronChild) {
    electronChild.kill();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

runBuild();
launchElectron();
watchPath('src');
watchPath('scripts');
watchPath('package.json');
watchPath('tsconfig.json');
