const PORT_RANGE = /^(\d+)-(\d+)$/

export class StudioPreviewPortPool {
  private readonly ports?: readonly number[]
  private readonly claimed = new Set<number>()

  constructor(range?: string) {
    if (range === undefined || range === '') return
    const match = PORT_RANGE.exec(range)
    if (match === null) throw new Error('DSH_STUDIO_PREVIEW_PORT_RANGE must use start-end syntax')
    const start = Number(match[1])
    const end = Number(match[2])
    if (start < 1 || end > 65_535 || start > end) {
      throw new Error('DSH_STUDIO_PREVIEW_PORT_RANGE must contain an ascending TCP port range')
    }
    this.ports = Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }

  claim(): number | undefined {
    if (this.ports === undefined) return undefined
    const port = this.ports.find(candidate => !this.claimed.has(candidate))
    if (port === undefined) throw new Error('No free Studio Preview port remains in DSH_STUDIO_PREVIEW_PORT_RANGE')
    this.claimed.add(port)
    return port
  }

  release(port: number | undefined): void {
    if (port !== undefined) this.claimed.delete(port)
  }
}

export const studioPreviewPortPool = new StudioPreviewPortPool(process.env.DSH_STUDIO_PREVIEW_PORT_RANGE)
