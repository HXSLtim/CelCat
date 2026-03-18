const path = require('node:path');

function getStaticCopyPlan(projectRoot, distRoot) {
  return [
    {
      from: path.join(projectRoot, 'src', 'renderer', 'index.html'),
      to: path.join(distRoot, 'renderer', 'index.html'),
    },
    {
      from: path.join(projectRoot, 'src', 'renderer', 'styles'),
      to: path.join(distRoot, 'renderer', 'styles'),
    },
    {
      from: path.join(projectRoot, 'src', 'renderer', 'bootstrap.js'),
      to: path.join(distRoot, 'renderer', 'bootstrap.js'),
    },
    {
      from: path.join(projectRoot, 'src', 'renderer', 'voice', 'audioFrameProcessor.js'),
      to: path.join(distRoot, 'renderer', 'voice', 'audioFrameProcessor.js'),
    },
    {
      from: path.join(projectRoot, 'src', 'renderer', 'vendor'),
      to: path.join(distRoot, 'renderer', 'vendor'),
    },
    {
      from: path.join(projectRoot, 'src', 'assets'),
      to: path.join(distRoot, 'assets'),
    },
    {
      from: path.join(projectRoot, 'src', 'control-panel'),
      to: path.join(distRoot, 'control-panel'),
    },
  ];
}

module.exports = {
  getStaticCopyPlan,
};
