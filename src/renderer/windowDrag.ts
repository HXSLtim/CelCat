export type Point = {
  x: number;
  y: number;
};

export type DragSession = {
  offsetX: number;
  offsetY: number;
};

export function createDragSession(windowPosition: Point, pointerPosition: Point): DragSession {
  return {
    offsetX: pointerPosition.x - windowPosition.x,
    offsetY: pointerPosition.y - windowPosition.y,
  };
}

export function getWindowPositionForPointer(
  session: DragSession,
  pointerPosition: Point,
): Point {
  return {
    x: pointerPosition.x - session.offsetX,
    y: pointerPosition.y - session.offsetY,
  };
}

export function isValidWindowPosition(position: Point): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}
