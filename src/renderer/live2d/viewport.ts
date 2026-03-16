type SizeLike = {
  width: number;
  height: number;
};

type ViewportSource = {
  screen?: SizeLike;
  view?: SizeLike;
};

export function getLogicalViewportSize(source: ViewportSource): SizeLike {
  if (source.screen?.width && source.screen?.height) {
    return {
      width: source.screen.width,
      height: source.screen.height,
    };
  }

  return {
    width: source.view?.width ?? 0,
    height: source.view?.height ?? 0,
  };
}
