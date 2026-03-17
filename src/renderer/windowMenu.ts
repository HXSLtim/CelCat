export type WindowMenuActionId = 'refit-model' | 'close-window';
export type WindowMenuIntent = 'toggle' | 'close';

export type WindowMenuItem = {
  id: WindowMenuActionId;
  label: string;
};

export function getWindowMenuItems(): WindowMenuItem[] {
  return [
    { id: 'refit-model', label: '重新适配模型' },
    { id: 'close-window', label: '关闭窗口' },
  ];
}

export function getNextMenuOpenState(
  currentOpen: boolean,
  intent: WindowMenuIntent,
): boolean {
  return intent === 'toggle' ? !currentOpen : false;
}
