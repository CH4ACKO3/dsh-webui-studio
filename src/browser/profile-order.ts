export function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function moveProfilePlugin(order: readonly string[], name: string, targetIndex: number): string[] {
  const from = order.indexOf(name)
  if (from === -1 || name === 'dsh-harmony') return [...order]
  const firstMovable = order[0] === 'dsh-harmony' ? 1 : 0
  const target = Math.max(firstMovable, Math.min(order.length - 1, targetIndex))
  if (from === target) return [...order]
  const next = [...order]
  next.splice(from, 1)
  next.splice(target, 0, name)
  return next
}

export function isProfilePluginEnabled(disabled: readonly string[], name: string): boolean {
  return !disabled.includes(`${name}/*`)
}

export function setProfilePluginEnabled(disabled: readonly string[], name: string, enabled: boolean): string[] {
  const prefix = `${name}/`
  const retained = disabled.filter(key => !key.startsWith(prefix))
  return enabled ? retained : [...retained, `${name}/*`]
}
