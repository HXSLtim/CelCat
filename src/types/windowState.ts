export type WindowStateSnapshot = {
  isFullscreen: boolean;
};

export type WindowStateEvent = {
  type: 'fullscreen-changed';
  snapshot: WindowStateSnapshot;
};
