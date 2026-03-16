function sanitizeElectronEnv(env) {
  const nextEnv = { ...env };
  delete nextEnv.ELECTRON_RUN_AS_NODE;
  return nextEnv;
}

module.exports = {
  sanitizeElectronEnv,
};
