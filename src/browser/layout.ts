export interface LayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export type ResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw'

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

export function fitRect(bounds: LayoutRect, aspectRatio: number): LayoutRect {
  const width = Math.min(bounds.width, bounds.height * aspectRatio)
  const height = width / aspectRatio
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  }
}

export function constrainRect(rect: LayoutRect, bounds: LayoutRect): LayoutRect {
  const width = Math.min(rect.width, bounds.width)
  const height = Math.min(rect.height, bounds.height)
  return {
    x: clamp(rect.x, bounds.x, bounds.x + bounds.width - width),
    y: clamp(rect.y, bounds.y, bounds.y + bounds.height - height),
    width,
    height,
  }
}

export function moveRect(rect: LayoutRect, dx: number, dy: number, bounds: LayoutRect): LayoutRect {
  return constrainRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds)
}

export function resizeRect(
  rect: LayoutRect,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  bounds: LayoutRect | undefined,
  minimum: { width: number; height: number },
  lockAspectRatio: boolean,
): LayoutRect {
  const leftBound = bounds?.x ?? Number.NEGATIVE_INFINITY
  const topBound = bounds?.y ?? Number.NEGATIVE_INFINITY
  const rightBound = bounds === undefined ? Number.POSITIVE_INFINITY : bounds.x + bounds.width
  const bottomBound = bounds === undefined ? Number.POSITIVE_INFINITY : bounds.y + bounds.height
  if (lockAspectRatio) {
    const ratio = rect.width / rect.height
    if (direction.length === 1) {
      const centerX = rect.x + rect.width / 2
      const centerY = rect.y + rect.height / 2
      if (direction === 'e' || direction === 'w') {
        const anchorX = direction === 'w' ? rect.x + rect.width : rect.x
        const horizontalRoom = direction === 'w' ? anchorX - leftBound : rightBound - anchorX
        const verticalRoom = 2 * Math.min(centerY - topBound, bottomBound - centerY)
        const maximumWidth = Math.min(horizontalRoom, verticalRoom * ratio)
        const minimumWidth = Math.min(maximumWidth, Math.max(minimum.width, minimum.height * ratio))
        const requestedWidth = rect.width + (direction === 'e' ? dx : -dx)
        const width = clamp(requestedWidth, minimumWidth, maximumWidth)
        const height = width / ratio
        return {
          x: direction === 'w' ? anchorX - width : anchorX,
          y: centerY - height / 2,
          width,
          height,
        }
      }
      const anchorY = direction === 'n' ? rect.y + rect.height : rect.y
      const horizontalRoom = 2 * Math.min(centerX - leftBound, rightBound - centerX)
      const verticalRoom = direction === 'n' ? anchorY - topBound : bottomBound - anchorY
      const maximumHeight = Math.min(verticalRoom, horizontalRoom / ratio)
      const minimumHeight = Math.min(maximumHeight, Math.max(minimum.height, minimum.width / ratio))
      const requestedHeight = rect.height + (direction === 's' ? dy : -dy)
      const height = clamp(requestedHeight, minimumHeight, maximumHeight)
      const width = height * ratio
      return {
        x: centerX - width / 2,
        y: direction === 'n' ? anchorY - height : anchorY,
        width,
        height,
      }
    }
    const horizontalGrowth = direction.includes('e') ? dx : -dx
    const verticalGrowth = (direction.includes('s') ? dy : -dy) * ratio
    const requestedWidth = rect.width + (Math.abs(horizontalGrowth) >= Math.abs(verticalGrowth)
      ? horizontalGrowth
      : verticalGrowth)
    const anchorX = direction.includes('w') ? rect.x + rect.width : rect.x
    const anchorY = direction.includes('n') ? rect.y + rect.height : rect.y
    const horizontalRoom = direction.includes('w') ? anchorX - leftBound : rightBound - anchorX
    const verticalRoom = direction.includes('n') ? anchorY - topBound : bottomBound - anchorY
    const maximumWidth = Math.min(horizontalRoom, verticalRoom * ratio)
    const minimumWidth = Math.min(maximumWidth, Math.max(minimum.width, minimum.height * ratio))
    const width = clamp(requestedWidth, minimumWidth, maximumWidth)
    const height = width / ratio
    return {
      x: direction.includes('w') ? anchorX - width : anchorX,
      y: direction.includes('n') ? anchorY - height : anchorY,
      width,
      height,
    }
  }

  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const nextLeft = direction.includes('w')
    ? clamp(rect.x + dx, leftBound, right - minimum.width)
    : rect.x
  const nextRight = direction.includes('e')
    ? clamp(right + dx, rect.x + minimum.width, rightBound)
    : right
  const nextTop = direction.includes('n')
    ? clamp(rect.y + dy, topBound, bottom - minimum.height)
    : rect.y
  const nextBottom = direction.includes('s')
    ? clamp(bottom + dy, rect.y + minimum.height, bottomBound)
    : bottom

  return {
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  }
}
