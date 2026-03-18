const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { getStaticCopyPlan } = require('./build-utils.cjs');
const { buildRendererBundle } = require('./build-renderer.cjs');

const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');

function runTypeScriptBuild() {
  const tscEntrypoint = path.join(
    projectRoot,
    'node_modules',
    'typescript',
    'bin',
    'tsc',
  );

  execFileSync(process.execPath, [tscEntrypoint], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}

function copyStaticAssets() {
  for (const entry of getStaticCopyPlan(projectRoot, distRoot)) {
    if (!fs.existsSync(entry.from)) {
      continue;
    }

    fs.mkdirSync(path.dirname(entry.to), { recursive: true });
    fs.cpSync(entry.from, entry.to, { recursive: true });
  }
}

fs.rmSync(distRoot, { recursive: true, force: true });
runTypeScriptBuild();
buildRendererBundle(projectRoot, distRoot);
copyStaticAssets();
