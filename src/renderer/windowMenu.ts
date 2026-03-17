export type WindowMenuActionId = 'refit-model' | 'open-control-panel' | 'toggle-fullscreen' | 'close-window';
export type WindowMenuIntent = 'toggle' | 'close';

export type WindowMenuItem = {
  id: WindowMenuActionId;
  label: string;
};

export function getWindowMenuItems(options?: { isFullscreen?: boolean }): WindowMenuItem[] {
  const isFullscreen = Boolean(options?.isFullscreen);

  return [
    { id: 'refit-model', label: '重新适配模型' },
    { id: 'open-control-panel', label: '打开控制面板' },
    { id: 'toggle-fullscreen', label: isFullscreen ? '退出全屏' : '进入全屏' },
    { id: 'close-window', label: '关闭窗口' },
  ];
}

export function getNextMenuOpenState(
  currentOpen: boolean,
  intent: WindowMenuIntent,
): boolean {
  return intent === 'toggle' ? !currentOpen : false;
}
