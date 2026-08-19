let sequence = 0

export function nextBrowserId(): string {
  sequence += 1
  return `${Date.now().toString(36)}-${sequence.toString(36)}`
}
