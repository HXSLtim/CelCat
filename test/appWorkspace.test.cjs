const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveAppWorkspaceRoot } = require('../dist/main-process/config/appWorkspace.js');

test('resolveAppWorkspaceRoot uses the current project directory while unpackaged', () => {
  const workspaceRoot = resolveAppWorkspaceRoot({
    isPackaged: false,
    getPath(name) {
      return `ignored-${name}`;
    },
  }, {}, 'C:\\repo\\CelCat');

  assert.equal(workspaceRoot, 'C:\\repo\\CelCat\\agentWorkspace');
});

test('resolveAppWorkspaceRoot honors CELCAT_WORKSPACE_DIR overrides', () => {
  const workspaceRoot = resolveAppWorkspaceRoot({
    isPackaged: true,
    getPath(name) {
      return `C:\\Users\\demo\\${name}`;
    },
  }, {
    CELCAT_WORKSPACE_DIR: 'C:\\custom\\workspace',
  }, 'C:\\repo\\CelCat');

  assert.equal(workspaceRoot, 'C:\\custom\\workspace');
});

test('resolveAppWorkspaceRoot falls back to Documents when packaged', () => {
  const workspaceRoot = resolveAppWorkspaceRoot({
    isPackaged: true,
    getPath(name) {
      return name === 'documents' ? 'C:\\Users\\demo\\Documents' : `C:\\Users\\demo\\${name}`;
    },
  }, {}, 'C:\\repo\\CelCat');

  assert.equal(workspaceRoot, 'C:\\Users\\demo\\Documents\\CelCat\\agentWorkspace');
});
