import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/cordis-plugin-loader'
import '@deepseek-ai/dsh-client-modules'
import '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-host-apiproxy'
import '@deepseek-ai/dsh-host-webserver'
import '@deepseek-ai/dsh-system-prompt'
import '@deepseek-ai/dsh-subprocess'
import '@deepseek-ai/dsh-tools'
import 'dsh-harmony'
import { STUDIO_PATH, type StudioPluginFiberPhase } from './contracts.js'
import { StudioBackend } from './host/backend.js'
import { dshHomeFromProfile, StudioDraftRegistry, studioCommands } from './host/drafts.js'
import { applyPreviewWorker } from './host/preview-worker.js'
import { createStudioRoutes } from './host/routes.js'
import { StudioWorkspaceStore } from './host/workspace.js'

export const name = 'harmony-studio'
export const inject = ['harmony', 'agents', 'tools', 'systemPrompt', 'webServer', 'subprocess', 'loader', 'clientModules']

function fiberPhase(state: FiberState | undefined): StudioPluginFiberPhase {
  if (state === undefined || state === FiberState.DISPOSED) return null
  if (state === FiberState.PENDING) return 'pending'
  if (state === FiberState.LOADING) return 'loading'
  if (state === FiberState.ACTIVE) return 'active'
  if (state === FiberState.FAILED) return 'failed'
  return 'unloading'
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    if (ctx.webServer.host !== '127.0.0.1') {
      ctx.logger.warn('harmony-studio: Studio is disabled because dsh web is not bound to 127.0.0.1')
      return () => {}
    }
    const harmony = ctx.harmony
    const assets = {
      script: readFileSync(new URL('../dist/studio.js', import.meta.url)),
      style: readFileSync(new URL('../dist/studio.css', import.meta.url)),
      bridge: readFileSync(new URL('../dist/bridge.js', import.meta.url)),
      icon: readFileSync(new URL('../assets/harmony-icon.png', import.meta.url)),
      iconMono: readFileSync(new URL('../assets/harmony-icon-mono.png', import.meta.url)),
    }
    const previewRoot = process.env.DSH_STUDIO_PREVIEW_DRAFT_ROOT
    if (previewRoot !== undefined) {
      const controlToken = process.env.DSH_STUDIO_PREVIEW_CONTROL_TOKEN
      const parentOrigin = process.env.DSH_STUDIO_PREVIEW_PARENT_ORIGIN
      const bridgeCapability = process.env.DSH_STUDIO_PREVIEW_BRIDGE_CAPABILITY
      const packageDirsSource = process.env.DSH_STUDIO_PREVIEW_PACKAGE_DIRS
      if (controlToken === undefined || parentOrigin === undefined || bridgeCapability === undefined || packageDirsSource === undefined) {
        throw new Error('harmony-studio: Preview worker environment is incomplete')
      }
      const packageDirs = JSON.parse(packageDirsSource) as unknown
      if (!Array.isArray(packageDirs) || !packageDirs.every(item => typeof item === 'string')) {
        throw new Error('harmony-studio: Preview package directories are invalid')
      }
      applyPreviewWorker(ctx, harmony, {
        root: previewRoot,
        packageDirs,
        controlToken,
        parentOrigin,
        bridgeCapability,
        bridge: assets.bridge,
      })
      return () => {}
    }
    const token = randomBytes(32).toString('hex')
    const host = `127.0.0.1:${ctx.webServer.port}`
    const dshHome = dshHomeFromProfile(harmony.profileDir)
    const backend = new StudioBackend(
      harmony,
      ctx.agents,
      ctx.subprocess,
      new StudioDraftRegistry(dshHome),
      new StudioWorkspaceStore(dshHome),
      studioCommands,
      `http://${host}`,
      () => ({
        entries: [...ctx.loader.entries()].flatMap(entry => entry.options.group ? [] : [{
          entryId: entry.id,
          moduleName: entry.options.name,
          enabled: !entry.disabled,
          fiberPhase: fiberPhase(entry.fiber?.state),
        }]),
      }),
    )
    const dispose = [
      ...createStudioRoutes(backend, assets, { token, host, origin: `http://${host}` }).map(route => ctx.webServer.register(route)),
      ctx.webServer.tapIndex(html => {
        const script = `<script src="${STUDIO_PATH}/bridge.js"></script>`
        const head = html.indexOf('<head>')
        return head === -1 ? `${script}${html}` : `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`
      }),
    ]
    return async () => {
      for (const stop of dispose.reverse()) stop()
      await backend.dispose()
    }
  }, 'harmony-studio: routes')
}

export { StudioBackend } from './host/backend.js'
export { StudioBuildError, StudioBuildRunner, resolveBuildArgv } from './host/build.js'
export type { StudioBuildOutput } from './host/build.js'
export { StudioDraftRegistry, dshHomeFromProfile } from './host/drafts.js'
export { inspectReadiness, StudioPackRunner } from './host/readiness.js'
export { StudioPreviewSupervisor } from './host/preview.js'
export { createStudioRoutes, isTrustedStudioRequest } from './host/routes.js'
export { StudioWorkspaceStore } from './host/workspace.js'
