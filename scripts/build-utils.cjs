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
      from: path.join(projectRoot, 'src', 'assets'),
      to: path.join(distRoot, 'assets'),
    },
  ];
}

module.exports = {
  getStaticCopyPlan,
};
