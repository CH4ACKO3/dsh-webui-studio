import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const studioRoot = packageRoot
const harmonyBin = process.env.DSH_HARMONY_BIN_ENTRY ?? fileURLToPath(import.meta.resolve('dsh-harmony/bin'))
const root = mkdtempSync(join(tmpdir(), 'dsh-harmony-studio-'))
const home = join(root, 'home')
const draftRoot = join(root, 'draft-plugin')
mkdirSync(draftRoot)
writeFileSync(join(draftRoot, 'package.json'), JSON.stringify({
  name: 'studio-draft',
  version: '0.0.0',
  type: 'module',
  packageManager: 'npm@11.6.2',
  main: './index.js',
  exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
  scripts: { build: 'node build.mjs' },
  dsh: { client: { platform: 'web', immediately: true } },
}))
writeFileSync(join(draftRoot, 'index.js'), 'export function apply() {}\n')
writeFileSync(join(draftRoot, 'client.js'), `
window.__ModuleLoader__.load({ id: 'studio-draft', factory: () => ({}) })
`)
writeFileSync(join(draftRoot, 'build.mjs'), `
import { writeFileSync } from 'node:fs'
writeFileSync(new URL('./client.js', import.meta.url), \`
window.__ModuleLoader__.load({ id: 'studio-draft', factory: () => ({ build: 1 }) })
\`)
console.log('studio draft built')
`)
for (const args of [
  ['init', '--initial-branch=main'],
  ['add', '.'],
  ['-c', 'user.name=dsh-webui-studio', '-c', 'user.email=studio@localhost', 'commit', '-m', 'Initial fixture'],
]) {
  const result = spawnSync('git', args, { cwd: draftRoot, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

const env = { ...process.env, DSH_HOME: home }
const add = packageDir => spawnSync(process.execPath, [
  harmonyBin, 'plugin', '--profile', 'web', 'add', `link:${packageDir}`,
], { cwd: packageRoot, env, encoding: 'utf8' })

let child
try {
  for (const packageDir of [studioRoot]) {
    const result = add(packageDir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }

  const dump = spawnSync(process.execPath, [harmonyBin, '--profile', 'web', '--dump-config'], {
    cwd: packageRoot,
    env,
    encoding: 'utf8',
  })
  assert.equal(dump.status, 0, dump.stderr)
  assert.doesNotMatch(dump.stdout, /name: dsh-webui-studio/)

  child = spawn(process.execPath, [harmonyBin, 'web', '--port', '0'], {
    cwd: packageRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Studio Host timed out:\n${output}`)), 15_000)
    const read = chunk => {
      output += chunk
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
      if (match === null) return
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`Studio Host exited ${code}:\n${output}`))
    })
  })

  const studioPage = await fetch(`${origin}/dsh-harmony/studio`)
  assert.equal(studioPage.status, 200)
  const studioHtml = await studioPage.text()
  assert.match(studioHtml, /Harmony WebUI Studio/)
  const token = studioHtml.match(/window\.__DSH_STUDIO__=\{token:"([a-f0-9]+)"\}/)?.[1]
  assert.ok(token, 'Studio document did not contain its capability token')

  const bridge = await fetch(`${origin}/dsh-harmony/studio/bridge.js`)
  assert.equal(bridge.status, 200)
  assert.doesNotMatch(await bridge.text(), new RegExp(token))
  const studioScript = await fetch(`${origin}/dsh-harmony/studio/assets/studio.js`)
  assert.equal(studioScript.status, 200)
  assert.doesNotMatch(await studioScript.text(), /process\.env\.NODE_ENV/)

  const call = async (method, payload) => {
    const rpcId = `e2e-${method}`
    const response = await fetch(`${origin}/dsh-harmony/studio/api/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        'x-dsh-studio-token': token,
      },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    })
    assert.equal(response.status, 200)
    const envelope = await response.json()
    assert.equal(envelope.rpcId, rpcId)
    assert.equal(envelope.result.ok, true, `${JSON.stringify(envelope.result)}\n${output}`)
    return envelope.result.value
  }

  const created = await call('studio.drafts.create', {
    source: { kind: 'existing', repository: draftRoot },
    profileMode: 'main-home',
  })
  assert.notEqual(created.root, draftRoot)
  assert.match(created.worktreeDir, /studio\/worktrees/)
  const started = await call('studio.drafts.start', { draftId: created.id })
  const opened = started.project
  assert.equal(opened.state, 'staged')
  assert.equal(started.runtime.state, 'running')
  const previewOrigin = new URL(started.runtime.previewUrl).origin
  assert.notEqual(previewOrigin, origin)
  const secondCreated = await call('studio.drafts.create', {
    source: { kind: 'existing', repository: draftRoot },
    profileMode: 'main-home',
  })
  const secondStarted = await call('studio.drafts.start', { draftId: secondCreated.id })
  assert.notEqual(secondCreated.worktreeDir, created.worktreeDir)
  assert.notEqual(secondCreated.runtimeHome, created.runtimeHome)
  assert.notEqual(new URL(secondStarted.runtime.previewUrl).origin, previewOrigin)
  assert.equal((await fetch(secondStarted.runtime.previewUrl)).status, 200)
  assert.doesNotMatch(await fetch(origin).then(response => response.text()), /"id":"studio-draft"/)
  const preview = await fetch(started.runtime.previewUrl)
  const html = await preview.text()
  const bridgeIndex = html.indexOf('/dsh-harmony/studio/bridge.js')
  const bootIndex = html.indexOf('window.__DSH_BOOT__')
  assert.notEqual(bridgeIndex, -1, 'Preview bridge was not injected into the official WebUI')
  assert.notEqual(bootIndex, -1, 'official WebUI boot manifest was not found')
  assert.ok(bridgeIndex < bootIndex, 'Preview bridge must run before the WebUI boot manifest')
  assert.match(html, /"id":"studio-draft"/)
  const previewGraphRev = html.match(/window\.__DSH_BOOT__ = \{"rev":"([a-f0-9]+)"/)?.[1]
  assert.ok(previewGraphRev, 'Preview did not expose its Client graph revision')

  const scoped = { draftId: created.id }
  const files = await call('studio.project.files', scoped)
  assert.ok(files.some(file => file.path === 'index.js'))
  const source = await call('studio.project.readFile', { ...scoped, path: 'index.js' })
  assert.equal(source.content, 'export function apply() {}\n')
  await call('studio.project.writeFile', { ...scoped, path: 'index.js', content: 'export function apply() { return "studio" }\n' })
  const saved = await call('studio.project.readFile', { ...scoped, path: 'index.js' })
  assert.equal(saved.content, 'export function apply() { return "studio" }\n')

  const active = await call('studio.project.activate', { ...scoped, graphRev: previewGraphRev })
  assert.equal(active.state, 'active')

  const built = await call('studio.project.build', scoped)
  assert.equal(built.project.state, 'preview-pending')
  assert.notEqual(built.project.graphRev, active.graphRev)
  assert.match(built.build.stdout, /studio draft built/)
  const rebuiltPreview = await fetch(started.runtime.previewUrl)
  const rebuiltHtml = await rebuiltPreview.text()
  const rebuiltGraphRev = rebuiltHtml.match(/window\.__DSH_BOOT__ = \{"rev":"([a-f0-9]+)"/)?.[1]
  assert.ok(rebuiltGraphRev, 'Rebuilt Preview did not expose its Client graph revision')
  const confirmed = await call('studio.project.activate', { ...scoped, graphRev: rebuiltGraphRev })
  assert.equal(confirmed.state, 'active')

  const stopped = await call('studio.drafts.stop', scoped)
  assert.equal(stopped.runtime.state, 'stopped')
  const secondStopped = await call('studio.drafts.stop', { draftId: secondCreated.id })
  assert.equal(secondStopped.runtime.state, 'stopped')
} finally {
  if (child?.exitCode === null) {
    child.kill()
    await new Promise(resolve => child.once('exit', resolve))
  }
  rmSync(root, { recursive: true })
}
