export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export function pointInsideSelection(rect: SelectionRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width
    && y >= rect.y && y <= rect.y + rect.height
}
