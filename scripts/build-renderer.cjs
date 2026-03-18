const path = require('node:path');
const { buildSync } = require('esbuild');

function buildRendererBundle(projectRoot, distRoot) {
  buildSync({
    entryPoints: [path.join(projectRoot, 'src', 'renderer', 'renderer.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    outfile: path.join(distRoot, 'renderer', 'renderer.js'),
    legalComments: 'none',
    logLevel: 'silent',
  });
}

module.exports = {
  buildRendererBundle,
};
