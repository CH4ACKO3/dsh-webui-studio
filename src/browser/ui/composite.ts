export type CompositeNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End'

export function nextCompositeIndex(
  current: number,
  count: number,
  key: CompositeNavigationKey,
  disabled: ReadonlySet<number> = new Set(),
): number {
  if (count < 1 || disabled.size >= count) return current
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
  let candidate = key === 'Home' ? 0 : key === 'End' ? count - 1 : (current + direction + count) % count

  while (disabled.has(candidate)) {
    candidate = (candidate + direction + count) % count
  }
  return candidate
}
