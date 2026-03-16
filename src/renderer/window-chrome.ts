export type WindowChromeStateInput = {
  hovering: boolean;
  menuOpen: boolean;
};

export type WindowChromeState = {
  visible: boolean;
  className: string;
};

export function getWindowChromeState(input: WindowChromeStateInput): WindowChromeState {
  const visible = input.hovering || input.menuOpen;

  return {
    visible,
    className: visible ? 'chrome-visible' : '',
  };
}
