const path = require('node:path');

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function shouldHandleWatchPath(filePath) {
  const normalizedPath = normalizePath(filePath).replace(/^\.\//, '');

  if (!normalizedPath) {
    return false;
  }

  if (
    normalizedPath.startsWith('dist/') ||
    normalizedPath.startsWith('node_modules/') ||
    normalizedPath.startsWith('.git/')
  ) {
    return false;
  }

  if (normalizedPath === 'package.json' || normalizedPath === 'tsconfig.json') {
    return true;
  }

  return normalizedPath.startsWith('src/') || normalizedPath.startsWith('scripts/');
}

module.exports = {
  shouldHandleWatchPath,
};
